import {
  commentAutomationService,
  type MissedCommentsIneligibleReason,
  workspaceService,
} from "@chatbotx.io/business"
import { db, sql } from "@chatbotx.io/database/client"
import type { CommentAutomationType } from "@chatbotx.io/database/partials"
import {
  LowJobAction,
  type LowJobReplayMissedComment,
  lowQueue,
} from "@chatbotx.io/worker-config"
import { subDays } from "date-fns"
import { logger } from "@/lib/log"
import { scanPostComments } from "./index"
import { listRecentPostIds } from "./list-recent-posts"
import {
  MISSED_COMMENTS_SCAN_DAYS,
  MissedCommentsIntegrationNotFoundError,
  type ScannedComment,
} from "./types"

/**
 * Gap between two replayed comments on one channel account. A run can hold
 * thousands of comments, and enqueueing them all at once would fire every reply
 * and DM in the same burst — hitting the channel's rate limits. Spacing them
 * mirrors the one-at-a-time pace of AhaChat's replay; the spacing is booked on
 * the account (`reserveMissedCommentsReplayWindow`), so concurrent runs on one
 * Page share it instead of multiplying it.
 */
const MISSED_COMMENTS_REPLAY_SPACING_MS = 1000

/** Jobs per `addBulk` call — one Redis round trip per chunk, not per comment. */
const MISSED_COMMENTS_ENQUEUE_CHUNK_SIZE = 500

/** A comment to replay; `retryEventId` marks a failed DM to resend alone. */
type ReplayItem = ScannedComment & { retryEventId?: string }

type ReplayJob = {
  name: typeof LowJobAction.replayMissedComment
  data: LowJobReplayMissedComment
  opts: { jobId: string; delay: number; attempts: number }
}

export type ProcessMissedCommentsFailureReason =
  | MissedCommentsIneligibleReason
  | "workspaceInactive"
  | "alreadyRunning"
  | "integrationNotFound"
  | "fetchFailed"

export type ProcessMissedCommentsResult =
  | {
      status: "done"
      scanned: number
      skipped: number
      queued: number
      failed: number
    }
  | { status: "failed"; reason: ProcessMissedCommentsFailureReason }

/**
 * Replays the last `MISSED_COMMENTS_SCAN_DAYS` days of comments on an
 * automation's single post through that automation only.
 *
 * A comment counts as handled when this automation already has an event or a
 * miss row for it; everything else is enqueued on the `low` queue, oldest
 * first, and ingested there through the live webhook path (`receiveComment`).
 * Sends and replies are real — the caller confirms that before calling.
 */
