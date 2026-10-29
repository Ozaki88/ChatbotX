import {
  instagramIntegrationService,
  messengerIntegrationService,
} from "@chatbotx.io/business"
import type { CommentAutomationType } from "@chatbotx.io/database/partials"
import { listInstagramMedia as listInstagramLoginMedia } from "@chatbotx.io/integration-instagram/apis/post"
import type { InstagramAuthValue } from "@chatbotx.io/integration-instagram/schema"
import type { InstagramAuthValue as InstagramFacebookAuthValue } from "@chatbotx.io/integration-instagram-facebook"
import { listInstagramMedia as listInstagramFacebookMedia } from "@chatbotx.io/integration-instagram-facebook/apis/post"
import {
  listPublishedPosts,
  listReelsPosts,
} from "@chatbotx.io/integration-messenger/apis/post"
import type { MessengerAuthValue } from "@chatbotx.io/integration-messenger/schema"
import { logger } from "@/lib/log"
import { filterIntegrationsByAccount } from "../account-filter"
import { parseGraphTime } from "./paging"
import {
  MISSED_COMMENTS_MAX_POSTS,
  MissedCommentsIntegrationNotFoundError,
} from "./types"

type RecentPost = { id: string; createdAt: number }

/**
 * The newest posts an "every post" automation watches, newest first, for a
 * missed-comments run. Comments keep arriving on posts long after they were
 * published, so posts are not cut by the scan window — only by count; each
 * post's comments are then cut by the window as usual.
 */
export async function listRecentPostIds(props: {
  type: CommentAutomationType
  workspaceId: string
  inboxId: string | null
}): Promise<string[]> {
  const posts =
    props.type === "messenger"
      ? await listRecentFacebookPosts(props)
      : await listRecentInstagramMedia({
          ...props,
          type: props.type as "instagram" | "instagramFacebook",
        })

  const seen = new Set<string>()
  return posts
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((post) => !seen.has(post.id) && seen.add(post.id))
    .slice(0, MISSED_COMMENTS_MAX_POSTS)
    .map((post) => post.id)
}

async function listRecentFacebookPosts(props: {
  workspaceId: string
  inboxId: string | null
}): Promise<RecentPost[]> {
  const integrations = filterIntegrationsByAccount(
    await messengerIntegrationService.findByWorkspaceId(props.workspaceId),
    props.inboxId,
  )
  if (integrations.length === 0) {
    throw new MissedCommentsIntegrationNotFoundError()
  }

  const posts: RecentPost[] = []
  for (const integration of integrations) {
    const auth = integration.auth as MessengerAuthValue
    // Reels live on their own edge; a Page posting only reels has an empty feed.
    for (const list of [listPublishedPosts, listReelsPosts]) {
      try {
        const items = await list({ auth, pageId: integration.pageId })
        posts.push(
          ...items.map((item) => ({
            id: item.id.includes("_")
              ? item.id
              : `${integration.pageId}_${item.id}`,
            createdAt: parseGraphTime(item.created_time),
          })),
        )
      } catch (error) {
        logger.warn(
          { err: error, pageId: integration.pageId },
          "Process missed comments: listing the Page's posts failed",
        )
      }
    }
  }
  return posts
}

async function listRecentInstagramMedia(props: {
  type: "instagram" | "instagramFacebook"
  workspaceId: string
  inboxId: string | null
}): Promise<RecentPost[]> {
  const integrations = filterIntegrationsByAccount(
    await instagramIntegrationService.findByWorkspaceId(
      props.workspaceId,
      props.type === "instagram" ? "instagram" : "facebook",
    ),
    props.inboxId,
  )
  if (integrations.length === 0) {
    throw new MissedCommentsIntegrationNotFoundError()
  }

  const media: RecentPost[] = []
  for (const integration of integrations) {
    try {
      const items =
        props.type === "instagram"
          ? await listInstagramLoginMedia({
              auth: integration.auth as InstagramAuthValue,
            })
          : await listInstagramFacebookMedia({
              auth: integration.auth as InstagramFacebookAuthValue,
            })
      media.push(
        ...items.map((item) => ({
          id: item.id,
          createdAt: parseGraphTime(item.timestamp),
        })),
      )
    } catch (error) {
      logger.warn(
        { err: error, inboxId: integration.inboxId },
        "Process missed comments: listing the account's media failed",
      )
    }
  }
  return media
}
