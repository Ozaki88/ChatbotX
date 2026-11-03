import "server-only"

import {
  automatedResponseService,
  commentAutomationService,
} from "@chatbotx.io/business"

/**
 * What starts a flow, for the trigger card at the left of the editor canvas:
 * every comment automation whose private reply runs the flow, and every
 * inbound keyword rule that hands off to it. Each carries the href of its
 * editor page.
 */
export type FlowTrigger = {
  id: string
  kind: "comment" | "keyword"
  /** `messenger`, `instagram`, `instagramFacebook`, `threads`, `tiktok`, or `inbound`. */
  channel: string
  name: string
  isActive: boolean
  /** Match words, in the order the rule stores them. Empty when any comment matches. */
  keywords: string[]
  /** Comment rules only: which posts it watches. */
  postScope: "all" | "live" | "posts" | null
  href: string
}

const COMMENT_RULE_PATHS: Record<string, string> = {
  messenger: "fb-comments",
  instagram: "ig-comments",
  instagramFacebook: "ig-comments",
  threads: "threads-comments",
  tiktok: "tiktok-comments",
}

const postScopeOf = (post: { type: string }): FlowTrigger["postScope"] => {
  if (post.type === "live") {
    return "live"
  }
  return post.type === "postIds" ? "posts" : "all"
}

export async function listFlowTriggers(input: {
  workspaceId: string
  flowId: string
}): Promise<FlowTrigger[]> {
  const [commentRules, keywordRules] = await Promise.all([
    commentAutomationService.listByReplyFlow(input),
    automatedResponseService.listByFlow(input),
  ])
  const base = `/space/${input.workspaceId}`

  return [
    ...commentRules.map(
      (rule): FlowTrigger => ({
        id: rule.id,
        kind: "comment",
        channel: rule.type,
        name: rule.name,
        isActive: rule.isActive,
        keywords:
          rule.includeKeywords.type === "equal" ||
          rule.includeKeywords.type === "contain"
            ? rule.includeKeywords.value
            : [],
        postScope: postScopeOf(rule.post),
        href: `${base}/${COMMENT_RULE_PATHS[rule.type] ?? "fb-comments"}/${rule.id}`,
      }),
    ),
    ...keywordRules.map(
      (rule): FlowTrigger => ({
        id: rule.id,
        kind: "keyword",
        channel: rule.type,
        name: rule.keywords.join(", "),
        isActive: rule.status,
        keywords: rule.keywords,
        postScope: null,
        href:
          rule.type === "inbound"
            ? `${base}/automated-responses/${rule.id}/edit`
            : `${base}/page-automated-responses/${rule.id}/edit`,
      }),
    ),
  ]
}
