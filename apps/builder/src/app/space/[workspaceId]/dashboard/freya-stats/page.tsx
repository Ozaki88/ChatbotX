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

/** Freya's sage palette, as literal colors so it reads the same in light and dark. */
const SAGE = "#6B9A78"
const SAGE_SOFT = "rgba(107, 154, 120, 0.22)"
const HONEY = "#E0A84A"
const MUTED_BAR = "rgba(148, 163, 184, 0.25)"

const MISS_REASON_LABELS: Record<string, string> = {
  keywordsNotMatched: "Didn't contain a keyword",
  postNotMatched: "Post not watched by any automation",
  contactNotNew: "Already a contact (new contacts only)",
  alreadyRepliedOnPost: "Already answered this person on this post",
  commentIsReply: "Was a reply to another comment",
  outsideSchedule: "Outside the automation's hours",
  mentionCountNotMatched: "Didn't tag enough people",
  engagedOnOtherPost: "Already engaged on another post",
}

const CHANNEL_LABELS: Record<string, string> = {
  messenger: "Facebook",
  instagram: "Instagram",
  instagramFacebook: "Instagram",
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—"

const channelLabel = (type: string | null) =>
  (type && CHANNEL_LABELS[type]) ?? type ?? "—"

function hourLabel(hour: number): string {
  if (hour === 0) {
    return "12a"
  }
  if (hour === 12) {
    return "12p"
  }
  return hour < 12 ? `${hour}a` : `${hour - 12}p`
}

function postLink(post: FreyaStats["posts"][number]): string | null {
  if (post.permalink) {
    return post.permalink
  }
  // A Facebook comment's post id is `{pageId}_{storyId}`, which facebook.com
  // resolves; an Instagram media id has no public URL without its permalink.
  return post.type === "messenger"
    ? `https://www.facebook.com/${post.postId}`
    : null
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
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Hero
          channel={channel}
          href={href}
          range={range}
          stats={stats}
          workspaceId={workspaceId}
        />

        <Kpis stats={stats} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section
            hint="What Instagram/Facebook answered when a DM didn't go through, in plain words."
            title="Why DMs failed"
          >
            <FailuresTable rows={stats.failures} />
          </Section>
          <Section
            hint="Comments no automation answered, and why."
            title="Not answered"
          >
            <BarList
              empty="Every comment was answered."
              items={stats.missReasons.map((m) => ({
                label: MISS_REASON_LABELS[m.reason] ?? m.reason,
                value: m.count,
                color: MUTED_BAR,
              }))}
            />
          </Section>
        </div>

        <h2 className="mt-2 font-semibold text-lg tracking-tight">Details</h2>

        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-5">
          <div className="2xl:col-span-3">
            <Funnel stats={stats} />
          </div>
          <div className="2xl:col-span-2">
            <Section
              hint="Tracked links (Magic Links) people tapped in your DMs."
              title="Link clicks"
            >
              <LinksTable rows={stats.links} />
            </Section>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Section
              hint="When people comment, in your workspace time zone."
              title="Comments by hour"
            >
              <VerticalBars
                items={stats.hours.map((h) => ({
                  label: hourLabel(h.hour),
                  value: h.count,
                }))}
              />
            </Section>
          </div>
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
          hint="Answered = an automation replied. Not answered = no automation took it (usually no keyword)."
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

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section
            hint="Exact comment text, most common first."
            title="What people comment"
          >
            <Legend />
            <BarList
              empty="No comments yet."
              items={stats.words.map((w) => ({
                label: w.text,
                value: w.count,
                color: w.answered > 0 ? SAGE_SOFT : MUTED_BAR,
              }))}
            />
          </Section>
          <Section
            hint="All DM conversations, not only automations: messages people sent, and replies from the bot (automations + AI agent) and from you."
            title="Inbox messages"
          >
            <InboxTable rows={stats.inbox} />
          </Section>
        </div>

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
    <div className="flex rounded-lg border bg-card p-0.5">
      {items.map((item) => (
        <Link
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            item.key === current
              ? "font-medium text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
          href={item.href}
          key={item.key}
          style={item.key === current ? { backgroundColor: SAGE } : undefined}
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
    <section className="h-full rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="font-semibold text-sm">{title}</h2>
      {hint ? (
        <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * The home screen: one sentence that says whether the automations worked,
 * a status line that says what went wrong today and why, and the three
 * places to act. Everything numeric lives below it.
 */
function Hero({
  stats,
  range,
  channel,
  href,
  workspaceId,
}: {
  stats: FreyaStats
  range: FreyaStatsRange
  channel: FreyaStatsChannel
  href: (next: { range?: string; channel?: string }) => string
  workspaceId: string
}) {
  const t = stats.totals
  const today = stats.daily[0]
  const todayFailed = today?.failed ?? 0
  const todayDelivered = today?.dmDelivered ?? 0
  // One reason per row, most common first: the status line names the top
  // two so the fix is known before the table is opened.
  const topReasons = stats.failures
    .filter((f) => f.meaning)
    .slice(0, 2)
    .map((f) => `${f.count}× ${f.meaning}`)
  const base = `/space/${workspaceId}`
  const actions = [
    { label: "Inbox", hint: "Chats with people", href: `${base}/inbox` },
    {
      label: "Comment rules",
      hint: "What a YES comment triggers",
      href: `${base}/ig-comments`,
    },
    {
      label: "Keywords",
      hint: 'What a DM like "yes" triggers',
      href: `${base}/automated-responses`,
    },
  ]

  return (
    <section
      className="rounded-2xl border p-5 shadow-xs"
      style={{
        background: `linear-gradient(135deg, ${SAGE_SOFT}, transparent 60%)`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Freya, {FREYA_STATS_RANGES[range].label.toLowerCase()}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Times in {stats.timezone}
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

      <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-semibold text-xl sm:text-2xl">
        <Big n={t.comments} /> comments
        <Arrow />
        <Big n={t.dmDelivered} /> DMs delivered
        <Arrow />
        <Big n={t.tapped} /> taps
        <Arrow />
        <Big accent n={t.linkClicks} /> Amazon clicks
      </p>

      <div
        className="mt-4 rounded-xl border px-4 py-3 text-sm"
        style={{
          borderColor: todayFailed > 0 ? HONEY : SAGE,
          backgroundColor:
            todayFailed > 0 ? "rgba(224, 168, 74, 0.12)" : SAGE_SOFT,
        }}
      >
        <div className="font-medium">
          {todayFailed > 0
            ? `Today: ${todayDelivered} DMs delivered, ${todayFailed} didn't go out`
            : `Today: ${todayDelivered} DMs delivered, none failed`}
        </div>
        {topReasons.length > 0 && todayFailed > 0 ? (
          <ul className="mt-1 text-muted-foreground text-xs">
            {topReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {actions.map((action) => (
          <Link
            className="rounded-xl border bg-card px-4 py-3 shadow-xs transition-colors hover:bg-accent"
            href={action.href}
            key={action.href}
          >
            <div className="font-semibold">{action.label}</div>
            <div className="text-muted-foreground text-xs">{action.hint}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Big({ n, accent }: { n: number; accent?: boolean }) {
  return (
    <span
      className="text-3xl tabular-nums sm:text-4xl"
      style={{ color: accent ? HONEY : SAGE }}
    >
      {n.toLocaleString()}
    </span>
  )
}

function Arrow() {
  return <span className="text-muted-foreground">→</span>
}

function Kpis({ stats }: { stats: FreyaStats }) {
  const t = stats.totals
  const items = [
    {
      label: "Comments",
      value: t.comments,
      sub: `${t.answered} answered · ${t.unanswered} no keyword`,
    },
    {
      label: "DMs delivered",
      value: t.dmDelivered,
      sub: `to ${t.peopleReached} people`,
    },
    {
      label: "Seen",
      value: t.dmSeen,
      sub: `${pct(t.dmSeen, t.dmDelivered)} of delivered`,
    },
    {
      label: "Button taps",
      value: t.tapped,
      sub: `${pct(t.tapped, t.dmDelivered)} of delivered`,
    },
    {
      label: "Amazon clicks",
      value: t.linkClicks,
      sub: `${t.linkPeople} people`,
      accent: HONEY,
    },
    {
      label: "DMs failed",
      value: t.failed,
      sub: `${pct(t.failed, t.dmSent + t.failed)} of attempts`,
      accent: t.failed > 0 ? HONEY : undefined,
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div
          className="rounded-xl border bg-card p-3 shadow-xs"
          key={item.label}
          style={{ borderTop: `3px solid ${item.accent ?? SAGE}` }}
        >
          <div className="text-muted-foreground text-xs">{item.label}</div>
          <div className="font-semibold text-3xl tabular-nums">
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
    { label: "Tapped button", value: t.tapped },
    { label: "Clicked link", value: t.linkClicks, color: HONEY },
  ]
  const top = Math.max(1, ...steps.map((s) => s.value))
  return (
    <Section
      hint="Seen stays at 0 until the Meta app sends read receipts (message_reads / messaging_seen webhooks)."
      title="Funnel: comment → Amazon"
    >
      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <div className="flex items-center gap-3 text-sm" key={step.label}>
            <div className="w-28 shrink-0 text-muted-foreground">
              {step.label}
            </div>
            <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className="flex h-7 items-center rounded-md px-2 font-medium text-white text-xs tabular-nums"
                style={{
                  width: `${Math.max(3, (step.value / top) * 100)}%`,
                  backgroundColor: step.color ?? SAGE,
                }}
              >
                {step.value.toLocaleString()}
              </div>
            </div>
            <div className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
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
  // 24 hour bars need ~26px each to keep their labels apart, so on a phone the
  // chart scrolls sideways instead of printing labels on top of each other.
  return (
    <div
      className="flex h-40 items-end gap-1 overflow-x-auto"
      style={{ minWidth: 0 }}
    >
      {items.map((item) => (
        <div
          className="flex min-w-6 flex-1 flex-col items-center gap-1"
          key={item.label}
          title={`${item.label}: ${item.value}`}
        >
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {item.value || ""}
          </div>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${Math.max(item.value ? 4 : 1, (item.value / top) * 104)}px`,
              backgroundColor: item.value ? SAGE : MUTED_BAR,
            }}
          />
          <div className="text-[10px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="mb-2 flex gap-4 text-muted-foreground text-xs">
      <span className="flex items-center gap-1">
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ backgroundColor: SAGE }}
        />
        answered
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ backgroundColor: "rgba(148, 163, 184, 0.6)" }}
        />
        not answered
      </span>
    </div>
  )
}

function BarList({
  items,
  empty,
}: {
  items: { label: string; value: number; color: string }[]
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
          <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-muted/40">
            <div
              className="absolute inset-y-0 left-0 rounded-md"
              style={{
                width: `${Math.max(2, (item.value / top) * 100)}%`,
                backgroundColor: item.color,
              }}
            />
            <span className="relative block truncate px-2 leading-7">
              {item.label}
            </span>
          </div>
          <div className="w-10 shrink-0 text-right font-medium tabular-nums">
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
                className={`whitespace-nowrap px-2 py-2 font-medium ${index > 0 ? "text-right" : ""}`}
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

const td = "px-2 py-2 text-right"
const row = "border-b last:border-0 hover:bg-muted/40"

function Rate({ part, whole }: { part: number; whole: number }) {
  return <span className="text-muted-foreground">{pct(part, whole)}</span>
}

function DailyTable({ rows }: { rows: FreyaStats["daily"] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>
  }
  return (
    <Table
      head={[
        "Day",
        "Answered",
        "Not answered",
        "DMs sent",
        "Delivered",
        "Seen",
        "Taps",
        "Link clicks",
        "Failed",
      ]}
    >
      {rows.map((r) => (
        <tr className={row} key={r.day}>
          <td className="whitespace-nowrap px-2 py-2">{r.day}</td>
          <td className={td}>{r.answeredComments}</td>
          <td className={td}>{r.missedComments}</td>
          <td className={td}>{r.dmSent}</td>
          <td className={td}>
            {r.dmDelivered} <Rate part={r.dmDelivered} whole={r.dmSent} />
          </td>
          <td className={td}>{r.dmSeen}</td>
          <td className={td}>{r.tapped}</td>
          <td className={td}>{r.linkClicks}</td>
          <td className={td}>{r.failed}</td>
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
        "Taps",
        "Failed",
        "Public replies",
      ]}
    >
      {rows.map((r) => (
        <tr className={row} key={r.id}>
          <td className="px-2 py-2">
            {r.name}
            {r.isActive ? null : (
              <span className="ml-1 text-muted-foreground text-xs">(off)</span>
            )}
          </td>
          <td className={td}>{channelLabel(r.type)}</td>
          <td className={td}>{r.comments}</td>
          <td className={td}>{r.dmSent}</td>
          <td className={td}>
            {r.dmDelivered} <Rate part={r.dmDelivered} whole={r.dmSent} />
          </td>
          <td className={td}>{r.dmSeen}</td>
          <td className={td}>
            {r.tapped} <Rate part={r.tapped} whole={r.dmDelivered} />
          </td>
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
      head={["Post", "Channel", "Comments", "Answered", "DMs", "Taps", "Last"]}
    >
      {rows.map((r) => {
        const link = postLink(r)
        const title = r.caption?.split("\n")[0] || `Post ${r.postId}`
        return (
          <tr className={row} key={r.postId}>
            <td className="px-2 py-2">
              <div className="flex items-center gap-2">
                {r.thumbnail ? (
                  // biome-ignore lint/performance/noImgElement: remote CDN thumbnail of unknown host
                  <img
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                    height={40}
                    loading="lazy"
                    // Meta's CDNs refuse hotlinked images that send a referrer.
                    referrerPolicy="no-referrer"
                    src={r.thumbnail}
                    width={40}
                  />
                ) : (
                  <div className="size-10 shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0 max-w-80">
                  {link ? (
                    <a
                      className="block truncate hover:underline"
                      href={link}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="block truncate">{title}</span>
                  )}
                </div>
              </div>
            </td>
            <td className={td}>{channelLabel(r.type)}</td>
            <td className={td}>{r.comments}</td>
            <td className={td}>
              {r.answered} <Rate part={r.answered} whole={r.comments} />
            </td>
            <td className={td}>{r.dmSent}</td>
            <td className={td}>{r.tapped}</td>
            <td className={`${td} whitespace-nowrap`}>
              {r.lastComment?.toLocaleDateString() ?? "—"}
            </td>
          </tr>
        )
      })}
    </Table>
  )
}

function LinksTable({ rows }: { rows: FreyaStats["links"] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No tracked link clicks yet. Use a Magic Link on the Amazon button to
        count them.
      </p>
    )
  }
  return (
    <Table head={["Link", "Clicks", "People", "Last"]}>
      {rows.map((r) => (
        <tr className={row} key={r.name}>
          <td className="px-2 py-2">
            <div className="font-medium">{r.name}</div>
            <div className="max-w-56 truncate text-muted-foreground text-xs">
              {r.url}
            </div>
          </td>
          <td className={td}>{r.clicks}</td>
          <td className={td}>{r.people}</td>
          <td className={`${td} whitespace-nowrap`}>
            {r.last?.toLocaleDateString() ?? "—"}
          </td>
        </tr>
      ))}
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
          className="rounded-lg border p-2 text-xs"
          key={`${r.detail}-${r.httpCode}`}
        >
          <div className="flex justify-between gap-2">
            <span className="font-medium">
              {r.count}× {r.httpCode ? `· code ${r.httpCode}` : ""}
            </span>
            <span className="text-muted-foreground">
              last {r.last?.toLocaleDateString() ?? "—"}
            </span>
          </div>
          {r.meaning && <div className="mt-1 break-words">{r.meaning}</div>}
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
        <tr className={row} key={r.day}>
          <td className="px-2 py-2">{r.day}</td>
          <td className={td}>{r.incoming}</td>
          <td className={td}>{r.bot}</td>
          <td className={td}>{r.human}</td>
        </tr>
      ))}
    </Table>
  )
}

function Outcome({ r }: { r: FreyaStats["feed"][number] }) {
  if (r.failed) {
    return (
      <span className="text-destructive" title={r.errorDetail ?? ""}>
        Failed
      </span>
    )
  }
  const steps = [
    r.delivered ? "Delivered" : "Sent",
    r.seen ? "Seen" : null,
    r.clicked ? "Tapped" : null,
  ].filter(Boolean)
  return (
    <span style={r.clicked ? { color: SAGE } : undefined}>
      {steps.join(" · ")}
    </span>
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
            <tr className={`${row} align-top`} key={r.id}>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground text-xs">
                {r.occurredAt.toLocaleString()}
              </td>
              <td className="px-2 py-2">{r.contactName ?? "—"}</td>
              <td className="max-w-48 truncate px-2 py-2">
                {r.commentText ?? "—"}
              </td>
              <td className="px-2 py-2">
                {r.automation}
                <span className="ml-1 text-muted-foreground text-xs">
                  {channelLabel(r.type)}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-xs">
                {r.replyChannel === "private" ? "DM" : "Public reply"}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-xs">
                <Outcome r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
