import { db, sql } from "@chatbotx.io/database/client"
import { logger } from "../../lib/logger"

/**
 * Freya fork: one phone push every morning with yesterday's numbers, so the
 * dashboard only needs opening when something is off. Same ntfy topic as the
 * failed-DM alerts; off unless `FAILED_DM_ALERT_NTFY_TOPIC` is set.
 */
const SUMMARY_TIMEZONE = process.env.FREYA_SUMMARY_TIMEZONE ?? "America/Chicago"
const ALERT_TIMEOUT_MS = 5000

type Row = Record<string, string | number | null>

export async function freyaMorningSummary(): Promise<void> {
  const topic = process.env.FAILED_DM_ALERT_NTFY_TOPIC
  if (!topic) {
    return
  }

  // "Yesterday" in the workspace's own day, not UTC's.
  const dayExpr = sql`(e."occurredAt" AT TIME ZONE ${SUMMARY_TIMEZONE})::date`
  const yesterday = sql`((now() AT TIME ZONE ${SUMMARY_TIMEZONE})::date - 1)`

  const [events, misses, reasons] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(DISTINCT e."commentId") AS "comments",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."deliveredAt" IS NOT NULL) AS "delivered",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND e."clickedAt" IS NOT NULL) AS "taps",
        COUNT(*) FILTER (WHERE e."replyChannel" = 'private' AND (e."status" = 'failed' OR e."failedAt" IS NOT NULL)) AS "failed"
      FROM "CommentAutomationEvent" e
      WHERE ${dayExpr} = ${yesterday}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS "missed" FROM "CommentAutomationMiss" e
      WHERE ${dayExpr} = ${yesterday}
        AND NOT EXISTS (
          SELECT 1 FROM "CommentAutomationEvent" x WHERE x."commentId" = e."commentId"
        )
    `),
    db.execute(sql`
      SELECT
        CASE
          WHEN e."errorDetail" ILIKE '%already has a reply%' THEN 'repeat commenters'
          WHEN e."errorDetail" ILIKE '%1893063%' THEN 'Facebook block'
          ELSE 'other'
        END AS "reason",
        COUNT(*) AS "count"
      FROM "CommentAutomationEvent" e
      WHERE ${dayExpr} = ${yesterday}
        AND e."replyChannel" = 'private'
        AND (e."status" = 'failed' OR e."failedAt" IS NOT NULL)
      GROUP BY 1 ORDER BY 2 DESC
    `),
  ])

  const num = (value: unknown) => Number(value ?? 0)
  const totals = (events.rows[0] ?? {}) as Row
  const missed = num((misses.rows[0] as Row | undefined)?.missed)
  const failed = num(totals.failed)
  const reasonText = (reasons.rows as Row[])
    .map((r) => `${num(r.count)} ${r.reason}`)
    .join(", ")

  const lines = [
    `${num(totals.comments)} comments · ${num(totals.delivered)} DMs delivered · ${num(totals.taps)} taps`,
    failed > 0 ? `${failed} DMs didn't go out (${reasonText})` : "No failed DMs",
    missed > 0 ? `${missed} comments had no keyword` : undefined,
  ].filter(Boolean)

  const space = process.env.NEXT_PUBLIC_BUILDER_URL
  const workspaceId = process.env.FREYA_WORKSPACE_ID
  const click =
    space && workspaceId
      ? `${space}/space/${workspaceId}/dashboard/freya-stats`
      : undefined

  try {
    const response = await fetch(
      process.env.FAILED_DM_ALERT_NTFY_SERVER ?? "https://ntfy.sh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
        body: JSON.stringify({
          topic,
          title: "Freya yesterday",
          message: lines.join("\n"),
          tags: ["sunrise"],
          priority: failed > num(totals.delivered) ? 4 : 3,
          ...(click ? { click } : {}),
        }),
      },
    )
    if (!response.ok) {
      throw new Error(`ntfy answered ${response.status}`)
    }
    logger.info({ lines }, "[freya-morning-summary] sent")
  } catch (err) {
    logger.warn({ err }, "[freya-morning-summary] could not send the summary")
  }
}
