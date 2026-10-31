import { beforeEach, describe, expect, test, vi } from "vitest"

const mockFindFailedPrivateReplyError = vi.fn()

vi.mock("@chatbotx.io/analytics", () => ({
  commentAutomationAnalyticsService: {
    findFailedPrivateReplyError: mockFindFailedPrivateReplyError,
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
    mockFindFailedPrivateReplyError.mockResolvedValue(
      "(#10 - 1893063) temporarily restricted",
    )

    const text = await resolvePublicReplyFallbackText(publicAttributes)

    expect(text).toMatch(/DM/)
    expect(text).not.toMatch(/[{}|]/)
    expect(mockFindFailedPrivateReplyError).toHaveBeenCalledWith({
      automationId: "a1",
      commentId: "c1",
    })
  })

  test("points a repeat commenter at the DM they already have", async () => {
    mockFindFailedPrivateReplyError.mockResolvedValue(
      "(#-1) The comment you are trying to reply to, already has a reply.",
    )

    const text = await resolvePublicReplyFallbackText(publicAttributes)

    expect(text).toMatch(/already/i)
    expect(text).not.toMatch(/[{}|]/)
  })

  test("keeps the configured reply when the DM did not fail", async () => {
    mockFindFailedPrivateReplyError.mockResolvedValue(null)

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
    expect(mockFindFailedPrivateReplyError).not.toHaveBeenCalled()
  })
})
