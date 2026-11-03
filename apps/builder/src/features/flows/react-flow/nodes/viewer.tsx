import {
  type FlowNode,
  type NodeType,
  nodeTypeSchema,
  shouldShowDefaultContinue,
} from "@chatbotx.io/flow-config"
import { Card, CardContent } from "@chatbotx.io/ui/components/ui/card"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { NodeToolbar, Position } from "@xyflow/react"
import { PlayCircleIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { memo, useMemo } from "react"
import { BaseHandle } from "@/components/base-handle"
import { useFlowCanvasStats } from "../canvas/flow-canvas-stats"
import { NodeStatsRow, toNodeDeliveryStats } from "../canvas/node-stats-row"
import { DynamicStepViewer } from "../steps"
import { ButtonStepViewer } from "../steps/button/viewer"
import { FlowAnalyticsStoreProvider } from "../stores/flow-analytics-store-provider"
import { FlowNodeToolbar } from "../toolbar/node-toolbar"
import { allNodesConfig } from "./node-config"
import { QuickReplySettingsHandles } from "./quick-reply-settings/quick-reply-settings-handles"

type NodeViewerProps = {
  id: string
  type: NodeType
  data: FlowNode["data"] & { forceToolbarVisible?: boolean }
}

/** Header icon tint per node type: the ManyChat card has a coloured icon tile. */
const NODE_ICON_TINT: Partial<Record<NodeType, string>> = {
  [nodeTypeSchema.enum.sendMessage]: "bg-sky-500/15 text-sky-500",
  [nodeTypeSchema.enum.performAction]: "bg-violet-500/15 text-violet-500",
  [nodeTypeSchema.enum.condition]: "bg-amber-500/15 text-amber-500",
  [nodeTypeSchema.enum.startFlow]: "bg-emerald-500/15 text-emerald-500",
  [nodeTypeSchema.enum.wait]: "bg-orange-500/15 text-orange-500",
  [nodeTypeSchema.enum.followUp]: "bg-orange-500/15 text-orange-500",
  [nodeTypeSchema.enum.sendMail]: "bg-pink-500/15 text-pink-500",
  [nodeTypeSchema.enum.splitTraffic]: "bg-teal-500/15 text-teal-500",
}

export const NodeViewer = memo((props: NodeViewerProps) => {
  const { id, type, data } = props
  const t = useTranslations()

  const nodeConfig = allNodesConfig[type]?.(t)
  const canvasStats = useFlowCanvasStats()
  const analytics = canvasStats?.stats[id] ?? null
  const isSendMessage = type === nodeTypeSchema.enum.sendMessage
  const deliveryStats = useMemo(
    () => toNodeDeliveryStats(analytics),
    [analytics],
  )
  const buttonStats = useMemo(() => {
    const clicks: Record<string, number> = {}
    for (const [buttonId, button] of Object.entries(analytics?.buttons ?? {})) {
      clicks[buttonId] = button.clicks
    }
    return clicks
  }, [analytics])

  if (!(data.details && nodeConfig)) {
    return <div>{t("flowAnalytics.nodes.notFound")}</div>
  }

  const body = (
    <CardContent className="flex flex-col gap-3 p-3">
      {"steps" in data.details &&
        data.details.steps &&
        data.details.steps.length > 0 &&
        data.details.steps.map((stepItem) => (
          <DynamicStepViewer
            data={stepItem}
            key={stepItem.id}
            nodeId={id}
            type={stepItem.stepType}
          />
        ))}

      {"quickReplies" in data.details &&
        data.details.quickReplies &&
        data.details.quickReplies.length > 0 &&
        data.details.quickReplies.map((quickReplyItem) => (
          <ButtonStepViewer data={quickReplyItem} key={quickReplyItem.id} />
        ))}

      {"quickReplySettings" in data.details && (
        <QuickReplySettingsHandles details={data.details} />
      )}

      {shouldShowDefaultContinue(type, data) && (
        <div className="relative w-full text-right text-muted-foreground text-xs">
          {/* React Flow keeps this connector on physical Position.Right. */}
          <span className="mr-4">{t("actions.continue")}</span>
          <BaseHandle id={id} position={Position.Right} type="source" />
        </div>
      )}
    </CardContent>
  )

  return (
    <>
      <div className="absolute min-h-6 w-full -translate-y-full transform">
        {data.isStartNode && (
          <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white text-xs shadow-sm">
            <PlayCircleIcon size={14} />
            {t("flowAnalytics.nodes.start")}
          </div>
        )}
      </div>

      <NodeToolbar isVisible={data.forceToolbarVisible} offset={5}>
        <FlowNodeToolbar isStartNode={data.isStartNode} nodeId={id} />
      </NodeToolbar>

      <Card className="w-72 gap-0 overflow-hidden rounded-2xl p-0 shadow-md">
        <div className="relative flex items-center gap-2.5 px-3 py-2.5">
          <BaseHandle
            id={id}
            isConnectableStart={false}
            position={Position.Left}
            type="target"
          />
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              NODE_ICON_TINT[type] ?? "bg-muted text-muted-foreground",
            )}
          >
            {nodeConfig.icon ? <nodeConfig.icon className="size-4" /> : null}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-sm leading-tight">
              {data.name}
            </span>
            <span className="truncate text-[11px] text-muted-foreground leading-tight">
              {nodeConfig.label}
            </span>
          </div>
        </div>

        {isSendMessage && canvasStats && <NodeStatsRow stats={deliveryStats} />}

        {canvasStats ? (
          <FlowAnalyticsStoreProvider
            buttonStats={buttonStats}
            delivered={deliveryStats.delivered}
          >
            {body}
          </FlowAnalyticsStoreProvider>
        ) : (
          body
        )}
      </Card>
    </>
  )
})
