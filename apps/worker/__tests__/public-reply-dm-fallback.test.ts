import { beforeEach, describe, expect, test, vi } from "vitest"

const mockHasFailedPrivateReply = vi.fn()

vi.mock("@chatbotx.io/analytics", () => ({
  commentAutomationAnalyticsService: {
    hasFailedPrivateReply: mockHasFailedPrivateReply,
  },
}))

const { resolvePublicReplyFallbackText } = await import(
  "../src/lib/comment-automation-anchor"
)

const publicAttributes = {
  replyToCommentId: "c1",
  commentAutomation: { automationId: "a1", replyChannel: "public" },
}

describe("resolvePublicReplyFallbackText", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("asks for a DM when the comment's DM failed", async () => {
    mockHasFailedPrivateReply.mockResolvedValue(true)

    const text = await resolvePublicReplyFallbackText(publicAttributes)

    expect(text).toMatch(/DM/)
    expect(text).not.toMatch(/[{}|]/)
    expect(mockHasFailedPrivateReply).toHaveBeenCalledWith({
      automationId: "a1",
      commentId: "c1",
    })
  })

  test("keeps the configured reply when the DM did not fail", async () => {
    mockHasFailedPrivateReply.mockResolvedValue(false)

    expect(await resolvePublicReplyFallbackText(publicAttributes)).toBeNull()
  })

  test("never touches a private reply or a plain message", async () => {
    expect(
      await resolvePublicReplyFallbackText({
        ...publicAttributes,
        commentAutomation: { automationId: "a1", replyChannel: "private" },
      }),
    ).toBeNull()
    expect(await resolvePublicReplyFallbackText(null)).toBeNull()
    expect(mockHasFailedPrivateReply).not.toHaveBeenCalled()
  })
})
