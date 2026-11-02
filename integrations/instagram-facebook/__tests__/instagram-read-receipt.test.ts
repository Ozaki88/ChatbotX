import { describe, expect, it } from "vitest"
import { instagramWebhookEventSchema } from "../src/schema"

// Instagram sends `read: { mid }`; only Messenger sends `read: { watermark }`.
// A schema that insisted on the watermark rejected every Instagram receipt.
describe("Instagram read receipts", () => {
  const base = {
    object: "instagram",
    entry: [
      {
        id: "17841400000000000",
        time: 1793649613,
        messaging: [
          {
            sender: { id: "1234567890" },
            recipient: { id: "17841400000000000" },
            timestamp: 1793649613000,
            read: { mid: "aWdfZAG1faXRlbToxOklHTWVzc2FnZUlEOjE" },
          },
        ],
      },
    ],
  }

  it("accepts the Instagram shape (mid only)", () => {
    const parsed = instagramWebhookEventSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.entry[0]?.messaging?.[0]?.read).toEqual({
      mid: "aWdfZAG1faXRlbToxOklHTWVzc2FnZUlEOjE",
    })
  })

  it("still accepts the Messenger shape (watermark)", () => {
    const payload = structuredClone(base)
    payload.entry[0]!.messaging[0]!.read = { watermark: 1793649613000 } as never
    expect(instagramWebhookEventSchema.safeParse(payload).success).toBe(true)
  })
})
