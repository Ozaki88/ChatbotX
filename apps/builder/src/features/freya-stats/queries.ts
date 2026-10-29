import "server-only"

import { resolveTenantSettings } from "@chatbotx.io/business"
import { db, type SQL, sql } from "@chatbotx.io/database/client"
import { getPublicFileUrl } from "@chatbotx.io/utils"
import {
  canonicalizeTimezone,
  isValidTimezone,
} from "@chatbotx.io/utils/timezone"

/**
 * One-page analytics across every comment automation of a workspace: the
 * comment → DM → delivered → seen → tapped funnel, day by day, per automation,
 * per post, what people wrote, why comments were missed or DMs failed, when
 * people comment, inbox volume and a feed of the latest replies.
 *
 * Everything reads `CommentAutomationEvent` (one row per reply attempted, per
 * channel) and `CommentAutomationMiss` (comments an automation looked at and
 * declined). A comment can be answered by one automation and missed by
 * another, so "comments" always counts DISTINCT `commentId`.
 */

export const FREYA_STATS_RANGES = {
  "7": { label: "Last 7 days", days: 7 },
  "30": { label: "Last 30 days", days: 30 },
  "90": { label: "Last 90 days", days: 90 },
  all: { label: "All time", days: null },
} as const
export type FreyaStatsRange = keyof typeof FREYA_STATS_RANGES

export const FREYA_STATS_CHANNELS = {
  all: { label: "All channels", types: null },
  instagram: { label: "Instagram", types: ["instagram", "instagramFacebook"] },
  facebook: { label: "Facebook", types: ["messenger"] },
} as const
export type FreyaStatsChannel = keyof typeof FREYA_STATS_CHANNELS

export type FreyaStatsFilter = {
  workspaceId: string
  range: FreyaStatsRange
  channel: FreyaStatsChannel
  timezone: string
}

type Row = Record<string, unknown>

const ABSOLUTE_URL = /^https?:\/\//

const num = (value: unknown): number => Number(value ?? 0)

async function rows<T extends Row>(query: SQL): Promise<T[]> {
  const result = await db.execute(query)
  return result.rows as T[]
}

function since(range: FreyaStatsRange): Date {
  const days = FREYA_STATS_RANGES[range].days
  return days === null ? new Date(0) : new Date(Date.now() - days * 86_400_000)
}

/** `AND a."type" IN (...)` for the channel filter, or nothing for all channels. */
function channelClause(channel: FreyaStatsChannel): SQL {
  const types = FREYA_STATS_CHANNELS[channel].types
  if (!types) {
    return sql``
  }
  return sql` AND a."type" IN (${sql.join(
    types.map((type) => sql`${type}`),
    sql`, `,
  )})`
}

/** Events in range, joined to their automation, as a reusable FROM/WHERE. */
function eventsWhere(filter: FreyaStatsFilter): SQL {
  return sql`
    FROM "CommentAutomationEvent" e
    JOIN "CommentAutomation" a ON a."id" = e."automationId"
    WHERE e."workspaceId" = ${filter.workspaceId}
      AND e."occurredAt" >= ${since(filter.range)}${channelClause(filter.channel)}`
}

function missesWhere(filter: FreyaStatsFilter): SQL {
  return sql`
    FROM "CommentAutomationMiss" m
    JOIN "CommentAutomation" a ON a."id" = m."automationId"
    WHERE m."workspaceId" = ${filter.workspaceId}
      AND m."occurredAt" >= ${since(filter.range)}${channelClause(filter.channel)}`
}

/** Every distinct comment seen in range — answered or missed — with its text and time. */
function allCommentsCte(filter: FreyaStatsFilter): SQL {
  return sql`
    WITH comments AS (
      SELECT e."commentId", e."postId", e."commentText", e."occurredAt", a."type", true AS answered
      ${eventsWhere(filter)}
      UNION ALL
      SELECT m."commentId", m."postId", m."commentText", m."occurredAt", a."type", false AS answered
      ${missesWhere(filter)}
    ),
    distinct_comments AS (
      SELECT "commentId",
        MIN("postId") AS "postId",
        MIN("commentText") AS "commentText",
        MIN("occurredAt") AS "occurredAt",
        MIN("type") AS "type",
        BOOL_OR(answered) AS answered
      FROM comments
      GROUP BY "commentId"
    )`
}