export async function processMissedComments(props: {
  workspaceId: string
  id: string
}): Promise<ProcessMissedCommentsResult> {
  const target =
    await commentAutomationService.resolveMissedCommentsTarget(props)
  if (!target.eligible) {
    return { status: "failed", reason: target.reason }
  }

  // The worker drops a comment for a workspace that is off or outside its
  // active hours without a word, so a run then would scan and send nothing.
  const workspace = await workspaceService.findById({ id: props.workspaceId })
  if (!workspaceService.isActiveNow(workspace)) {
    return { status: "failed", reason: "workspaceInactive" }
  }

  const { automation, channelType, postId } = target
  if (!(await commentAutomationService.claimMissedCommentsRun(automation.id))) {
    return { status: "failed", reason: "alreadyRunning" }
  }

  try {
    let comments: ScannedComment[]
    try {
      comments = await scanAutomationComments({
        type: channelType,
        workspaceId: props.workspaceId,
        postId,
        since: subDays(new Date(), MISSED_COMMENTS_SCAN_DAYS),
        inboxId: automation.inboxId,
      })
    } catch (error) {
      if (error instanceof MissedCommentsIntegrationNotFoundError) {
        return { status: "failed", reason: "integrationNotFound" }
      }
      logger.warn(
        { err: error, automationId: automation.id, postId },
        "Process missed comments: fetching the post's comments failed",
      )
      return { status: "failed", reason: "fetchFailed" }
    }

    // Facebook hides a comment's author from the Graph listing unless the app
    // holds extra permissions, so the scan above can come back empty. A comment
    // this automation skipped as `postNotMatched` (a reel misjudged as live) is
    // already on record with its author: replay it from there.
    if (channelType === "messenger") {
      const known = new Set(comments.map((c) => c.commentData.commentId))
      const recorded = await findMisjudgedMessengerComments({
        workspaceId: props.workspaceId,
        automationId: automation.id,
        since: subDays(new Date(), MISSED_COMMENTS_SCAN_DAYS),
      })
      comments = [
        ...comments,
        ...recorded.filter((c) => !known.has(c.commentData.commentId)),
      ]
    }

    const processed = await commentAutomationService.findProcessedCommentIds({
      automationId: automation.id,
      commentIds: comments.map((comment) => comment.commentData.commentId),
    })
    // Answered comments whose DM failed for a passing reason get the DM again
    // (and only the DM). The scanned copy is preferred: it carries the IG
    // account; a Facebook one is rebuilt from the record.
    const scannedById = new Map(
      comments.map((comment) => [comment.commentData.commentId, comment]),
    )
    const retries = (
      await findRetryableFailedDms({
        workspaceId: props.workspaceId,
        automationId: automation.id,
        since: subDays(new Date(), MISSED_COMMENTS_SCAN_DAYS),
      })
    ).flatMap((failure): ReplayItem[] => {
      const scanned = scannedById.get(failure.commentData.commentId)
      if (scanned) {
        return [{ ...scanned, retryEventId: failure.retryEventId }]
      }
      return channelType === "messenger" ? [failure] : []
    })

    const pending: ReplayItem[] = [
      ...comments.filter(
        (comment) => !processed.has(comment.commentData.commentId),
      ),
      ...retries,
    ].sort(
      (left, right) =>
        left.commentData.createdTime - right.commentData.createdTime,
    )

    let failed = 0
    if (pending.length > 0) {
      // Counted before enqueueing: the first replay can run at once, and its
      // finish must find the counter. The count drives the list's
      // "processing" status and blocks another run until the last replay.
      await commentAutomationService.startMissedCommentsReplay(
        automation.id,
        pending.length,
      )
      const enqueued = await enqueueReplays({
        workspaceId: props.workspaceId,
        automationId: automation.id,
        channelType,
        comments: pending,
      })
      failed = enqueued.failed
      await commentAutomationService.settleMissedCommentsEnqueue(
        automation.id,
        enqueued,
      )
    }

    logger.info(
      {
        automationId: automation.id,
        postId,
        scanned: comments.length,
        pending: pending.length,
        dmRetries: retries.length,
        failed,
      },
      "Process missed comments: run finished",
    )

    return {
      status: "done",
      scanned: comments.length,
      skipped: comments.length - pending.length,
      queued: pending.length - failed,
      failed,
    }
  } finally {
    await commentAutomationService.releaseMissedCommentsRun(automation.id)
  }
}

/**
 * Facebook comments this automation skipped as `postNotMatched` and never
 * answered, rebuilt from the miss row and the commenter's inbox — the same
 * shape the `feed` webhook enqueues. Only top-level comments are recorded as
 * misses on a misjudged post, so the post is the parent.
 */
