"use client"

import { cn } from "@chatbotx.io/ui/lib/utils"
import { Panel } from "@xyflow/react"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { FLOW_STATS_RANGE_KEYS, useFlowCanvasStats } from "./flow-canvas-stats"

/** The "7 / 30 / 90 days / All time" pills at the top of the editor canvas. */
export function StatsRangeSelector() {
  const t = useTranslations()
  const canvasStats = useFlowCanvasStats()
  if (!canvasStats) {
    return null
  }
  const { range, setRange, isLoading } = canvasStats

  return (
    <Panel className="m-3" position="top-center">
      <div className="flex items-center gap-2 rounded-full border bg-card p-1 shadow-sm">
        <span className="ps-2.5 text-muted-foreground text-xs">
          {t("flowCanvas.range.label")}
        </span>
        <div className="flex">
          {FLOW_STATS_RANGE_KEYS.map((key) => (
            <button
              className={cn(
                "rounded-full px-2.5 py-1 text-xs transition-colors",
                key === range
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={key}
              onClick={() => setRange(key)}
              type="button"
            >
              {t(`flowCanvas.range.${key}`)}
            </button>
          ))}
        </div>
        <span className="w-5 pe-1 text-muted-foreground">
          {isLoading && <Loader2Icon className="size-3.5 animate-spin" />}
        </span>
      </div>
    </Panel>
  )
}
