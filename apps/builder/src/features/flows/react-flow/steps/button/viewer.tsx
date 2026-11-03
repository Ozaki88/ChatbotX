import { type ButtonStepProps, buttonTypes } from "@chatbotx.io/flow-config"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { Position } from "@xyflow/react"
import { useTranslations } from "next-intl"
import { BaseHandle } from "@/components/base-handle"
import { useFlowAnalyticsStore } from "../../stores/flow-analytics-store-provider"

type ButtonStepViewerProps = {
  data: ButtonStepProps
}

/** "CTR 12%": taps of this button over the node's delivered messages. */
const formatCtr = (clicks: number, delivered: number): string =>
  delivered > 0 ? `${Math.round((clicks / delivered) * 100)}%` : "—"

export const ButtonStepViewer = (props: ButtonStepViewerProps) => {
  const { data } = props
  const t = useTranslations()
  const { isAnalytics, buttonStats, delivered } = useFlowAnalyticsStore()
  const clicks = buttonStats[data.id] ?? 0
  const hasRouteHandle =
    data.buttonType === buttonTypes.enum.sendMessage ||
    data.buttonType === buttonTypes.enum.performAction ||
    data.buttonType === buttonTypes.enum.startAnotherNode ||
    data.buttonType === buttonTypes.enum.openMiniApp ||
    data.buttonType === null

  return (
    <div className="relative flex items-center gap-2">
      <div
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm",
          hasRouteHandle && "pe-6",
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {data.label}
        </span>
        {isAnalytics && (
          <span
            className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums"
            title={t("flowCanvas.stats.ctrTitle", { clicks, delivered })}
          >
            {t("flowCanvas.stats.ctr", { ctr: formatCtr(clicks, delivered) })}
          </span>
        )}
        {/* React Flow routes from physical Position.Right, so this offset must stay physical. */}
        {hasRouteHandle && (
          <BaseHandle
            className={cn("right-2!", !!data.buttonType && "bg-red-300")}
            id={data.id}
            position={Position.Right}
            type="source"
          />
        )}
      </div>
    </div>
  )
}

type ButtonGroupViewerProps = {
  data: ButtonStepProps[]
}

export const ButtonGroupViewer = (props: ButtonGroupViewerProps) => {
  const { data } = props

  return (
    <div className="flex flex-1 flex-col gap-1.5 bg-muted/40 px-2 py-2">
      {data.map((button) => (
        <ButtonStepViewer data={button} key={button.id} />
      ))}
    </div>
  )
}

export const OnSuccessStepViewer = (props: ButtonStepViewerProps) => {
  const { data } = props
  const t = useTranslations()

  return (
    <div className="relative flex items-center justify-end gap-2 text-green-500 text-xs">
      {/* React Flow keeps the connector and its clearance on the physical right edge. */}
      <div className="mr-4">{t("actions.onSuccess")}</div>
      <BaseHandle
        className="transform-none! top-0.5! border-green-500!"
        id={data.id}
        onConnectedClassName="bg-green-500!"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

export const OnSkipStepViewer = (props: ButtonStepViewerProps) => {
  const { data } = props
  const t = useTranslations()

  return (
    <div className="relative flex items-center justify-end gap-2 text-xs text-yellow-500">
      {/* React Flow keeps the connector and its clearance on the physical right edge. */}
      <div className="mr-4">{t("actions.onSkip")}</div>
      <BaseHandle
        className="transform-none! top-0.5! border-yellow-500!"
        id={data.id}
        onConnectedClassName="bg-yellow-500!"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

export const OnFailureStepViewer = (props: ButtonStepViewerProps) => {
  const { data } = props
  const t = useTranslations()

  return (
    <div className="relative flex items-center justify-end gap-2 text-red-500 text-xs">
      {/* React Flow keeps the connector and its clearance on the physical right edge. */}
      <div className="mr-4">{t("actions.onFailure")}</div>
      <BaseHandle
        className="transform-none! top-0.5! border-red-500!"
        id={data.id}
        onConnectedClassName="bg-red-500!"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}
