"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
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
  MousePointerClickIcon,
  PlusIcon,
  SquarePenIcon,
  ZapIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { ComponentType, SVGProps } from "react"
import type { FlowTrigger, FlowTriggers } from "./flow-triggers"
import { useTriggerSheet } from "./trigger-sheet"

/**
 * The ManyChat-style "When…" card at the left of the Start node: every
 * comment rule, keyword rule and other-flow button that starts this flow,
 * each linking to its editor page, plus a menu that opens a new rule with
 * this flow already chosen as the reply. It lives in the viewport (pans and
 * zooms with the canvas) but is not a node, so nothing about it reaches the
 * saved flow.
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
  flow: { Icon: MousePointerClickIcon, color: "#0EA5E9" },
}

const triggerLineKey = (trigger: FlowTrigger) => {
  if (trigger.kind === "keyword") {
    return "flowCanvas.trigger.keyword" as const
  }
  if (trigger.kind === "button") {
    return "flowCanvas.trigger.button" as const
  }
  return trigger.postScope === "live"
    ? ("flowCanvas.trigger.commentLive" as const)
    : ("flowCanvas.trigger.comment" as const)
}

function TriggerRow({ trigger }: { trigger: FlowTrigger }) {
  const t = useTranslations()
  const { openTrigger } = useTriggerSheet()
  const channel = CHANNEL_ICONS[trigger.channel]
  const Icon = channel?.Icon ?? MessageSquareTextIcon

  let detail: string
  if (trigger.kind === "button") {
    detail = t("flowCanvas.trigger.buttonLabel", {
      label: trigger.buttonLabel ?? "",
    })
  } else if (trigger.keywords.length > 0) {
    detail = t("flowCanvas.trigger.keywords", {
      keywords: trigger.keywords.join(", "),
    })
  } else {
    detail = t("flowCanvas.trigger.anyComment")
  }

  const rowClassName = cn(
    "group flex w-full items-start gap-2.5 rounded-lg border bg-background px-3 py-2 text-start transition-colors hover:border-primary/60 hover:bg-accent",
    !trigger.isActive && "opacity-60",
  )
  const body = (
    <>
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
          <span className="truncate">
            {t(triggerLineKey(trigger), { flow: trigger.name })}
          </span>
          {!trigger.isActive && (
            <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
              {t("flowCanvas.trigger.off")}
            </span>
          )}
        </span>
        <span className="wrap-anywhere text-muted-foreground text-xs">
          {detail}
        </span>
        {trigger.kind === "comment" && (
          <span className="truncate text-[11px] text-muted-foreground/80">
            {trigger.name}
          </span>
        )}
      </span>
      <SquarePenIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </>
  )

  // A button of another flow opens that flow; a rule opens its compact
  // settings in the sheet beside the canvas.
  return trigger.kind === "button" ? (
    <Link className={rowClassName} href={trigger.href}>
      {body}
    </Link>
  ) : (
    <button
      className={rowClassName}
      onClick={() => openTrigger(trigger)}
      type="button"
    >
      {body}
    </button>
  )
}

/** "Add a trigger": each choice opens a create form with this flow pre-selected. */
function AddTriggerMenu({
  workspaceId,
  flowId,
  igVariant,
}: {
  workspaceId: string
  flowId: string
  igVariant: string
}) {
  const t = useTranslations()
  const router = useRouter()
  const base = `/space/${workspaceId}`
  const choices = [
    {
      key: "addInstagram",
      Icon: SiInstagram,
      color: "#E4405F",
      href: `${base}/ig-comments/create?variant=${igVariant}&flowId=${flowId}`,
    },
    {
      key: "addFacebook",
      Icon: SiFacebook,
      color: "#0866FF",
      href: `${base}/fb-comments/create?flowId=${flowId}`,
    },
    {
      key: "addKeyword",
      Icon: MessageSquareTextIcon,
      color: undefined,
      href: `${base}/automated-responses/create?flowId=${flowId}`,
    },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-primary/60 hover:text-foreground"
            type="button"
          >
            <PlusIcon className="size-3.5" />
            {t("flowCanvas.trigger.add")}
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.key}
            onClick={() => router.push(choice.href)}
          >
            <choice.Icon
              className="size-4"
              style={choice.color ? { color: choice.color } : undefined}
            />
            {t(`flowCanvas.trigger.${choice.key}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TriggerCard({
  triggers,
  workspaceId,
  flowId,
  startPosition,
}: {
  triggers: FlowTriggers
  workspaceId: string
  flowId: string
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
        className="nodrag nopan nowheel pointer-events-auto absolute flex flex-col gap-2 rounded-2xl border bg-card p-3 text-card-foreground shadow-md"
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

        {triggers.items.length === 0 ? (
          <p className="px-1 text-muted-foreground text-xs">
            {t("flowCanvas.trigger.empty")}
          </p>
        ) : (
          triggers.items.map((trigger) => (
            <TriggerRow
              key={`${trigger.kind}:${trigger.id}`}
              trigger={trigger}
            />
          ))
        )}

        <AddTriggerMenu
          flowId={flowId}
          igVariant={triggers.igVariant}
          workspaceId={workspaceId}
        />
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
