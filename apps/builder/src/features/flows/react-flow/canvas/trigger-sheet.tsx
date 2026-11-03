"use client"

import type {
  CommentIncludeKeywords,
  CommentReply,
} from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@chatbotx.io/ui/components/ui/sheet"
import { Switch } from "@chatbotx.io/ui/components/ui/switch"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { SiFacebook, SiInstagram } from "@icons-pack/react-simple-icons"
import {
  ExternalLinkIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  createContext,
  type KeyboardEvent,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import { toast } from "sonner"
import { enableAutomatedResponseAction } from "@/features/automated-response/actions/enable-automated-response-action"
import { updateAutomatedResponseAction } from "@/features/automated-response/actions/update-automated-response-action"
import { client } from "@/lib/orpc/orpc"
import type { FlowTrigger } from "./flow-triggers"

/**
 * The compact trigger editor beside the canvas: what a ManyChat trigger
 * shows when clicked. On/off, which posts, the words that match, the public
 * reply and the flow it sends; everything else stays on the full settings
 * page. Saving re-reads the page so the card updates.
 */

type TriggerSheetValue = {
  openTrigger: (trigger: FlowTrigger) => void
}

const TriggerSheetContext = createContext<TriggerSheetValue>({
  openTrigger: () => undefined,
})

const TriggerStateContext = createContext<{
  trigger: FlowTrigger | null
  close: () => void
}>({ trigger: null, close: () => undefined })

export function TriggerSheetProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [trigger, setTrigger] = useState<FlowTrigger | null>(null)
  const value = useMemo(() => ({ openTrigger: setTrigger }), [])
  const state = useMemo(
    () => ({ trigger, close: () => setTrigger(null) }),
    [trigger],
  )
  return (
    <TriggerSheetContext.Provider value={value}>
      <TriggerStateContext.Provider value={state}>
        {children}
      </TriggerStateContext.Provider>
    </TriggerSheetContext.Provider>
  )
}

export const useTriggerSheet = () => useContext(TriggerSheetContext)

type MatchType = CommentIncludeKeywords["type"]
const MATCH_TYPES: MatchType[] = ["contain", "equal", "all", "mentions"]