function safeTimezone(timezone: string): string {
  const canonical = canonicalizeTimezone(timezone)
  return isValidTimezone(canonical) ? canonical : "UTC"
}

export async function getFreyaStats(filter: FreyaStatsFilter) {
  const tz = safeTimezone(filter.timezone)
  const from = since(filter.range)

  // One failing section must not take the whole page down: each query reports
  // its own error and renders empty, so the rest of the stats still load.
  const errors: string[] = []
  const run = (label: string, query: SQL) =>
    rows(query).catch((error: unknown) => {
      errors.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return [] as Row[]
    })

  const [
    totals,
    commentTotals,
    tapped,
    newContacts,
    daily,
    automations,
    posts,
    words,
    missReasons,
    failures,
    hours,
    weekdays,
    inbox,
    feed,
    links,
    linkTotals,
    linkDaily,
  ] = await Promise.all([
    run(
      "totals",
      sql`
      SELECT
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."status" = 'sent') AS "dmSent",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."deliveredAt" IS NOT NULL) AS "dmDelivered",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."seenAt" IS NOT NULL) AS "dmSeen",
        COUNT(*) FILTER (WHERE e."clickedAt" IS NOT NULL) AS "tapped",
        COUNT(*) FILTER (WHERE e."status" = 'failed' OR e."failedAt" IS NOT NULL) AS "failed",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'public' AND e."status" = 'sent') AS "publicReplies",
        COUNT(DISTINCT e."contactId") FILTER (WHERE e."replyChannel" = 'private' AND e."status" = 'sent') AS "peopleReached"
      ${eventsWhere(filter)}`,
    ),
    run(
      "comments",
      sql`
      ${allCommentsCte(filter)}
      SELECT COUNT(*) AS "comments",
        COUNT(*) FILTER (WHERE answered) AS "answered",
        COUNT(*) FILTER (WHERE NOT answered) AS "unanswered"
      FROM distinct_comments`,
    ),
    run(
      "tapped tag",
      sql`
      SELECT COUNT(*) AS "count"
      FROM "ContactToTag" ct
      JOIN "Tag" t ON t."id" = ct."tagId"
      WHERE t."workspaceId" = ${filter.workspaceId} AND t."name" = 'tapped-gummies'`,
    ),
    run(
      "new contacts",
      sql`
      SELECT COUNT(*) AS "count" FROM "Contact"
      WHERE "workspaceId" = ${filter.workspaceId} AND "createdAt" >= ${from}`,
    ),
    run(
      "daily",
      sql`
      WITH ev AS (
        SELECT TO_CHAR((e."occurredAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, e.*
        ${eventsWhere(filter)}
      ),
      by_day AS (
        SELECT day,
          COUNT(DISTINCT "commentId") AS "answeredComments",
          COUNT(*) FILTER (WHERE "replyChannel" = 'private' AND "status" = 'sent') AS "dmSent",
          COUNT(*) FILTER (WHERE "replyChannel" = 'private' AND "deliveredAt" IS NOT NULL) AS "dmDelivered",
          COUNT(*) FILTER (WHERE "replyChannel" = 'private' AND "seenAt" IS NOT NULL) AS "dmSeen",
          COUNT(*) FILTER (WHERE "clickedAt" IS NOT NULL) AS "tapped",
          COUNT(*) FILTER (WHERE "status" = 'failed' OR "failedAt" IS NOT NULL) AS "failed"
        FROM ev GROUP BY day
      ),
      missed AS (
        SELECT TO_CHAR((m."occurredAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
          COUNT(DISTINCT m."commentId") AS "missedComments"
        ${missesWhere(filter)}
          AND NOT EXISTS (
            SELECT 1 FROM "CommentAutomationEvent" ex
            WHERE ex."workspaceId" = m."workspaceId" AND ex."commentId" = m."commentId"
          )
        GROUP BY 1
      )
      SELECT COALESCE(d.day, mi.day) AS day,
        COALESCE(d."answeredComments", 0) AS "answeredComments",
        COALESCE(mi."missedComments", 0) AS "missedComments",
        COALESCE(d."dmSent", 0) AS "dmSent",
        COALESCE(d."dmDelivered", 0) AS "dmDelivered",
        COALESCE(d."dmSeen", 0) AS "dmSeen",
        COALESCE(d."tapped", 0) AS "tapped",
        COALESCE(d."failed", 0) AS "failed"
      FROM by_day d FULL OUTER JOIN missed mi ON mi.day = d.day
      ORDER BY 1 DESC
      LIMIT 120`,
    ),
    run(
      "automations",
      sql`
      SELECT a."id", a."name", a."type", a."isActive",
        COUNT(DISTINCT e."commentId") AS "comments",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."status" = 'sent') AS "dmSent",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."deliveredAt" IS NOT NULL) AS "dmDelivered",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."seenAt" IS NOT NULL) AS "dmSeen",
        COUNT(*) FILTER (WHERE e."clickedAt" IS NOT NULL) AS "tapped",
        COUNT(*) FILTER (WHERE e."status" = 'failed' OR e."failedAt" IS NOT NULL) AS "failed",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'public' AND e."status" = 'sent') AS "publicReplies"
      ${eventsWhere(filter)}
      GROUP BY a."id", a."name", a."type", a."isActive"
      ORDER BY "comments" DESC`,
    ),
    run(
      "posts",
      sql`
      ${allCommentsCte(filter)},
      ev AS (SELECT e.* ${eventsWhere(filter)}),
      per_post AS (
        SELECT c."postId", MIN(c."type") AS "type",
          COUNT(*) AS "comments",
          COUNT(*) FILTER (WHERE c.answered) AS "answered",
          MAX(c."occurredAt") AS "lastComment"
        FROM distinct_comments c
        GROUP BY c."postId"
        ORDER BY "comments" DESC
        LIMIT 25
      )
      SELECT p.*,
        (SELECT COUNT(*) FROM ev WHERE ev."postId" = p."postId" AND ev."replyChannel" = 'private' AND ev."status" = 'sent') AS "dmSent",
        (SELECT COUNT(*) FROM ev WHERE ev."postId" = p."postId" AND ev."clickedAt" IS NOT NULL) AS "tapped",
        cp."caption", cp."thumbnail", cp."permalink"
      FROM per_post p
      LEFT JOIN LATERAL (
        -- Facebook comments name the post "{pageId}_{storyId}"; the stored post
        -- may use either form, so match both ways.
        SELECT "caption", "thumbnail", "permalink" FROM "ChannelPost"
        WHERE "workspaceId" = ${filter.workspaceId}
          AND ("externalPostId" IN (p."postId", SPLIT_PART(p."postId", '_', 2))
            OR p."postId" = SPLIT_PART("externalPostId", '_', 2))
        LIMIT 1
      ) cp ON true
      ORDER BY p."comments" DESC`,
    ),
    run(
      "comment texts",
      sql`
      ${allCommentsCte(filter)}
      SELECT LOWER(TRIM("commentText")) AS "text",
        COUNT(*) AS "count",
        COUNT(*) FILTER (WHERE answered) AS "answered"
      FROM distinct_comments
      WHERE "commentText" IS NOT NULL AND TRIM("commentText") <> ''
      GROUP BY 1
      ORDER BY "count" DESC
      LIMIT 30`,
    ),
    run(
      "miss reasons",
      sql`
      SELECT m."reason", COUNT(DISTINCT m."commentId") AS "count"
      ${missesWhere(filter)}
          AND NOT EXISTS (
            SELECT 1 FROM "CommentAutomationEvent" ex
            WHERE ex."workspaceId" = m."workspaceId" AND ex."commentId" = m."commentId"
          )
      GROUP BY m."reason"
      ORDER BY "count" DESC`,
    ),
    run(
      "failures",
      sql`
      SELECT LEFT(COALESCE(e."errorDetail", 'No detail recorded'), 220) AS "detail",
        e."httpCode", COUNT(*) AS "count", MAX(e."occurredAt") AS "last"
      ${eventsWhere(filter)}
        AND (e."status" = 'failed' OR e."failedAt" IS NOT NULL)
      GROUP BY 1, 2
      ORDER BY "count" DESC
      LIMIT 15`,
    ),
    run(
      "hours",
      sql`
      ${allCommentsCte(filter)}
      SELECT EXTRACT(HOUR FROM ("occurredAt" AT TIME ZONE ${tz}))::int AS "hour", COUNT(*) AS "count"
      FROM distinct_comments GROUP BY 1 ORDER BY 1`,
    ),
    run(
      "weekdays",
      sql`
      ${allCommentsCte(filter)}
      SELECT EXTRACT(ISODOW FROM ("occurredAt" AT TIME ZONE ${tz}))::int AS "dow", COUNT(*) AS "count"
      FROM distinct_comments GROUP BY 1 ORDER BY 1`,
    ),
    run(
      "inbox",
      sql`
      SELECT TO_CHAR((msg."createdAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE msg."messageType" = 'incoming') AS "incoming",
        COUNT(*) FILTER (WHERE msg."messageType" = 'outgoing' AND msg."senderType" = 'bot') AS "bot",
        COUNT(*) FILTER (WHERE msg."messageType" = 'outgoing' AND msg."senderType" = 'user') AS "human"
      FROM "Message" msg
      WHERE msg."workspaceId" = ${filter.workspaceId}
        AND msg."type" = 'message'
        AND msg."createdAt" >= ${from}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 60`,
    ),
    run(
      "feed",
      sql`
      SELECT e."id", e."occurredAt", e."replyChannel", e."replyType", e."status",
        e."commentText", e."deliveredAt", e."seenAt", e."clickedAt", e."failedAt",
        LEFT(e."errorDetail", 160) AS "errorDetail",
        a."name" AS "automation", a."type",
        c."fullName" AS "contactName", c."id" AS "contactId"
      FROM "CommentAutomationEvent" e
      JOIN "CommentAutomation" a ON a."id" = e."automationId"
      LEFT JOIN "Contact" c ON c."id" = e."contactId"
      WHERE e."workspaceId" = ${filter.workspaceId}
        AND e."occurredAt" >= ${from}${channelClause(filter.channel)}
      ORDER BY e."occurredAt" DESC
      LIMIT 60`,
    ),
    run(
      "link clicks",
      sql`
      SELECT ml."name", ml."url", COUNT(*) AS "clicks", COUNT(DISTINCT s."contactId") AS "people",
        MAX(s."occurredAt") AS "last"
      FROM "MagicLinkStat" s
      JOIN "MagicLink" ml ON ml."id" = s."linkId"
      WHERE s."workspaceId" = ${filter.workspaceId} AND s."occurredAt" >= ${from}
      GROUP BY ml."name", ml."url"
      ORDER BY "clicks" DESC`,
    ),
    run(
      "link totals",
      sql`
      SELECT COUNT(*) AS "clicks", COUNT(DISTINCT "contactId") AS "people"
      FROM "MagicLinkStat"
      WHERE "workspaceId" = ${filter.workspaceId} AND "occurredAt" >= ${from}`,
    ),
    run(
      "link clicks by day",
      sql`
      SELECT TO_CHAR(("occurredAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, COUNT(*) AS "clicks"
      FROM "MagicLinkStat"
      WHERE "workspaceId" = ${filter.workspaceId} AND "occurredAt" >= ${from}
      GROUP BY 1`,
    ),
  ])

  // Post thumbnails are stored as paths in ChatbotX's own file storage.
  const { storageUrl } = await resolveTenantSettings({
    workspaceId: filter.workspaceId,
  })
  const fileUrl = (path: string) =>
    ABSOLUTE_URL.test(path) ? path : getPublicFileUrl(path, storageUrl)

  const t = totals[0] ?? {}
  const ct = commentTotals[0] ?? {}

  return {
    errors,
    timezone: tz,
    totals: {
      comments: num(ct.comments),
      answered: num(ct.answered),
      unanswered: num(ct.unanswered),
      dmSent: num(t.dmSent),
      dmDelivered: num(t.dmDelivered),
      dmSeen: num(t.dmSeen),
      tapped: num(t.tapped),
      failed: num(t.failed),
      publicReplies: num(t.publicReplies),
      peopleReached: num(t.peopleReached),
      tappedTag: num(tapped[0]?.count),
      linkClicks: num(linkTotals[0]?.clicks),
      linkPeople: num(linkTotals[0]?.people),
      newContacts: num(newContacts[0]?.count),
    },
    daily: daily.map((r) => ({
      day: String(r.day),
      answeredComments: num(r.answeredComments),
      missedComments: num(r.missedComments),
      dmSent: num(r.dmSent),
      dmDelivered: num(r.dmDelivered),
      dmSeen: num(r.dmSeen),
      tapped: num(r.tapped),
      failed: num(r.failed),
      linkClicks: num(linkDaily.find((l) => l.day === r.day)?.clicks),
    })),
    links: links.map((r) => ({
      name: String(r.name),
      url: String(r.url),
      clicks: num(r.clicks),
      people: num(r.people),
      last: r.last ? new Date(String(r.last)) : null,
    })),
    automations: automations.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: String(r.type),
      isActive: Boolean(r.isActive),
      comments: num(r.comments),
      dmSent: num(r.dmSent),
      dmDelivered: num(r.dmDelivered),
      dmSeen: num(r.dmSeen),
      tapped: num(r.tapped),
      failed: num(r.failed),
      publicReplies: num(r.publicReplies),
    })),
    posts: posts.map((r) => ({
      postId: String(r.postId),
      type: r.type ? String(r.type) : null,
      comments: num(r.comments),
      answered: num(r.answered),
      dmSent: num(r.dmSent),
      tapped: num(r.tapped),
      caption: r.caption ? String(r.caption) : null,
      thumbnail: r.thumbnail ? fileUrl(String(r.thumbnail)) : null,
      permalink: r.permalink ? String(r.permalink) : null,
      lastComment: r.lastComment ? new Date(String(r.lastComment)) : null,
    })),
    words: words.map((r) => ({
      text: String(r.text),
      count: num(r.count),
      answered: num(r.answered),
    })),
    missReasons: missReasons.map((r) => ({
      reason: String(r.reason),
      count: num(r.count),
    })),
    failures: failures.map((r) => ({
      detail: String(r.detail),
      httpCode: r.httpCode ? String(r.httpCode) : null,
      count: num(r.count),
      last: r.last ? new Date(String(r.last)) : null,
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: num(hours.find((r) => num(r.hour) === hour)?.count),
    })),
    weekdays: Array.from({ length: 7 }, (_, index) => ({
      dow: index + 1,
      count: num(weekdays.find((r) => num(r.dow) === index + 1)?.count),
    })),
    inbox: inbox.map((r) => ({
      day: String(r.day),
      incoming: num(r.incoming),
      bot: num(r.bot),
      human: num(r.human),
    })),
    feed: feed.map((r) => ({
      id: String(r.id),
      occurredAt: new Date(String(r.occurredAt)),
      replyChannel: String(r.replyChannel),
      replyType: String(r.replyType),
      status: String(r.status),
      commentText: r.commentText ? String(r.commentText) : null,
      delivered: Boolean(r.deliveredAt),
      seen: Boolean(r.seenAt),
      clicked: Boolean(r.clickedAt),
      failed: Boolean(r.failedAt) || r.status === "failed",
      errorDetail: r.errorDetail ? String(r.errorDetail) : null,
      automation: String(r.automation),
      type: String(r.type),
      contactName: r.contactName ? String(r.contactName) : null,
      contactId: r.contactId ? String(r.contactId) : null,
    })),
  }
}

export type FreyaStats = Awaited<ReturnType<typeof getFreyaStats>>
