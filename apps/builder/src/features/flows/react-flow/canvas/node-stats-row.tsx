"use client"

import type { NodeResponse } from "@chatbotx.io/analytics/schemas"
import { useTranslations } from "next-intl"

/**
 * The muted "Sent / Delivered / Opened / Clicked" row under a Send Message
 * node's header: each a count and its share of the previous step, as on a
 * ManyChat node. Zeros when the range holds no events.
 */

export type NodeDeliveryStats = {
  sent: number
  delivered: number
  opened: number
  clicked: number
}

export const toNodeDeliveryStats = (
  analytics: NodeResponse | null | undefined,
): NodeDeliveryStats => ({
  sent: analytics?.node["message:sent"] ?? 0,
  delivered: analytics?.node["message:delivered"] ?? 0,
  opened: analytics?.node["message:seen"] ?? 0,
  clicked: analytics?.node["flow:clicked"]?.clicked ?? 0,
})

export const formatPercent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"

export function NodeStatsRow({ stats }: { stats: NodeDeliveryStats }) {
  const t = useTranslations()
  const cells = [
    { key: "sent", value: stats.sent, share: null },
    {
      key: "delivered",
      value: stats.delivered,
      share: formatPercent(stats.delivered, stats.sent),
    },
    {
      key: "opened",
      value: stats.opened,
      share: formatPercent(stats.opened, stats.delivered),
    },
    {
      key: "clicked",
      value: stats.clicked,
      share: formatPercent(stats.clicked, stats.delivered),
    },
  ] as const

  return (
    <div className="grid grid-cols-4 divide-x border-y bg-muted/40 text-center">
      {cells.map((cell) => (
        <div className="flex flex-col items-center py-1.5" key={cell.key}>
          <span className="font-semibold text-sm tabular-nums leading-tight">
            {cell.value.toLocaleString()}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {t(`flowCanvas.stats.${cell.key}`)}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {cell.share ?? " "}
          </span>
        </div>
      ))}
    </div>
  )
}
