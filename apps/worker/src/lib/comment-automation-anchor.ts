import { commentAutomationAnalyticsService } from "@chatbotx.io/analytics"
import type { CommentAutomationReplyChannel } from "@chatbotx.io/database/partials"
import { applySpintax } from "@chatbotx.io/utils/spintax"
import { logger } from "./logger"

/**
 * Stamped on a comment-automation reply `Message` by `postPublicCommentReply`,
 * and read back in the chat worker once the send has actually been attempted.
 *
 * It exists because the two halves of a public reply live in different queues:
 * the integration worker writes the `Message` row and the analytics event
 * (optimistically `sent`), while the Graph API call happens later in
 * `sendMessageToChannel`. Without the anchor the chat worker has no way to name
 * the event row it just invalidated, and a revoked page token would show on the
 * dashboard as 100% delivered with an empty Error Logs panel.
 */
export type CommentAutomationAnchor = {
  automationId: string
  replyChannel: CommentAutomationReplyChannel
}

/** `Message.contentAttributes` as stored: an open jsonb bag. */
type MessageLikeContentAttributes = Record<string, unknown> | null

/**
 * The anchor on an outgoing message, or `null` for any message that is not a
 * comment-automation reply — which is the overwhelming majority of sends, so
 * this stays a cheap shape check rather than a schema parse.
 */
export function readCommentAutomationAnchor(
  contentAttributes: MessageLikeContentAttributes | undefined,
): (CommentAutomationAnchor & { commentId: string }) | null {
  const anchor = contentAttributes?.commentAutomation
  const commentId = contentAttributes?.replyToCommentId
  if (!anchor || typeof anchor !== "object" || typeof commentId !== "string") {
    return null
  }

  const { automationId, replyChannel } = anchor as Partial<
    Record<keyof CommentAutomationAnchor, unknown>
  >
  if (typeof automationId !== "string" || automationId === "") {
    return null
  }
  if (replyChannel !== "public" && replyChannel !== "private") {
    return null
  }

  return { automationId, replyChannel, commentId }
}

/**
 * What a public reply says instead of "check your DMs" when the DM it points
 * to was refused (Instagram declines about one private reply in four, and a
 * restricted Page declines all of them). A DM the person starts themselves is
 * not a private reply, so the YES keyword rule can answer it.
 */
export const DM_FAILED_PUBLIC_REPLY =
  "{Send me a quick DM saying YES and I'll send it right over 💛|Pop me a DM with YES, honey, and it's all yours 💛|DM me YES and I'll send it straight to you 💛}"

/**
 * The text a public comment-automation reply should carry at send time: the
 * fallback when the same automation's DM to this comment failed, otherwise
 * `null` (send as written). Only public replies are touched.
 */
export async function resolvePublicReplyFallbackText(
  contentAttributes: MessageLikeContentAttributes | undefined,
): Promise<string | null> {
  const anchor = readCommentAutomationAnchor(contentAttributes)
  if (!anchor || anchor.replyChannel !== "public") {
    return null
  }

  const failed = await commentAutomationAnalyticsService.hasFailedPrivateReply(
    { automationId: anchor.automationId, commentId: anchor.commentId },
  )
  return failed ? applySpintax(DM_FAILED_PUBLIC_REPLY) : null
}

/**
 * Marks the event a comment-automation dispatch opened as delivered, once the
 * channel has accepted the send.
 *
 * The mirror image of {@link settleCommentAutomationFailure} and swallows its
 * own failures for the same reason: this runs on the success path of a send the
 * customer has already received, and analytics bookkeeping must never turn a
 * delivered reply into a job failure.
 */
export async function settleCommentAutomationDelivered(props: {
  contentAttributes: MessageLikeContentAttributes | undefined
  occurredAt?: Date
}): Promise<void> {
  const anchor = readCommentAutomationAnchor(props.contentAttributes)
  if (!anchor) {
    return
  }

  try {
    await commentAutomationAnalyticsService.markDelivered({
      automationId: anchor.automationId,
      commentId: anchor.commentId,
      replyChannel: anchor.replyChannel,
      occurredAt: props.occurredAt ?? new Date(),
    })
  } catch (err) {
    logger.error(
      {
        err,
        automationId: anchor.automationId,
        commentId: anchor.commentId,
        replyChannel: anchor.replyChannel,
      },
      "Failed to settle a comment automation event after a successful send",
    )
  }
}

/**
 * Flips the optimistic `sent` event a comment-automation dispatch opened to
 * `failed`, once the channel send has terminally failed.
 *
 * Only call this on the final BullMQ attempt: an intermediate failure is about
 * to be retried, and marking it `failed` would put a row in Error Logs for a
 * reply that ends up being delivered. `replyText` is deliberately not passed —
 * `settleEvent` is a partial update, so the text the send was carrying survives
 * and the Error Logs row can show what the customer never received.
 *
 * Swallows its own failures: this runs inside the send handler's catch block,
 * which still has to rethrow so BullMQ records the job failure. Bookkeeping
 * must never be able to replace the real error.
 */
export async function settleCommentAutomationFailure(props: {
  contentAttributes: MessageLikeContentAttributes | undefined
  errorDetail: string
}): Promise<void> {
  const anchor = readCommentAutomationAnchor(props.contentAttributes)
  if (!anchor) {
    return
  }

  try {
    await commentAutomationAnalyticsService.settleEvent({
      automationId: anchor.automationId,
      commentId: anchor.commentId,
      replyChannel: anchor.replyChannel,
      status: "failed",
      errorDetail: props.errorDetail,
    })
  } catch (err) {
    logger.error(
      {
        err,
        automationId: anchor.automationId,
        commentId: anchor.commentId,
        replyChannel: anchor.replyChannel,
      },
      "Failed to settle a comment automation event after a send failure",
    )
  }
}
