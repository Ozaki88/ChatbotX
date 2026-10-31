import { describe, expect, test } from "vitest"
import { describeSharedPosts } from "../src/handlers/message/incoming-message"

describe("describeSharedPosts", () => {
  test("turns a shared reel into a line with its link", () => {
    expect(
      describeSharedPosts({
        mid: "m1",
        attachments: [
          { type: "ig_reel", payload: { url: "https://www.instagram.com/reel/abc/" } },
        ],
      } as never),
    ).toBe("📎 Shared a post: https://www.instagram.com/reel/abc/")
  })

  test("leaves ordinary media alone", () => {
    expect(
      describeSharedPosts({
        mid: "m1",
        attachments: [{ type: "image", payload: { url: "https://x/a.jpg" } }],
      } as never),
    ).toBeUndefined()
  })
})
