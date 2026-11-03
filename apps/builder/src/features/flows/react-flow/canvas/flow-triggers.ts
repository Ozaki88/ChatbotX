import "server-only"

import {
  automatedResponseService,
  commentAutomationService,
  flowService,
} from "@chatbotx.io/business"
import type {
  CommentIncludeKeywords,
  CommentReply,
} from "@chatbotx.io/database/partials"

/**
 * What starts a flow, for the trigger card at the left of the editor canvas:
 * every comment automation whose private reply runs the flow, every inbound
 * keyword rule that hands off to it, and every button of another flow that
 * starts it. Each carries the href of its editor page.
 */
export type FlowTrigger = {
  id: string
  kind: "comment" | "keyword" | "button"
  /** `messenger`, `instagram`, `instagramFacebook`, `threads`, `tiktok`, `inbound`, or `flow`. */
  channel: string
  /** The rule's name, or for a button trigger the other flow's name. */
  name: string
  isActive: boolean
  /** Match words, in the order the rule stores them. Empty when any comment matches. */
  keywords: string[]
  /** Comment rules only: which posts it watches. */
  postScope: "all" | "live" | "posts" | null
  /** Button triggers only: the button's label. */
  buttonLabel: string | null
  href: string
  /** Comment rules only: the stored match settings, edited by the trigger sheet. */
  includeKeywords: CommentIncludeKeywords | null
  /** Comment rules only: the public reply under the comment. */
  publicReply: CommentReply | null
  /** Comment rules on chosen posts: how many. */
  postCount: number
  /** Keyword rules only: the folder, carried through an update. */
  folderId: string | null
}

export type FlowTriggers = {
  items: FlowTrigger[]
  /** Query string for a new Instagram rule: the connection type in use. */
  igVariant: string
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
}): Promise<FlowTriggers> {
  const [commentRules, keywordRules, buttons, igVariant] = await Promise.all([
    commentAutomationService.listByReplyFlow(input),
    automatedResponseService.listByFlow(input),
    flowService.listButtonsStartingFlow(input),
    commentAutomationService.findIgVariantInUse(input.workspaceId),
  ])
  const base = `/space/${input.workspaceId}`

  const items: FlowTrigger[] = [
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
        buttonLabel: null,
        href: `${base}/${COMMENT_RULE_PATHS[rule.type] ?? "fb-comments"}/${rule.id}`,
        includeKeywords: rule.includeKeywords,
        publicReply: rule.publicReply,
        postCount: rule.post.type === "postIds" ? rule.post.value.length : 0,
        folderId: null,
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
        buttonLabel: null,
        href:
          rule.type === "inbound"
            ? `${base}/automated-responses/${rule.id}/edit`
            : `${base}/page-automated-responses/${rule.id}/edit`,
        includeKeywords: null,
        publicReply: null,
        postCount: 0,
        folderId: rule.folderId,
      }),
    ),
    ...buttons.map(
      (button, index): FlowTrigger => ({
        id: `${button.flowId}:${index}`,
        kind: "button",
        channel: "flow",
        name: button.flowName,
        isActive: true,
        keywords: [],
        postScope: null,
        buttonLabel: button.buttonLabel,
        href: `${base}/flows/${button.flowId}`,
        includeKeywords: null,
        publicReply: null,
        postCount: 0,
        folderId: null,
      }),
    ),
  ]

  return { items, igVariant: igVariant ?? "instagramFacebook" }
}
