"use client"

import { MagicLinkAnalytics } from "@chatbotx.io/analytics-nextjs/components/magic-link-analytics"

export function MagicLinkAnalyticsClient({
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
    <MagicLinkAnalytics
      defaultSearchParams={{ workspaceId, linkId, timezone, linkName }}
    />
  )
}
