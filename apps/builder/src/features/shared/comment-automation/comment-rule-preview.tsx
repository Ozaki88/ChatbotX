"use client"

import type { FlowNode } from "@chatbotx.io/flow-config"
import { useMemo } from "react"
import { useFormContext, useWatch } from "react-hook-form"
import { useFlows } from "@/features/flows/provider/flow-hook"
import { useWorkspaceId } from "@/hooks/routing"

/**
 * Freya fork: the phone on the right of a comment rule. It shows what the
 * commenter sees — their comment, the public reply under it, and the opening
 * DM with its buttons — read live from the form and from the first node of
 * the chosen flow. Spintax shows its first branch; variables stay as written.
 */

const SPINTAX = /\{([^{}\n]*\|[^{}\n]*)\}/g
const firstBranch = (text: string) =>
  text.replace(SPINTAX, (_, inner: string) => inner.split("|")[0] ?? "")

type Reply = {
  type?: string
  value?: string | null
  values?: { value: string }[]
}

type PreviewMessage = { text: string; buttons: string[] }

function previewFromNode(node: FlowNode | undefined): PreviewMessage[] {
  const steps = (
    node?.data as { details?: { steps?: Record<string, unknown>[] } } | undefined
  )?.details?.steps
  if (!Array.isArray(steps)) {
    return []
  }
  const messages: PreviewMessage[] = []
  for (const step of steps) {
    const buttons = Array.isArray(step.buttons)
      ? (step.buttons as { label?: string }[])
          .map((b) => b.label ?? "")
          .filter(Boolean)
      : []
    if (step.stepType === "sendText" && typeof step.text === "string") {
      messages.push({ text: step.text, buttons })
    } else if (step.stepType === "sendCard" && typeof step.title === "string") {
      const subtitle = typeof step.subtitle === "string" ? step.subtitle : ""
      messages.push({
        text: [step.title, subtitle].filter(Boolean).join("\n"),
        buttons,
      })
    } else if (
      step.stepType === "sendQuickReply" &&
      typeof step.message === "string"
    ) {
      messages.push({ text: step.message, buttons })
    }
  }
  return messages
}

export function CommentRulePreview({
  channel,
}: {
  channel: "instagram" | "facebook"
}) {
  const workspaceId = useWorkspaceId()
  const { control } = useFormContext()
  const keywords = useWatch({ control, name: "includeKeywords.value" }) as
    | string[]
    | undefined
  const publicReply = useWatch({ control, name: "publicReply" }) as
    | Reply
    | undefined
  const privateReply = useWatch({ control, name: "privateReply" }) as
    | Reply
    | undefined
  const { data: flows = [] } = useFlows(workspaceId)

  const comment = keywords?.[0] ? capitalize(keywords[0]) : "Yes"

  const publicText = useMemo(() => {
    if (publicReply?.type !== "text") {
      return publicReply?.type === "none" || !publicReply?.type
        ? null
        : `(${publicReply.type} reply)`
    }
    const raw =
      publicReply.values?.map((v) => v.value).find(Boolean) ??
      publicReply.value ??
      ""
    return raw ? firstBranch(raw) : null
  }, [publicReply])

  const dm = useMemo<PreviewMessage[]>(() => {
    if (privateReply?.type === "text") {
      return privateReply.value
        ? [{ text: firstBranch(privateReply.value), buttons: [] }]
        : []
    }
    if (privateReply?.type !== "flow" || !privateReply.value) {
      return privateReply?.type === "AIAgent"
        ? [{ text: "(the AI agent writes this reply)", buttons: [] }]
        : []
    }
    const flow = flows.find((f) => String(f.id) === String(privateReply.value))
    const version = flow?.flowVersions?.find((v) => v.isLatest)
    if (!version) {
      return []
    }
    const nodes = version.nodes as FlowNode[]
    const start =
      nodes.find((n) => String(n.id) === String(version.startNodeId)) ??
      nodes[0]
    return previewFromNode(start).map((m) => ({
      ...m,
      text: firstBranch(m.text),
    }))
  }, [privateReply, flows])

  return (
    <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-80">
      <p className="mb-2 text-muted-foreground text-xs">
        What they see on {channel === "instagram" ? "Instagram" : "Facebook"}
      </p>
      <div className="rounded-[2rem] border-4 border-zinc-800 bg-zinc-950 p-3 text-zinc-100 shadow-lg">
        <div className="mb-3 flex items-center gap-2 border-zinc-800 border-b pb-2 text-xs">
          <span className="size-6 rounded-full bg-zinc-700" />
          <span className="font-medium">Freya Sage</span>
        </div>
        <div className="flex min-h-80 flex-col gap-2 text-[13px] leading-snug">
          <p className="text-center text-[11px] text-zinc-400">
            Commented on your post or reel
          </p>
          <div className="flex justify-start">
            <span className="max-w-[85%] rounded-2xl bg-zinc-800 px-3 py-2">
              {comment}
            </span>
          </div>
          {publicText ? (
            <p className="px-1 text-[11px] text-zinc-400">
              <span className="text-zinc-300">Freya Sage</span> · {publicText}
            </p>
          ) : null}
          {dm.length === 0 ? (
            <p className="mt-6 text-center text-[11px] text-zinc-500">
              Pick a DM reply to preview it here.
            </p>
          ) : (
            dm.map((message, index) => (
              <div className="flex justify-end" key={`${index}-${message.text}`}>
                <div className="max-w-[85%] overflow-hidden rounded-2xl bg-violet-600">
                  <p className="whitespace-pre-wrap px-3 py-2">{message.text}</p>
                  {message.buttons.map((label) => (
                    <div
                      className="border-violet-500 border-t bg-violet-700 py-2 text-center font-medium"
                      key={label}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}

const capitalize = (text: string) =>
  text.length > 0 ? text[0]?.toUpperCase() + text.slice(1) : text
