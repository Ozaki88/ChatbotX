import {
  broadcastAnalyticsService,
  commentAutomationAnalyticsService,
  flowAnalyticsService,
  magicLinkAnalyticsService,
  refLinkAnalyticsService,
  sequenceAnalyticsService,
} from "@chatbotx.io/analytics"
import type { FlowEvenTypeMap } from "@chatbotx.io/event-bus"
import { flowEventTypeSchema } from "@chatbotx.io/flow-config"
import { scheduleTapFollowUps } from "./tap-follow-up"

export const flowListeners: Partial<FlowEvenTypeMap> = {
  [flowEventTypeSchema.enum["flow:clicked"]]: [
    {
      name: "broadcast-ops",
      handler: broadcastAnalyticsService.onClicked.bind(
        broadcastAnalyticsService,
      ),
    },
    {
      name: "sequence-ops",
      handler: sequenceAnalyticsService.onClicked.bind(
        sequenceAnalyticsService,
      ),
    },
    {
      name: "flow-ops",
      handler: flowAnalyticsService.onClicked.bind(flowAnalyticsService),
    },
    {
      name: "magic-link-stats",
      handler: magicLinkAnalyticsService.onClicked.bind(
        magicLinkAnalyticsService,
      ),
    },
    {
      name: "comment-automation-ops",
      handler: commentAutomationAnalyticsService.onClicked.bind(
        commentAutomationAnalyticsService,
      ),
    },
    {
      name: "freya-tap-follow-up",
      handler: scheduleTapFollowUps,
    },
  ],
  [flowEventTypeSchema.enum["flow:ref"]]: [
    {
      name: "ref-link-stats",
      handler: refLinkAnalyticsService.handler.bind(refLinkAnalyticsService),
    },
  ],
}
