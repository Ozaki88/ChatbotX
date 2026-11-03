"use client"

import { createContext, useContext } from "react"

type FlowAnalyticsContextValue = {
  isAnalytics: boolean
  buttonStats: Record<string, number> // buttonId -> clicks
  /** Messages delivered by the node: the CTR denominator. */
  delivered: number
}

const FlowAnalyticsContext = createContext<FlowAnalyticsContextValue>({
  isAnalytics: false,
  buttonStats: {},
  delivered: 0,
})

export const FlowAnalyticsStoreProvider = ({
  children,
  buttonStats,
  delivered,
}: {
  children: React.ReactNode
  buttonStats: Record<string, number>
  delivered: number
}) => (
  <FlowAnalyticsContext.Provider
    value={{ isAnalytics: true, buttonStats, delivered }}
  >
    {children}
  </FlowAnalyticsContext.Provider>
)

export const useFlowAnalyticsStore = () => useContext(FlowAnalyticsContext)
