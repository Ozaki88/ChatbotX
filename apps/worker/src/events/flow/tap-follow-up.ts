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

/**
 * Freya fork: one nudge after a comment-DM button is tapped.
 *
 * A tap is the person acting, which opens Meta's 24-hour window, so a second
 * message is allowed. It leaves 20 minutes later, by which time they have
 * either opened the link or forgotten the thread; ManyChat reports about a
 * third more link clicks from exactly this nudge. One per person per day,
 * enforced by the job id, and only for taps that came from a comment
 * automation.
 */
export const TAP_FOLLOW_UP_DELAY_MS = 20 * 60 * 1000

export const TAP_FOLLOW_UP_TEXT =
  "{Did the link open for you, honey? 💛|Just checking the link worked for you, sugar 💛|Let me know if the link gave you any trouble, honey 💛} If not, reply LINK and I'll send it again."

export async function scheduleTapFollowUps(
  payloads: FlowClickedPayload[],
): Promise<void> {
  for (const payload of payloads) {
    if (!(payload.action.commentAutomationId && payload.context.contactInboxId)) {
      continue
    }
    try {
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
  occurredAt: Date
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

  const day = props.occurredAt.toISOString().slice(0, 10)
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
