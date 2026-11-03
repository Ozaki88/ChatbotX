"use client"

import type { FlowNodeStatsResponse } from "@chatbotx.io/analytics/schemas"
import { useQuery } from "@tanstack/react-query"
import { createContext, useContext, useMemo, useState } from "react"
import { orpc } from "@/lib/orpc/query"

/**
 * Per-node delivery stats for the editor canvas, over the date range picked
 * at the top of the canvas. The ManyChat-style "Sent / Delivered / Opened /
 * Clicked" row on every Send Message node and the CTR on every button read
 * from here; the range is editor state only and is never saved with the flow.
 */

export const FLOW_STATS_RANGES = {
  "7": { days: 7 },
  "30": { days: 30 },
  "90": { days: 90 },
  all: { days: null },
} as const
export type FlowStatsRange = keyof typeof FLOW_STATS_RANGES
export const FLOW_STATS_RANGE_KEYS = Object.keys(
  FLOW_STATS_RANGES,
) as FlowStatsRange[]
export const DEFAULT_FLOW_STATS_RANGE: FlowStatsRange = "30"

const MS_PER_DAY = 86_400_000

/** Local midnight `days` days ago as an ISO instant, or undefined for all time. */
const sinceOf = (range: FlowStatsRange): string | undefined => {
  const days = FLOW_STATS_RANGES[range].days
  if (days === null) {
    return
  }
  const start = new Date(Date.now() - days * MS_PER_DAY)
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

type FlowCanvasStatsValue = {
  stats: FlowNodeStatsResponse
  range: FlowStatsRange
  setRange: (range: FlowStatsRange) => void
  isLoading: boolean
}

const FlowCanvasStatsContext = createContext<FlowCanvasStatsValue | null>(null)

export function FlowCanvasStatsProvider({
  workspaceId,
  flowId,
  children,
}: {
  workspaceId: string
  flowId: string
  children: React.ReactNode
}) {
  const [range, setRange] = useState<FlowStatsRange>(DEFAULT_FLOW_STATS_RANGE)
  // Derived once per range change so the query key stays stable across
  // re-renders within the same day.
  const since = useMemo(() => sinceOf(range), [range])

  const { data, isLoading } = useQuery({
    ...orpc.flowsAPI.privateGetFlowStatsAPI.queryOptions({
      input: { workspaceId, flowId, since },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const value = useMemo<FlowCanvasStatsValue>(
    () => ({ stats: data ?? {}, range, setRange, isLoading }),
    [data, range, isLoading],
  )

  return (
    <FlowCanvasStatsContext.Provider value={value}>
      {children}
    </FlowCanvasStatsContext.Provider>
  )
}

/** Null outside the editor canvas (the analytics page has its own data). */
export const useFlowCanvasStats = () => useContext(FlowCanvasStatsContext)
