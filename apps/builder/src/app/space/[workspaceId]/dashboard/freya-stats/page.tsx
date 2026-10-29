import { getIdFromParams } from "@chatbotx.io/utils"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { AnalyticsNav } from "@/features/analytics/components/analytics-nav"
import { resolveAdsDashboardChannels } from "@/features/analytics/lib/ads-dashboard-channels"
import { resolveGoogleAdsDashboardEntry } from "@/features/analytics/lib/google-ads-dashboard-entry"
import {
  FREYA_STATS_CHANNELS,
  FREYA_STATS_RANGES,
  type FreyaStats,
  type FreyaStatsChannel,
  type FreyaStatsRange,
  getFreyaStats,
} from "@/features/freya-stats/queries"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"

export const dynamic = "force-dynamic"

const MISS_REASON_LABELS: Record<string, string> = {
  keywordsNotMatched: "Comment didn't match the keyword",
  contactNotNew: "Already a contact (new contacts only)",
  alreadyRepliedOnPost: "Already answered this person on this post",
  commentIsReply: "Was a reply to another comment",
  postNotMatched: "Post not watched by this automation",
  outsideSchedule: "Outside the automation's hours",
  mentionCountNotMatched: "Didn't tag enough people",
  engagedOnOtherPost: "Already engaged on another post",
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—"

const CHANNEL_LABELS: Record<string, string> = {
  messenger: "Facebook",
  instagram: "Instagram",
  instagramFacebook: "Instagram",
}

const channelLabel = (type: string | null) =>
  (type && CHANNEL_LABELS[type]) ?? type ?? "—"

function postLink(postId: string, type: string | null): string | null {
  // A Facebook comment's post id is `{pageId}_{storyId}`, which facebook.com
  // resolves; an Instagram media id has no public URL without another API call.
  return type === "messenger" ? `https://www.facebook.com/${postId}` : null
}

export default async function FreyaStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ range?: string; channel?: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  const userAndWorkspace = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (
    !(
      userAndWorkspace &&
      hasWorkspacePermission(
        userAndWorkspace.targetWorkspaceMember.permissions,
        "analytics",
      )
    )
  ) {
    return notFound()
  }

  const query = await searchParams
  const range = (
    query.range && query.range in FREYA_STATS_RANGES ? query.range : "7"
  ) as FreyaStatsRange
  const channel = (
    query.channel && query.channel in FREYA_STATS_CHANNELS
      ? query.channel
      : "all"
  ) as FreyaStatsChannel

  const isSuperAdmin = hasWorkspacePermission(
    userAndWorkspace.targetWorkspaceMember.permissions,
    "superAdmin",
  )
  const [adsChannels, showGoogleAds, stats] = await Promise.all([
    resolveAdsDashboardChannels({ workspaceId, isSuperAdmin }),
    resolveGoogleAdsDashboardEntry({ workspaceId, isSuperAdmin }),
    getFreyaStats({
      workspaceId,
      range,
      channel,
      timezone: userAndWorkspace.targetWorkspace.timezone ?? "UTC",
    }),
  ])

  const base = `/space/${workspaceId}/dashboard/freya-stats`
  const href = (next: { range?: string; channel?: string }) =>
    `${base}?range=${next.range ?? range}&channel=${next.channel ?? channel}`

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <AnalyticsNav adsChannels={adsChannels} showGoogleAds={showGoogleAds} />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-xl">Freya stats</h1>
            <p className="text-muted-foreground text-sm">
              Comments, DMs and taps across every comment automation. Times in{" "}
              {stats.timezone}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pills
              current={channel}
              items={Object.entries(FREYA_STATS_CHANNELS).map(([key, v]) => ({
                key,
                label: v.label,
                href: href({ channel: key }),
              }))}
            />
            <Pills
              current={range}
              items={Object.entries(FREYA_STATS_RANGES).map(([key, v]) => ({
                key,
                label: v.label,
                href: href({ range: key }),
              }))}
            />
          </div>
        </div>

        {stats.errors.length > 0 ? (
          <div className="rounded-lg border border-destructive/50 p-3 text-destructive text-xs">
            Some sections could not load:
            <ul className="mt-1 list-disc pl-4">
              {stats.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Kpis stats={stats} />
        <Funnel stats={stats} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section
            hint="When people comment, in your workspace time zone."
            title="Comments by hour"
          >
            <VerticalBars
              items={stats.hours.map((h) => ({
                label: String(h.hour),
                value: h.count,
              }))}
            />
          </Section>
          <Section title="Comments by weekday">
            <VerticalBars
              items={stats.weekdays.map((d) => ({
                label: WEEKDAYS[d.dow - 1] ?? String(d.dow),
                value: d.count,
              }))}
            />
          </Section>
        </div>

        <Section
          hint="Answered = an automation replied. Missed = seen but no keyword matched (or another rule skipped it)."
          title="Day by day"
        >
          <DailyTable rows={stats.daily} />
        </Section>

        <Section title="Per automation">
          <AutomationsTable rows={stats.automations} />
        </Section>

        <Section
          hint="Your 25 posts with the most comments in this period."
          title="Per post"
        >
          <PostsTable rows={stats.posts} />
        </Section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section
            hint="Exact comment text, most common first. Green = answered."
            title="What people comment"
          >
            <BarList
              empty="No comments yet."
              items={stats.words.map((w) => ({
                label: w.text,
                value: w.count,
                note: w.answered > 0 ? "answered" : "missed",
                good: w.answered > 0,
              }))}
            />
          </Section>
          <div className="flex flex-col gap-6">
            <Section title="Why comments were not answered">
              <BarList
                empty="Nothing missed."
                items={stats.missReasons.map((m) => ({
                  label: MISS_REASON_LABELS[m.reason] ?? m.reason,
                  value: m.count,
                }))}
              />
            </Section>
            <Section
              hint="What Instagram/Facebook said when a reply didn't go through."
              title="Why DMs failed"
            >
              <FailuresTable rows={stats.failures} />
            </Section>
          </div>
        </div>

        <Section
          hint="All DM conversations, not only automations: messages people sent, and replies from the bot (automations + AI agent) and from you."
          title="Inbox messages"
        >
          <InboxTable rows={stats.inbox} />
        </Section>

        <Section hint="The latest 60 replies sent." title="Live feed">
          <FeedTable rows={stats.feed} />
        </Section>
      </div>
    </div>
  )
}

function Pills({
  items,
  current,
}: {
  items: { key: string; label: string; href: string }[]
  current: string
}) {
  return (
    <div className="flex rounded-md border p-0.5">
      {items.map((item) => (
        <Link
          className={`rounded px-2.5 py-1 text-xs ${
            item.key === current
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          href={item.href}
          key={item.key}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-medium text-sm">{title}</h2>
      {hint ? (
        <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Kpis({ stats }: { stats: FreyaStats }) {
  const t = stats.totals
  const items = [
    {
      label: "Comments",
      value: t.comments,
      sub: `${t.unanswered} not answered`,
    },
    { label: "DMs sent", value: t.dmSent, sub: `${t.peopleReached} people` },
    {
      label: "Delivered",
      value: t.dmDelivered,
      sub: pct(t.dmDelivered, t.dmSent),
    },
    { label: "Seen", value: t.dmSeen, sub: pct(t.dmSeen, t.dmDelivered) },
    {
      label: "Button taps",
      value: t.tapped,
      sub: pct(t.tapped, t.dmDelivered),
    },
    {
      label: "Failed",
      value: t.failed,
      sub: pct(t.failed, t.dmSent + t.failed),
    },
    { label: "Public replies", value: t.publicReplies, sub: "under comments" },
    { label: "New contacts", value: t.newContacts, sub: "in this period" },
    { label: "Tapped gummies", value: t.tappedTag, sub: "tag, all time" },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
      {items.map((item) => (
        <div className="rounded-lg border bg-card p-3" key={item.label}>
          <div className="text-muted-foreground text-xs">{item.label}</div>
          <div className="font-semibold text-2xl tabular-nums">
            {item.value.toLocaleString()}
          </div>
          <div className="text-muted-foreground text-xs">{item.sub}</div>
        </div>
      ))}
    </div>
  )
}

function Funnel({ stats }: { stats: FreyaStats }) {
  const t = stats.totals
  const steps = [
    { label: "Comments", value: t.comments },
    { label: "Answered", value: t.answered },
    { label: "DM sent", value: t.dmSent },
    { label: "Delivered", value: t.dmDelivered },
    { label: "Seen", value: t.dmSeen },
    { label: "Tapped", value: t.tapped },
  ]
  const top = Math.max(1, ...steps.map((s) => s.value))
  return (
    <Section
      hint="Seen stays empty until the Meta app sends read receipts (message_reads / messaging_seen webhooks)."
      title="Funnel"
    >
      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <div className="flex items-center gap-3 text-sm" key={step.label}>
            <div className="w-24 shrink-0 text-muted-foreground">
              {step.label}
            </div>
            <div className="h-6 flex-1 rounded bg-muted">
              <div
                className="flex h-6 items-center rounded bg-primary/80 px-2 text-primary-foreground text-xs tabular-nums"
                style={{ width: `${Math.max(2, (step.value / top) * 100)}%` }}
              >
                {step.value.toLocaleString()}
              </div>
            </div>
            <div className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
              {index === 0 ? "" : pct(step.value, steps[index - 1]?.value ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function VerticalBars({
  items,
}: {
  items: { label: string; value: number }[]
}) {
  const top = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex h-36 items-end gap-1">
      {items.map((item) => (
        <div
          className="flex flex-1 flex-col items-center gap-1"
          key={item.label}
          title={`${item.label}: ${item.value}`}
        >
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {item.value || ""}
          </div>
          <div
            className="w-full rounded-t bg-primary/70"
            style={{ height: `${(item.value / top) * 96}px` }}
          />
          <div className="text-[10px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function BarList({
  items,
  empty,
}: {
  items: { label: string; value: number; note?: string; good?: boolean }[]
  empty: string
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty}</p>
  }
  const top = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div className="flex items-center gap-3 text-sm" key={item.label}>
          <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted">
            <div
              className={`absolute inset-y-0 left-0 ${
                item.good === false ? "bg-muted-foreground/30" : "bg-primary/40"
              }`}
              style={{ width: `${(item.value / top) * 100}%` }}
            />
            <span className="relative truncate px-2 leading-6">
              {item.label}
            </span>
          </div>
          <div className="w-10 shrink-0 text-right tabular-nums">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground text-xs">
            {head.map((h, index) => (
              <th
                className={`px-2 py-2 font-medium ${index > 0 ? "text-right" : ""}`}
                key={h}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">{children}</tbody>
      </table>
    </div>
  )
}

const td = "px-2 py-1.5 text-right"

function DailyTable({ rows }: { rows: FreyaStats["daily"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>
  }
  return (
    <Table
      head={[
        "Day",
        "Answered",
        "Missed",
        "DMs sent",
        "Delivered",
        "Seen",
        "Tapped",
        "Failed",
        "Tap rate",
      ]}
    >
      {rows.map((r) => (
        <tr className="border-b last:border-0" key={r.day}>
          <td className="px-2 py-1.5">{r.day}</td>
          <td className={td}>{r.answeredComments}</td>
          <td className={td}>{r.missedComments}</td>
          <td className={td}>{r.dmSent}</td>
          <td className={td}>{r.dmDelivered}</td>
          <td className={td}>{r.dmSeen}</td>
          <td className={td}>{r.tapped}</td>
          <td className={td}>{r.failed}</td>
          <td className={td}>{pct(r.tapped, r.dmDelivered)}</td>
        </tr>
      ))}
    </Table>
  )
}

function AutomationsTable({ rows }: { rows: FreyaStats["automations"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No replies yet.</p>
  }
  return (
    <Table
      head={[
        "Automation",
        "Channel",
        "Comments",
        "DMs",
        "Delivered",
        "Seen",
        "Tapped",
        "Tap rate",
        "Failed",
        "Public replies",
      ]}
    >
      {rows.map((r) => (
        <tr className="border-b last:border-0" key={r.id}>
          <td className="px-2 py-1.5">
            {r.name}
            {r.isActive ? null : (
              <span className="ml-1 text-muted-foreground text-xs">(off)</span>
            )}
          </td>
          <td className={td}>{channelLabel(r.type)}</td>
          <td className={td}>{r.comments}</td>
          <td className={td}>{r.dmSent}</td>
          <td className={td}>{pct(r.dmDelivered, r.dmSent)}</td>
          <td className={td}>{r.dmSeen}</td>
          <td className={td}>{r.tapped}</td>
          <td className={td}>{pct(r.tapped, r.dmDelivered)}</td>
          <td className={td}>{r.failed}</td>
          <td className={td}>{r.publicReplies}</td>
        </tr>
      ))}
    </Table>
  )
}

function PostsTable({ rows }: { rows: FreyaStats["posts"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No comments yet.</p>
  }
  return (
    <Table
      head={[
        "Post",
        "Channel",
        "Comments",
        "Answered",
        "DMs",
        "Tapped",
        "Last comment",
      ]}
    >
      {rows.map((r) => {
        const link = postLink(r.postId, r.type)
        return (
          <tr className="border-b last:border-0" key={r.postId}>
            <td className="max-w-56 truncate px-2 py-1.5">
              {link ? (
                <a
                  className="underline"
                  href={link}
                  rel="noreferrer"
                  target="_blank"
                >
                  {r.postId}
                </a>
              ) : (
                r.postId
              )}
            </td>
            <td className={td}>{channelLabel(r.type)}</td>
            <td className={td}>{r.comments}</td>
            <td className={td}>{pct(r.answered, r.comments)}</td>
            <td className={td}>{r.dmSent}</td>
            <td className={td}>{r.tapped}</td>
            <td className={td}>{r.lastComment?.toLocaleDateString() ?? "—"}</td>
          </tr>
        )
      })}
    </Table>
  )
}

function FailuresTable({ rows }: { rows: FreyaStats["failures"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No failed DMs.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div
          className="rounded border p-2 text-xs"
          key={`${r.detail}-${r.httpCode}`}
        >
          <div className="flex justify-between gap-2">
            <span className="font-medium">
              {r.count}× {r.httpCode ? `HTTP ${r.httpCode}` : ""}
            </span>
            <span className="text-muted-foreground">
              last {r.last?.toLocaleDateString() ?? "—"}
            </span>
          </div>
          <div className="mt-1 break-words text-muted-foreground">
            {r.detail}
          </div>
        </div>
      ))}
    </div>
  )
}

function InboxTable({ rows }: { rows: FreyaStats["inbox"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No messages yet.</p>
  }
  return (
    <Table head={["Day", "From people", "From bot / AI", "From you"]}>
      {rows.map((r) => (
        <tr className="border-b last:border-0" key={r.day}>
          <td className="px-2 py-1.5">{r.day}</td>
          <td className={td}>{r.incoming}</td>
          <td className={td}>{r.bot}</td>
          <td className={td}>{r.human}</td>
        </tr>
      ))}
    </Table>
  )
}

function FeedTable({ rows }: { rows: FreyaStats["feed"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No replies yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground text-xs">
            <th className="px-2 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">Person</th>
            <th className="px-2 py-2 font-medium">Comment</th>
            <th className="px-2 py-2 font-medium">Automation</th>
            <th className="px-2 py-2 font-medium">Reply</th>
            <th className="px-2 py-2 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr className="border-b align-top last:border-0" key={r.id}>
              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground text-xs">
                {r.occurredAt.toLocaleString()}
              </td>
              <td className="px-2 py-1.5">{r.contactName ?? "—"}</td>
              <td className="max-w-48 truncate px-2 py-1.5">
                {r.commentText ?? "—"}
              </td>
              <td className="px-2 py-1.5">
                {r.automation}
                <span className="ml-1 text-muted-foreground text-xs">
                  {channelLabel(r.type)}
                </span>
              </td>
              <td className="px-2 py-1.5 text-xs">
                {r.replyChannel === "private" ? "DM" : "Public"} · {r.replyType}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {r.failed ? (
                  <span
                    className="text-destructive"
                    title={r.errorDetail ?? ""}
                  >
                    Failed
                  </span>
                ) : (
                  [
                    r.delivered ? "Delivered" : "Sent",
                    r.seen ? "Seen" : null,
                    r.clicked ? "Tapped" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
