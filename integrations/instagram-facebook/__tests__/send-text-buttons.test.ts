import { describe, expect, test } from "vitest"
import { convertFlowStepText } from "../src/handlers/message/outgoing-message/send-text"

const run = (step: Record<string, unknown>) =>
  Array.from(
    convertFlowStepText({
      ctx: {} as never,
      data: {
        flowId: "f1",
        flowVersionId: "v1",
        contact: {} as never,
        step: { stepType: "sendText", ...step },
      } as never,
    } as never),
  ) as Record<string, unknown>[]

describe("Instagram text step with buttons", () => {
  test("postback buttons become quick replies on one message", () => {
    const messages = run({
      text: "Here you go, honey\nTap below 👇",
      buttons: [
        { id: "b1", label: "Berberine Gummies", buttonType: "sendMessage" },
      ],
    })

    expect(messages).toHaveLength(1)
    const [message] = messages
    expect(message?.text).toBe("Here you go, honey\nTap below 👇")
    const replies = message?.quick_replies as { title: string }[]
    expect(replies).toHaveLength(1)
    expect(replies[0]?.title).toBe("Berberine Gummies")
    expect(message?.attachment).toBeUndefined()
  })

  test("a website button becomes a card after the text", () => {
    const messages = run({
      text: "And these are my gummies.\nGrab them here 👇",
      buttons: [
        {
          id: "b1",
          label: "Get them on Amazon",
          buttonType: "openWebsite",
          beforeStep: { url: "https://example.com/x" },
        },
      ],
    })

    expect(messages).toHaveLength(2)
    expect(messages[0]?.text).toBe("And these are my gummies.\nGrab them here 👇")
    const payload = (messages[1]?.attachment as { payload: Record<string, unknown> })
      .payload
    expect(payload.template_type).toBe("generic")
    const [element] = payload.elements as {
      title: string
      buttons: { type: string; url?: string }[]
    }[]
    expect(element?.title).toBe("Grab them here 👇")
    expect(element?.buttons[0]).toMatchObject({
      type: "web_url",
      url: "https://example.com/x",
    })
  })

  test("plain text stays plain", () => {
    expect(run({ text: "hi", buttons: [] })).toEqual([{ text: "hi" }])
  })
})
