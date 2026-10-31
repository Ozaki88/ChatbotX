import { db, sql } from "@chatbotx.io/database/client"
import { logger } from "./logger"

/**
 * Freya fork: a phone push (ntfy) for every comment-automation DM that fails,
 * so the owner sees a Meta restriction the moment it starts instead of on the
 * stats page hours later. Off unless `FAILED_DM_ALERT_NTFY_TOPIC` is set.
 *
 * Fire and forget: called from the analytics writes, which must never throw,
 * and a slow or down ntfy server must not hold up the reply loop.
 */

/** Failures that only mean the person was already answered — not worth a ping. */
const IGNORED_ERRORS = ["already has a reply", "Activity already replied to"]

/** Plain-language notes for the errors Meta words least clearly. */
const EXPLAINED_ERRORS: [string, string][] = [
  [
    "1893063",
    "Facebook is restricting the Page from sending messages. Wait it out; press Process missed comments once DMs deliver again.",
  ],
  ["4854002", "Confirm the Page identity in the Facebook app on your phone."],
  ["2534001", "The person archived or deleted the chat. Nothing to do."],
]

const ALERT_TIMEOUT_MS = 5000

export function alertFailedDm(props: {
  automationId: string
  commentId: string
  errorDetail?: string | null
}): void {
  const topic = process.env.FAILED_DM_ALERT_NTFY_TOPIC
  if (!topic) {
    return
  }
  if (IGNORED_ERRORS.some((text) => props.errorDetail?.includes(text))) {
    return
  }
  sendAlert({ ...props, topic }).catch((err) => {
    logger.warn(
      { err, automationId: props.automationId, commentId: props.commentId },
      "[failed-dm-alert] could not send the alert",
    )
  })
}

async function sendAlert(props: {
  automationId: string
  commentId: string
  errorDetail?: string | null
  topic: string
}): Promise<void> {
  const result = await db.execute(sql`
    SELECT a."name" AS "automation", a."type" AS "channel", e."workspaceId",
      e."commentText", e."errorDetail", c."fullName" AS "person",
      (SELECT cv."id" FROM "Conversation" cv
        WHERE cv."contactId" = e."contactId"
        ORDER BY cv."lastActivityAt" DESC NULLS LAST LIMIT 1) AS "conversationId"
    FROM "CommentAutomationEvent" e
    JOIN "CommentAutomation" a ON a."id" = e."automationId"
    LEFT JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."automationId" = ${props.automationId}
      AND e."commentId" = ${props.commentId}
      AND e."replyChannel" = 'private'
    LIMIT 1
  `)
  const row = (result.rows as Record<string, string | null>[])[0]
  const error = props.errorDetail ?? row?.errorDetail ?? "Unknown error"
  if (IGNORED_ERRORS.some((text) => error.includes(text))) {
    return
  }

  const channel = row?.channel === "messenger" ? "Facebook" : "Instagram"
  const person = row?.person ?? "Someone"
  const comment = row?.commentText ? ` commented "${row.commentText}"` : ""
  const note = EXPLAINED_ERRORS.find(([code]) => error.includes(code))?.[1]
  const space =
    process.env.NEXT_PUBLIC_BUILDER_URL && row?.workspaceId
      ? `${process.env.NEXT_PUBLIC_BUILDER_URL}/space/${row.workspaceId}`
      : undefined
  let click: string | undefined
  if (space) {
    click = row?.conversationId
      ? `${space}/inbox?conversationId=${row.conversationId}`
      : `${space}/dashboard/freya-stats`
  }

  const response = await fetch(
    process.env.FAILED_DM_ALERT_NTFY_SERVER ?? "https://ntfy.sh",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      body: JSON.stringify({
        topic: props.topic,
        title: `${channel} DM failed: ${person}`,
        message: [
          `${person}${comment} (${row?.automation ?? "automation"}).`,
          `${channel} said: ${error}`,
          note,
        ]
          .filter(Boolean)
          .join("\n"),
        tags: ["warning"],
        priority: note && error.includes("1893063") ? 4 : 3,
        ...(click ? { click } : {}),
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`ntfy answered ${response.status}`)
  }
}
