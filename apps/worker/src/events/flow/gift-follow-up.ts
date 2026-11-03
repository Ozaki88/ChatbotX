import { flowVersionService } from "@chatbotx.io/business"
import { db, sql } from "@chatbotx.io/database/client"
import type { FlowClickedPayload } from "@chatbotx.io/flow-config"
import {
  IntegrationJobAction,
  integrationQueue,
  ScheduleJobData,
  type ScheduleJobFreyaGiftFollowUp,
  scheduleQueue,
} from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"

/**
 * Freya fork: two follow-ups after someone picks a YES gift.
 *
 * - 3h: they have not opened the product link yet → a short reason to buy
 *   their gift, with the link again.
 * - 20h: they did open it → "did you get a look?" plus one other product.
 *
 * The tap opened Meta's 24-hour window, so both stay inside it. Each job
 * decides at send time (clicked or not), so nobody gets both. The messages
 * live in the flow named `GIFT_FOLLOW_UP_FLOW_NAME`, one node per stage and
 * gift, named "3h · jupi", "20h · book" and so on; the gift is read from the
 * tapped button's `picked-<gift>` tag. No such flow or node → nothing is sent.
 */
export const GIFT_FOLLOW_UP_FLOW_NAME = "Gift follow-ups"

const STAGE_DELAY_MS = {
  "3h": 3 * 60 * 60 * 1000,
  "20h": 20 * 60 * 60 * 1000,
} as const

/** Margin under Meta's 24 hours, in case the job runs late. */
const WINDOW_MS = 23.5 * 60 * 60 * 1000

const PICK_TAG_PREFIX = "picked-"

type GiftFollowUpData = ScheduleJobFreyaGiftFollowUp["data"]

/** Same off switch as the 20-minute nudge: `FREYA_TAP_FOLLOW_UP=off`. */
export async function scheduleGiftFollowUps(
  payload: FlowClickedPayload,
): Promise<void> {
  const { action, context } = payload
  if (
    action.clickType !== "button" ||
    !action.buttonId ||
    !context.contactInboxId ||
    !context.conversationId
  ) {
    return
  }
  const tappedAt = new Date(payload.occurredAt)
  const day = tappedAt.toISOString().slice(0, 10)

  for (const stage of ["3h", "20h"] as const) {
    const data: GiftFollowUpData = {
      stage,
      workspaceId: context.workspaceId,
      contactId: context.contactId,
      contactInboxId: context.contactInboxId,
      conversationId: context.conversationId,
      flowId: action.flowId,
      buttonId: action.buttonId,
      tappedAt: tappedAt.toISOString(),
    }
    await scheduleQueue.add(
      ScheduleJobData.freyaGiftFollowUp,
      { type: ScheduleJobData.freyaGiftFollowUp, data },
      {
        delay: STAGE_DELAY_MS[stage],
        jobId: `gift-follow-up-${stage}-${context.contactInboxId}-${day}`,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    )
  }
}

export async function runGiftFollowUp(data: GiftFollowUpData): Promise<void> {
  const log = { ...data }
  if (Date.now() - new Date(data.tappedAt).getTime() > WINDOW_MS) {
    logger.info(log, "[gift-follow-up] outside the 24h window, skipping")
    return
  }

  const tappedVersion = await flowVersionService.findForButtonPayload({
    flowId: data.flowId,
    workspaceId: data.workspaceId,
  })
  const gift = findPickedGift(tappedVersion?.nodes, data.buttonId)
  if (!gift) {
    return
  }

  const clicked = await hasClickedSince(data.contactId, data.tappedAt)
  if ((data.stage === "3h") === clicked) {
    logger.info(
      { ...log, gift, clicked },
      "[gift-follow-up] does not apply, skipping",
    )
    return
  }

  const flow = await db.query.flowModel.findFirst({
    where: {
      workspaceId: data.workspaceId,
      name: GIFT_FOLLOW_UP_FLOW_NAME,
      active: true,
    },
  })
  const version = flow
    ? await flowVersionService.findForButtonPayload({
        flowId: flow.id,
        workspaceId: data.workspaceId,
      })
    : undefined
  const nodeName = `${data.stage} · ${gift}`
  const node = asNodes(version?.nodes).find(
    (n) => n.data?.name?.trim().toLowerCase() === nodeName,
  )
  if (!(flow && node)) {
    logger.warn(
      { ...log, nodeName },
      "[gift-follow-up] no follow-up node for this gift, skipping",
    )
    return
  }

  await integrationQueue.add(IntegrationJobAction.sendFlow, {
    type: IntegrationJobAction.sendFlow,
    data: {
      conversationId: data.conversationId,
      contactInboxId: data.contactInboxId,
      flowId: flow.id,
      nodeId: node.id,
    },
  })
  logger.info({ ...log, gift, nodeId: node.id }, "[gift-follow-up] sent")
}

type LooseNode = {
  id: string
  data?: {
    name?: string
    details?: {
      steps?: {
        buttons?: {
          id: string
          steps?: { stepType?: string; tags?: string[] }[]
        }[]
      }[]
    }
  }
}

const asNodes = (nodes: unknown): LooseNode[] =>
  Array.isArray(nodes) ? (nodes as LooseNode[]) : []

/** "jupi" for a button that tags `picked-jupi`, else undefined. */
function findPickedGift(nodes: unknown, buttonId: string): string | undefined {
  for (const node of asNodes(nodes)) {
    for (const step of node.data?.details?.steps ?? []) {
      const button = step.buttons?.find((b) => b.id === buttonId)
      if (!button) {
        continue
      }
      const tag = button.steps
        ?.flatMap((s) => (s.stepType === "addContactTag" ? (s.tags ?? []) : []))
        .find((t) => t.startsWith(PICK_TAG_PREFIX))
      return tag?.slice(PICK_TAG_PREFIX.length).toLowerCase()
    }
  }
  return
}

async function hasClickedSince(
  contactId: string,
  since: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM "MagicLinkStat"
    WHERE "contactId" = ${contactId} AND "occurredAt" >= ${since}::timestamptz
    LIMIT 1
  `)
  return rows.rows.length > 0
}
