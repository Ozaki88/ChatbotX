import { zodBigintAsString } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import type { SearchParams } from "nuqs/server"
import { CreateFbCommentForm } from "@/features/fb-comments/components/create-fb-comment-form"
import { FbCommentPostsStoreProvider } from "@/features/fb-comments/provider/fb-comment-posts-store-context"
import { isLivePostTypeParam } from "@/features/shared/comment-automation/lib/live-post-type"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"

export default async function CreateFbCommentPage(props: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { data } = withWorkspaceIdSchema.safeParse(await props.params)
  if (!data) {
    return notFound()
  }

  const { postType, flowId: rawFlowId } = await props.searchParams
  const isLive = isLivePostTypeParam(postType)
  // From the flow editor's trigger card: the private reply starts that flow.
  const initialFlowId = zodBigintAsString().safeParse(rawFlowId).data ?? null

  return (
    // A Live automation has no post picker, so its posts are never fetched.
    <FbCommentPostsStoreProvider
      autoInitialize={!isLive}
      workspaceId={data.workspaceId}
    >
      <CreateFbCommentForm
        initialFlowId={initialFlowId}
        isLive={isLive}
        workspaceId={data.workspaceId}
      />
    </FbCommentPostsStoreProvider>
  )
}