async function findMisjudgedMessengerComments(props: {
  workspaceId: string
  automationId: string
  since: Date
}): Promise<ScannedComment[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (m."commentId")
      m."commentId", m."postId", m."commentText", m."occurredAt",
      ci."sourceId" AS "fromId", c."fullName" AS "fromName"
    FROM "CommentAutomationMiss" m
    JOIN "ContactInbox" ci ON ci."id" = m."contactInboxId"
    LEFT JOIN "Contact" c ON c."id" = m."contactId"
    WHERE m."workspaceId" = ${props.workspaceId}
      AND m."automationId" = ${props.automationId}
      AND m."reason" = 'postNotMatched'
      AND m."occurredAt" >= ${props.since}
      AND NOT EXISTS (
        SELECT 1 FROM "CommentAutomationEvent" e
        WHERE e."automationId" = m."automationId" AND e."commentId" = m."commentId"
      )
    ORDER BY m."commentId", m."occurredAt"
  `)
  return (result.rows as Record<string, unknown>[]).flatMap((row) => {
    const postId = String(row.postId)
    const pageId = postId.split("_")[0]
    if (!(pageId && row.fromId)) {
      return []
    }
    return [
      {
        integrationIdentifier: pageId,
        commentData: {
          commentId: String(row.commentId),
          postId,
          parentId: postId,
          fromId: String(row.fromId),
          fromName: row.fromName ? String(row.fromName) : undefined,
          message: row.commentText ? String(row.commentText) : undefined,
          createdTime: Math.floor(
            new Date(String(row.occurredAt)).getTime() / 1000,
          ),
        },
      },
    ]
  })
}

/**
 * Meta errors that pass on their own: the Page's temporary messaging
 * restriction and Meta's own unexplained failures. Anything else (already
 * replied, thread archived, private replies not allowed) would fail again.
 */
const RETRYABLE_DM_ERRORS = [
  "%1893063%",
  "%(#1) An unknown error%",
  "%Unexpected internal error%",
]

/**
 * Comments this automation answered whose DM failed with a retryable error,
 * rebuilt from the event and the commenter's inbox like
 * `findMisjudgedMessengerComments`.
 */
async function findRetryableFailedDms(props: {
  workspaceId: string
  automationId: string
  since: Date
}): Promise<ReplayItem[]> {
  const result = await db.execute(sql`
    SELECT e."id", e."commentId", e."postId", e."commentText", e."occurredAt",
      ci."sourceId" AS "fromId", c."fullName" AS "fromName"
    FROM "CommentAutomationEvent" e
    JOIN "ContactInbox" ci ON ci."id" = e."contactInboxId"
    LEFT JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."workspaceId" = ${props.workspaceId}
      AND e."automationId" = ${props.automationId}
      AND e."replyChannel" = 'private'
      AND e."status" = 'failed'
      AND e."occurredAt" >= ${props.since}
      AND (${sql.join(
        RETRYABLE_DM_ERRORS.map(
          (pattern) => sql`e."errorDetail" LIKE ${pattern}`,
        ),
        sql` OR `,
      )})
  `)
  return (result.rows as Record<string, unknown>[]).flatMap((row) => {
    const postId = String(row.postId)
    const pageId = postId.split("_")[0]
    if (!(pageId && row.fromId)) {
      return []
    }
    return [
      {
        retryEventId: String(row.id),
        integrationIdentifier: pageId,
        commentData: {
          commentId: String(row.commentId),
          postId,
          parentId: postId,
          fromId: String(row.fromId),
          fromName: row.fromName ? String(row.fromName) : undefined,
          message: row.commentText ? String(row.commentText) : undefined,
          createdTime: Math.floor(
            new Date(String(row.occurredAt)).getTime() / 1000,
          ),
        },
      },
    ]
  })
}

/**
 * The recent comments an automation watches: its one post's, or — for an
 * "every post" automation (`postId` null) — those of the account's newest
 * posts. One post that cannot be read does not end the run; it fails only
 * when every post did.
 */
async function scanAutomationComments(props: {
  type: CommentAutomationType
  workspaceId: string
  postId: string | null
  since: Date
  inboxId: string | null
}): Promise<ScannedComment[]> {
  const { postId, ...rest } = props
  if (postId) {
    return scanPostComments({ ...rest, postId })
  }

  const postIds = await listRecentPostIds(rest)
  logger.info(
    { type: rest.type, posts: postIds.length, postIds },
    "Process missed comments: scanning recent posts",
  )
  const comments: ScannedComment[] = []
  let lastError: unknown
  let scannedAny = postIds.length === 0
  for (const recentPostId of postIds) {
    try {
      comments.push(
        ...(await scanPostComments({ ...rest, postId: recentPostId })),
      )
      scannedAny = true
    } catch (error) {
      lastError = error
      logger.warn(
        { err: error, postId: recentPostId },
        "Process missed comments: reading one post's comments failed",
      )
    }
  }
  if (!scannedAny) {
    throw lastError
  }
  return comments
}

/**
 * Enqueues the replays on the `low` queue, one comment per job. Comments are
 * grouped by channel account, and each group books its time on that account's
 * replay timeline, then spaces its jobs `MISSED_COMMENTS_REPLAY_SPACING_MS`
 * apart inside the booking. Jobs go out in chunks; a failed chunk is counted
 * and skipped rather than stopping the run.
 *
 * The job id makes a second run a no-op for a comment whose replay is still
 * queued (waiting its turn) and so has no event row yet. One attempt only: a
 * retry could send a reply twice, while a comment whose replay failed simply
 * has no event row and is picked up by the next run.
 *
 * Returns how many comments failed to enqueue, and the delay of the last
 * scheduled replay.
 */
async function enqueueReplays(props: {
  workspaceId: string
  automationId: string
  channelType: CommentAutomationType
  comments: ReplayItem[]
}): Promise<{ failed: number; lastDelayMs: number }> {
  const { workspaceId, automationId, channelType, comments } = props

  let failed = 0
  let lastDelayMs = 0
  for (const [integrationIdentifier, group] of groupByIntegration(comments)) {
    const startAt =
      await commentAutomationService.reserveMissedCommentsReplayWindow({
        channelType,
        integrationIdentifier,
        spanMs: group.length * MISSED_COMMENTS_REPLAY_SPACING_MS,
      })
    const firstDelay = Math.max(0, startAt - Date.now())

    const jobs = group.map(
      (comment, index): ReplayJob => ({
        name: LowJobAction.replayMissedComment,
        data: {
          type: LowJobAction.replayMissedComment,
          data: {
            workspaceId,
            integrationType: channelType,
            integrationIdentifier,
            commentData: comment.commentData,
            replay: comment.retryEventId
              ? { automationId, retryPrivateOnly: true }
              : { automationId },
          },
        },
        opts: {
          // A retry keys on the failed row: a later failure is a new row, so
          // the next run may try again, while a queued retry is not doubled.
          jobId: comment.retryEventId
            ? `retry-dm-${automationId}-${comment.retryEventId}`
            : `missed-comment-${automationId}-${comment.commentData.commentId}`,
          delay: firstDelay + index * MISSED_COMMENTS_REPLAY_SPACING_MS,
          attempts: 1,
        },
      }),
    )

    failed += await addInChunks({ automationId, jobs })
    lastDelayMs = Math.max(lastDelayMs, jobs.at(-1)?.opts.delay ?? 0)
  }

  return { failed, lastDelayMs }
}

function groupByIntegration(comments: ReplayItem[]): Map<string, ReplayItem[]> {
  const groups = new Map<string, ReplayItem[]>()
  for (const comment of comments) {
    const group = groups.get(comment.integrationIdentifier)
    if (group) {
      group.push(comment)
    } else {
      groups.set(comment.integrationIdentifier, [comment])
    }
  }
  return groups
}

async function addInChunks(props: {
  automationId: string
  jobs: ReplayJob[]
}): Promise<number> {
  const { automationId, jobs } = props
  let failed = 0
  for (
    let start = 0;
    start < jobs.length;
    start += MISSED_COMMENTS_ENQUEUE_CHUNK_SIZE
  ) {
    const chunk = jobs.slice(start, start + MISSED_COMMENTS_ENQUEUE_CHUNK_SIZE)
    try {
      await lowQueue.addBulk(chunk)
    } catch (error) {
      failed += chunk.length
      logger.error(
        {
          err: error,
          automationId,
          chunkStart: start,
          chunkSize: chunk.length,
        },
        "Process missed comments: enqueueing a chunk of comments failed",
      )
    }
  }
  return failed
}