/** Chips for the words a comment or DM must carry. */
function WordChips({
  words,
  onChange,
  hint,
}: {
  words: string[]
  onChange: (words: string[]) => void
  hint: string
}) {
  const [draft, setDraft] = useState("")

  const commit = () => {
    const next = draft
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w && !words.includes(w))
    if (next.length > 0) {
      onChange([...words, ...next])
    }
    setDraft("")
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault()
      commit()
    } else if (event.key === "Backspace" && draft === "" && words.length > 0) {
      onChange(words.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5 rounded-lg border bg-background p-2">
        {words.map((word) => (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 ps-2.5 pe-1 font-medium text-primary text-xs"
            key={word}
          >
            {word}
            <button
              aria-label={`Remove ${word}`}
              className="rounded-full p-0.5 hover:bg-primary/20"
              onClick={() => onChange(words.filter((w) => w !== word))}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <Input
          className="h-7 min-w-24 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          value={draft}
        />
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  )
}

const publicReplyTexts = (reply: CommentReply | null): string[] =>
  reply?.type === "text"
    ? (reply.values?.map((v) => v.value) ?? [reply.value ?? ""])
    : []

function CommentRuleEditor({
  trigger,
  workspaceId,
  flowName,
  onSaved,
}: {
  trigger: FlowTrigger
  workspaceId: string
  flowName: string
  onSaved: () => void
}) {
  const t = useTranslations()
  const [isActive, setIsActive] = useState(trigger.isActive)
  const [matchType, setMatchType] = useState<MatchType>(
    trigger.includeKeywords?.type ?? "all",
  )
  const [words, setWords] = useState<string[]>(
    trigger.includeKeywords?.value ?? [],
  )
  const initialTexts = publicReplyTexts(trigger.publicReply)
  const [replyText, setReplyText] = useState(initialTexts[0] ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const isInstagram = trigger.channel !== "messenger"

  let postsLabel = t("flowCanvas.sheet.postsAll")
  if (trigger.postScope === "live") {
    postsLabel = t("flowCanvas.sheet.postsLive")
  } else if (trigger.postScope === "posts") {
    postsLabel = t("flowCanvas.sheet.postsChosen", { count: trigger.postCount })
  }

  const save = async () => {
    setIsSaving(true)
    try {
      const includeKeywords: CommentIncludeKeywords = {
        ...(trigger.includeKeywords ?? { value: [] }),
        type: matchType,
        value: matchType === "contain" || matchType === "equal" ? words : [],
      }
      const publicReply: CommentReply | undefined =
        trigger.publicReply?.type === "text"
          ? {
              ...trigger.publicReply,
              value: replyText,
              values: [
                { value: replyText },
                ...initialTexts.slice(1).map((value) => ({ value })),
              ],
            }
          : undefined
      const input = {
        workspaceId,
        id: trigger.id,
        isActive,
        includeKeywords,
        ...(publicReply ? { publicReply } : {}),
      }
      if (isInstagram) {
        await client.igCommentsAPI.updateIgCommentAPI(input)
      } else {
        await client.fbCommentsAPI.updateFbCommentAPI(input)
      }
      toast.success(t("flowCanvas.sheet.saved"))
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Section title={t("flowCanvas.sheet.posts")}>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{postsLabel}</span>
          <Link
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            href={trigger.href}
          >
            {t("flowCanvas.sheet.postsChange")}
          </Link>
        </div>
      </Section>

      <Section title={t("flowCanvas.sheet.match")}>
        <div className="flex flex-wrap gap-1.5">
          {MATCH_TYPES.map((type) => (
            <button
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                type === matchType
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={type}
              onClick={() => setMatchType(type)}
              type="button"
            >
              {t(
                `flowCanvas.sheet.match${type.charAt(0).toUpperCase()}${type.slice(1)}` as
                  | "flowCanvas.sheet.matchContain"
                  | "flowCanvas.sheet.matchEqual"
                  | "flowCanvas.sheet.matchAll"
                  | "flowCanvas.sheet.matchMentions",
              )}
            </button>
          ))}
        </div>
        {(matchType === "contain" || matchType === "equal") && (
          <WordChips
            hint={t("flowCanvas.sheet.keywordsHint")}
            onChange={setWords}
            words={words}
          />
        )}
      </Section>

      <Section title={t("flowCanvas.sheet.publicReply")}>
        {trigger.publicReply?.type === "text" ? (
          <>
            <Textarea
              onChange={(event) => setReplyText(event.target.value)}
              rows={4}
              value={replyText}
            />
            <p className="text-muted-foreground text-xs">
              {t("flowCanvas.sheet.publicReplyHint")}
              {initialTexts.length > 1 &&
                ` ${t("flowCanvas.sheet.publicReplyMore", { count: initialTexts.length - 1 })}`}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("flowCanvas.sheet.publicReplyOther")}
          </p>
        )}
      </Section>

      <Section title={t("flowCanvas.sheet.thenDm")}>
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {flowName}
        </p>
      </Section>

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-4">
        <div className="flex items-center gap-2 text-sm">
          <Switch
            aria-label={t("flowCanvas.sheet.on")}
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          {isActive ? t("flowCanvas.sheet.on") : t("flowCanvas.sheet.off")}
        </div>
        <Button disabled={isSaving} onClick={save} type="button">
          {isSaving && <Loader2Icon className="animate-spin" />}
          {t("flowCanvas.sheet.save")}
        </Button>
      </div>
    </>
  )
}

function KeywordRuleEditor({
  trigger,
  workspaceId,
  flowId,
  flowName,
  onSaved,
}: {
  trigger: FlowTrigger
  workspaceId: string
  flowId: string
  flowName: string
  onSaved: () => void
}) {
  const t = useTranslations()
  const [isActive, setIsActive] = useState(trigger.isActive)
  const [words, setWords] = useState<string[]>(trigger.keywords)
  const [isSaving, setIsSaving] = useState(false)
  const type = trigger.channel === "outbound" ? "outbound" : "inbound"

  const save = async () => {
    setIsSaving(true)
    try {
      const update = updateAutomatedResponseAction.bind(
        null,
        workspaceId,
        trigger.id,
        type,
      )
      const result = await update({
        folderId: trigger.folderId,
        keywords: words.map((value) => ({ value })),
        text: "",
        flowId,
      })
      if (result?.serverError) {
        throw new Error(result.serverError)
      }
      if (isActive !== trigger.isActive) {
        const enable = enableAutomatedResponseAction.bind(
          null,
          workspaceId,
          trigger.id,
          type,
        )
        const enabled = await enable({ status: isActive })
        if (enabled?.serverError) {
          throw new Error(enabled.serverError)
        }
      }
      toast.success(t("flowCanvas.sheet.saved"))
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Section title={t("flowCanvas.sheet.dmKeywords")}>
        <WordChips
          hint={t("flowCanvas.sheet.keywordsHint")}
          onChange={setWords}
          words={words}
        />
      </Section>

      <Section title={t("flowCanvas.sheet.thenDm")}>
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {flowName}
        </p>
      </Section>

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-4">
        <div className="flex items-center gap-2 text-sm">
          <Switch
            aria-label={t("flowCanvas.sheet.on")}
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          {isActive ? t("flowCanvas.sheet.on") : t("flowCanvas.sheet.off")}
        </div>
        <Button
          disabled={isSaving || words.length === 0}
          onClick={save}
          type="button"
        >
          {isSaving && <Loader2Icon className="animate-spin" />}
          {t("flowCanvas.sheet.save")}
        </Button>
      </div>
    </>
  )
}

export function TriggerSheet({
  workspaceId,
  flowId,
  flowName,
}: {
  workspaceId: string
  flowId: string
  flowName: string
}) {
  const t = useTranslations()
  const router = useRouter()
  const { trigger, close } = useContext(TriggerStateContext)

  const onSaved = useCallback(() => {
    router.refresh()
    close()
  }, [router, close])

  if (!trigger || trigger.kind === "button") {
    return null
  }

  const isKeyword = trigger.kind === "keyword"
  const isInstagram = trigger.channel !== "messenger"
  let HeaderIcon = MessageSquareTextIcon
  let kindLabel = t("flowCanvas.sheet.keywordRule")
  if (!isKeyword) {
    HeaderIcon = isInstagram ? SiInstagram : SiFacebook
    kindLabel = isInstagram
      ? t("flowCanvas.sheet.instagramRule")
      : t("flowCanvas.sheet.facebookRule")
  }

  return (
    <Sheet onOpenChange={(open) => !open && close()} open>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md" side="left">
        <SheetTitle className="flex items-center gap-2 pe-8">
          <HeaderIcon className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{kindLabel}</span>
        </SheetTitle>
        <SheetDescription className="flex items-center gap-2 pe-8">
          <span className="min-w-0 truncate">{trigger.name}</span>
          <Link
            className="inline-flex shrink-0 items-center gap-1 text-xs underline-offset-2 hover:underline"
            href={trigger.href}
          >
            {t("flowCanvas.sheet.fullSettings")}
            <ExternalLinkIcon className="size-3" />
          </Link>
        </SheetDescription>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          {isKeyword ? (
            <KeywordRuleEditor
              flowId={flowId}
              flowName={flowName}
              key={trigger.id}
              onSaved={onSaved}
              trigger={trigger}
              workspaceId={workspaceId}
            />
          ) : (
            <CommentRuleEditor
              flowName={flowName}
              key={trigger.id}
              onSaved={onSaved}
              trigger={trigger}
              workspaceId={workspaceId}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
