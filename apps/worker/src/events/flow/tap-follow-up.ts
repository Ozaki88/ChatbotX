import {
  contactInboxService,
  conversationService,
  messageService,
  queueMessageCreatedEvent,
} from "@chatbotx.io/business"
import type { ConversationModel } from "@chatbotx.io/database/types"
import type { FlowClickedPayload } from "@chatbotx.io/flow-config"
import { applySpintax } from "@chatbotx.io/utils/spintax"
import { ChatJobAction, chatQueue } from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"
import { findTappedGift, scheduleGiftFollowUps } from "./gift-follow-up"

/**
 * Freya fork: one nudge after a comment-DM button is tapped.
 *
 * A tap is the person acting, which opens Meta's 24-hour window, so a second
 * message is allowed. It leaves 2 hours later (20 minutes felt pushy to the
 * user). One per person per day, enforced by the job id, and only for taps
 * that came from a comment automation. A YES gift tap gets the gift
 * follow-ups instead (see `gift-follow-up.ts`), which start with a question.
 */
export const TAP_FOLLOW_UP_DELAY_MS = 2 * 60 * 60 * 1000

export const TAP_FOLLOW_UP_TEXT =
  "{Did the link open for you, honey? 💛|Just checking the link worked for you, sugar 💛|Let me know if the link gave you any trouble, honey 💛} If not, reply LINK and I'll send it again."

/** Optional: `FREYA_TAP_FOLLOW_UP=off` on the worker switches it off. */
const isEnabled = () =>
  !["off", "false", "0"].includes(
    (process.env.FREYA_TAP_FOLLOW_UP ?? "on").trim().toLowerCase(),
  )

export async function scheduleTapFollowUps(
  payloads: FlowClickedPayload[],
): Promise<void> {
  if (!isEnabled()) {
    return
  }
  for (const payload of payloads) {
    if (!(payload.action.commentAutomationId && payload.context.contactInboxId)) {
      continue
    }
    try {
      const gift =
        payload.action.buttonId &&
        (await findTappedGift({
          flowId: payload.action.flowId,
          workspaceId: payload.context.workspaceId,
          buttonId: payload.action.buttonId,
        }))
      if (gift) {
        await scheduleGiftFollowUps(payload)
        continue
      }
      await scheduleOne({
        workspaceId: payload.context.workspaceId,
        contactId: payload.context.contactId,
        contactInboxId: payload.context.contactInboxId,
        occurredAt: payload.occurredAt,
      })
    } catch (err) {
      logger.warn(
        { err, contactInboxId: payload.context.contactInboxId },
        "[tap-follow-up] could not schedule the follow-up",
      )
    }
  }
}

async function scheduleOne(props: {
  workspaceId: string
  contactId: string
  contactInboxId: string
  // Job payloads arrive JSON-serialized, so this can be an ISO string.
  occurredAt: Date | string
}): Promise<void> {
  const contactInbox = await contactInboxService.findByIdForWorkspace({
    id: props.contactInboxId,
    workspaceId: props.workspaceId,
  })
  const conversation = await conversationService.findDMByContact({
    workspaceId: props.workspaceId,
    contactId: props.contactId,
  })
  if (!(contactInbox && conversation)) {
    return
  }

  const text = applySpintax(TAP_FOLLOW_UP_TEXT)
  const message = await messageService.create({
    conversationId: conversation.id,
    contactInboxId: contactInbox.id,
    workspaceId: props.workspaceId,
    messageType: "outgoing" as const,
    contentType: "text" as const,
    senderType: "bot" as const,
    text,
    type: "message" as const,
    contentAttributes: { tapFollowUp: true },
    createdAt: new Date(),
  })
  queueMessageCreatedEvent(props.workspaceId, message, conversation)

  const day = new Date(props.occurredAt).toISOString().slice(0, 10)
  await chatQueue.add(
    ChatJobAction.sendChannelMessage,
    {
      type: ChatJobAction.sendChannelMessage,
      data: {
        conversation: {
          id: conversation.id,
          workspaceId: props.workspaceId,
        } as ConversationModel,
        contactInbox,
        message,
      },
    },
    {
      delay: TAP_FOLLOW_UP_DELAY_MS,
      jobId: `tap-follow-up-${contactInbox.id}-${day}`,
    },
  )
}
