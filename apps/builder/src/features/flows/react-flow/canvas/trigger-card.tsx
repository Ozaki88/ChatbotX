"use client"

import { cn } from "@chatbotx.io/ui/lib/utils"
import {
  SiFacebook,
  SiInstagram,
  SiThreads,
  SiTiktok,
} from "@icons-pack/react-simple-icons"
import { ViewportPortal } from "@xyflow/react"
import {
  type LucideIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SquarePenIcon,
  ZapIcon,
} from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import type { ComponentType, SVGProps } from "react"
import type { FlowTrigger } from "./flow-triggers"

/**
 * The ManyChat-style "When…" card at the left of the Start node: every
 * comment rule and keyword rule that starts this flow, each linking to its
 * editor page. It lives in the viewport (pans and zooms with the canvas) but
 * is not a node, so nothing about it reaches the saved flow.
 */

export const TRIGGER_CARD_WIDTH = 288
const TRIGGER_CARD_GAP = 96
/** Vertical offset of the Start node's target handle (centre of its header). */
const START_HANDLE_Y = 30

type ChannelIcon = ComponentType<SVGProps<SVGSVGElement>> | LucideIcon

const CHANNEL_ICONS: Record<string, { Icon: ChannelIcon; color: string }> = {
  messenger: { Icon: SiFacebook, color: "#0866FF" },
  instagram: { Icon: SiInstagram, color: "#E4405F" },
  instagramFacebook: { Icon: SiInstagram, color: "#E4405F" },
  threads: { Icon: SiThreads, color: "#000000" },
  tiktok: { Icon: SiTiktok, color: "#000000" },
}

const triggerLineKey = (trigger: FlowTrigger) => {
  if (trigger.kind === "keyword") {
    return "flowCanvas.trigger.keyword" as const
  }
  return trigger.postScope === "live"
    ? ("flowCanvas.trigger.commentLive" as const)
    : ("flowCanvas.trigger.comment" as const)
}

function TriggerRow({ trigger }: { trigger: FlowTrigger }) {
  const t = useTranslations()
  const channel = CHANNEL_ICONS[trigger.channel]
  const Icon = channel?.Icon ?? MessageSquareTextIcon

  return (
    <Link
      className={cn(
        "group flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2 transition-colors hover:border-primary/60 hover:bg-accent",
        !trigger.isActive && "opacity-60",
      )}
      href={trigger.href}
    >
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: channel ? `${channel.color}1A` : undefined,
          color: channel?.color,
        }}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1 font-medium text-sm leading-tight">
          <span className="truncate">{t(triggerLineKey(trigger))}</span>
          {!trigger.isActive && (
            <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
              {t("flowCanvas.trigger.off")}
            </span>
          )}
        </span>
        <span className="wrap-anywhere text-muted-foreground text-xs">
          {trigger.keywords.length > 0
            ? t("flowCanvas.trigger.keywords", {
                keywords: trigger.keywords.join(", "),
              })
            : t("flowCanvas.trigger.anyComment")}
        </span>
        {trigger.kind === "comment" && (
          <span className="truncate text-[11px] text-muted-foreground/80">
            {trigger.name}
          </span>
        )}
      </span>
      <SquarePenIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  )
}

export function TriggerCard({
  triggers,
  workspaceId,
  startPosition,
}: {
  triggers: FlowTrigger[]
  workspaceId: string
  startPosition: { x: number; y: number } | null
}) {
  const t = useTranslations()
  if (!startPosition) {
    return null
  }

  const x = startPosition.x - TRIGGER_CARD_WIDTH - TRIGGER_CARD_GAP
  const y = startPosition.y

  return (
    <ViewportPortal>
      <div
        className="nodrag nopan pointer-events-auto absolute flex flex-col gap-2 rounded-2xl border bg-card p-3 text-card-foreground shadow-md"
        style={{
          transform: `translate(${x}px, ${y}px)`,
          width: TRIGGER_CARD_WIDTH,
        }}
      >
        <div className="flex items-center gap-2 px-1">
          <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
            <ZapIcon className="size-4" />
          </span>
          <span className="font-semibold">{t("flowCanvas.trigger.title")}</span>
        </div>

        {triggers.length === 0 ? (
          <p className="px-1 text-muted-foreground text-xs">
            {t("flowCanvas.trigger.empty")}
          </p>
        ) : (
          triggers.map((trigger) => (
            <TriggerRow
              key={`${trigger.kind}:${trigger.id}`}
              trigger={trigger}
            />
          ))
        )}

        <Link
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-primary/60 hover:text-foreground"
          href={`/space/${workspaceId}/ig-comments/create`}
        >
          <PlusIcon className="size-3.5" />
          {t("flowCanvas.trigger.addCommentRule")}
        </Link>
      </div>

      {/* The arrow from the card to the Start node's handle. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute overflow-visible text-muted-foreground"
        height={16}
        style={{
          transform: `translate(${startPosition.x - TRIGGER_CARD_GAP}px, ${y + START_HANDLE_Y - 8}px)`,
        }}
        width={TRIGGER_CARD_GAP}
      >
        <line
          stroke="currentColor"
          strokeWidth={2}
          x1={0}
          x2={TRIGGER_CARD_GAP - 10}
          y1={8}
          y2={8}
        />
        <polygon
          fill="currentColor"
          points={`${TRIGGER_CARD_GAP - 12},3 ${TRIGGER_CARD_GAP - 2},8 ${TRIGGER_CARD_GAP - 12},13`}
        />
      </svg>
    </ViewportPortal>
  )
}
