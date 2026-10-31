import {
  type ButtonStepProps,
  buttonTypes,
  type SendTextStepSchema,
} from "@chatbotx.io/flow-config"
import type { SendFlowStepProps } from "@chatbotx.io/sdk"
import type {
  InstagramAuthValue,
  InstagramMessageAttachment,
  InstagramSendMessage,
} from "../../../schema"
import { convertButtons } from "./send-button"
import { convertQuickReplies } from "./send-quick-reply"

/** Instagram shows at most 20 characters on a quick reply chip. */
const QUICK_REPLY_TITLE_MAX = 20
/** Generic template title limit (Meta docs). */
const CARD_TITLE_MAX = 80

/**
 * A text step with buttons used to go out as a Messenger "button template".
 * Instagram accepts it but shows only the text: the one template Instagram
 * renders is the generic card, so every button was invisible and taps sat at
 * ~2% of delivered. Checked in the account's own inbox on 2026-10-31.
 *
 * So on Instagram the step becomes what Instagram does draw:
 * - postback buttons → quick replies under the text (one message, which is
 *   all a comment's private reply is allowed; a tap is the person replying,
 *   so it also opens the 24 h window for the next step);
 * - any website button → the text, then one generic card holding every
 *   button as a real `web_url` / `postback` button.
 */
export function* convertFlowStepText(
  props: SendFlowStepProps<InstagramAuthValue, SendTextStepSchema>,
): Generator<InstagramMessageAttachment | InstagramSendMessage> {
  const {
    data: { step },
  } = props
  if (step.buttons.length === 0) {
    yield {
      text: step.text,
    }
    return
  }

  const buttonProps = {
    flowId: props.data.flowId,
    flowVersionId: props.data.flowVersionId,
    metadata: props.data.metadata,
  }

  const hasWebsiteButton = step.buttons.some(
    (button: ButtonStepProps) =>
      button.buttonType === buttonTypes.enum.openWebsite,
  )

  if (!hasWebsiteButton) {
    yield {
      text: step.text,
      quick_replies: convertQuickReplies({
        ...buttonProps,
        buttons: step.buttons,
      }).map((reply) => ({
        ...reply,
        title: reply.title?.slice(0, QUICK_REPLY_TITLE_MAX),
      })),
    }
    return
  }

  yield { text: step.text }
  yield {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [
          {
            title: cardTitle(step.text, step.buttons),
            buttons: convertButtons({ ...buttonProps, buttons: step.buttons }),
          },
        ],
      },
    },
  }
}

// The card repeats nothing: its title is the last line of the text (the call
// to action an author writes right above the buttons), or the first button's
// label when the text has no such line.
function cardTitle(text: string, buttons: ButtonStepProps[]): string {
  const lastLine = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1)
  return (lastLine ?? buttons[0]?.label ?? "👇").slice(0, CARD_TITLE_MAX)
}
