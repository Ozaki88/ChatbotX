import { zodBigintAsString } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { CreateAutomatedResponseForm } from "@/features/automated-response/create-automated-response-form"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"

export default async function CreateAutomatedResponePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ folderId: string | null; flowId?: string }>
}) {
  const { data } = withWorkspaceIdSchema.safeParse(await params)
  if (!data) {
    return notFound()
  }

  const { folderId, flowId: rawFlowId } = await searchParams
  // From the flow editor's trigger card: the keyword starts that flow.
  const initialFlowId = zodBigintAsString().safeParse(rawFlowId).data ?? null

  return (
    <CreateAutomatedResponseForm
      basePath="automated-responses"
      folderId={folderId}
      initialFlowId={initialFlowId}
      type="inbound"
      workspaceId={data.workspaceId}
    />
  )
}
