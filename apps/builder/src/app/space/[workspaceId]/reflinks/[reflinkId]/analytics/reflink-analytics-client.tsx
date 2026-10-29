"use client"

import { ReflinkAnalytics } from "@chatbotx.io/analytics-nextjs/components/reflink-analytics"

export function ReflinkAnalyticsClient({
  workspaceId,
  linkId,
  linkName,
}: {
  workspaceId: string
  linkId: string
  linkName: string
}) {
  // Some browsers (privacy settings, extensions) report no zone name; the
  // analytics routes require one, so fall back to UTC instead of failing.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  return (
    <ReflinkAnalytics
      defaultSearchParams={{ workspaceId, linkId, timezone, linkName }}
    />
  )
}
