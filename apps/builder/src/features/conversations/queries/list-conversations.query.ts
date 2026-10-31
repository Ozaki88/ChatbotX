import {
  conversationService,
  resolveContactAvatarUrl,
} from "@chatbotx.io/business"
import { resolveAdReferral } from "@chatbotx.io/business/ads-conversion/channel-fields"
import { notFoundException } from "@chatbotx.io/business/errors"
import { db, sql } from "@chatbotx.io/database/client"
import { resolveGoogleAdsClick } from "@chatbotx.io/business/google-ads/click-fields"
import {
  contactInboxOperationalColumns,
  createMessageRepository,
} from "@chatbotx.io/database/repositories"
import type {
  ContactInboxOperationalModel,
  InboxModel,
} from "@chatbotx.io/database/types"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { endOfHour } from "date-fns"
import z from "zod"
import type { ListConversationsRequest } from "@/features/conversations/schema/query"
import { decodeCursor, encodeCursor } from "@/lib/pagination"
import type {
  ConversationContactInboxResource,
  FindConversationRequest,
  FindConversationResponse,
  ListConversationsResponse,
} from "../schema/resource"
import { buildConversationWhere } from "./build-conversation-where"
import { resolveLastMessageSinceTime } from "./last-message-window"

const DEFAULT_PER_PAGE = 20

// Shared by BOTH conversation query paths (`listConversations` and
// `findConversation`) so a raw `contactInbox.referral` — an arbitrary webhook
// payload — never reaches the oRPC response and both paths produce the exact
// same `conversationContactInboxResource` shape (output validation requires
// this). The explicit projection keeps internal jsonb columns out of the
// response object entirely rather than relying on output validation to strip them.
const mapConversationContactInboxes = (
  contactInboxes: readonly (ContactInboxOperationalModel & {
    inbox: InboxModel
  })[],
): ConversationContactInboxResource[] =>
  contactInboxes.map((contactInbox) => ({
    id: contactInbox.id,
    contactId: contactInbox.contactId,
    inboxId: contactInbox.inboxId,
    channel: contactInbox.channel,
    source: contactInbox.source,
    sourceId: contactInbox.sourceId,
    sourceUserId: contactInbox.sourceUserId,
    sourceUsername: contactInbox.sourceUsername,
    language: contactInbox.language,
    lastMessageAt: contactInbox.lastMessageAt,
    lastIncomingMessageAt: contactInbox.lastIncomingMessageAt,
    contactLastReadAt: contactInbox.contactLastReadAt,
    inbox: contactInbox.inbox,
    adReferral: resolveAdReferral(contactInbox.referral),
    googleAdsClick: resolveGoogleAdsClick(contactInbox.referral),
    // Conversation routing (thread control): the composer's standby lock and
    // the owner pill read these off the listed conversation, so the allow-list
    // mapper must carry them or the lock never engages on reload.
    threadControlState: contactInbox.threadControlState,
    threadOwnerRole: contactInbox.threadOwnerRole,
    threadControlUpdatedAt: contactInbox.threadControlUpdatedAt,
    threadOwnerExpiresAt: contactInbox.threadOwnerExpiresAt,
    threadOwnerAppId: contactInbox.threadOwnerAppId,
    threadControlLastEvent: contactInbox.threadControlLastEvent,
  }))

const resolveConversationContact = async <T extends { avatar: string | null }>(
  contact: T | null,
  contactInboxes: readonly (ContactInboxOperationalModel & {
    inbox: InboxModel
  })[],
  workspaceId: string,
): Promise<T | null> => {
  if (!contact) {
    return null
  }
  return {
    ...contact,
    avatar: await resolveContactAvatarUrl(
      {
        workspaceId,
        contact,
        contactInboxes,
      },
      (key) => key,
    ),
  }
}

const conversationCursorSchema = z.object({
  lastActivityAt: z.coerce.date().nullable(),
  id: zodBigintAsString(),
})
type ConversationCursor = z.infer<typeof conversationCursorSchema>

export const listConversations = async (
  data: ListConversationsRequest,
  access: { includeEmailAndPhone: boolean },
): Promise<ListConversationsResponse> => {
  const { workspaceId, ...input } = data

  const limit = input.perPage ?? DEFAULT_PER_PAGE
  const cursor = input.cursor
    ? decodeCursor(input.cursor, conversationCursorSchema)
    : null

  // Inbox keyword search must not become an email/phone oracle for agents who
  // lack the emailAndPhone permission — the caller resolves visibility (from
  // the member's permissions for the private path, or `true` for workspace
  // tokens, which are workspace-level not member-scoped) and threads it through.
  const where = buildConversationWhere(workspaceId, input, cursor, {
    includeEmailAndPhone: access.includeEmailAndPhone,
  })

  const conversations = await conversationService.findManyQuery({
    where,
    orderBy: (table, { sql: orderSql, desc }) => [
      orderSql`${table.lastActivityAt} IS NULL`,
      desc(table.lastActivityAt),
      desc(table.id),
    ],
    limit: limit + 1,
    with: {
      contact: true,
      contactInboxes: {
        columns: contactInboxOperationalColumns,
        with: { inbox: true },
      },
      assignedUser: true,
      assignedInboxTeam: true,
    },
  })

  const hasMore = conversations.length > limit
  const page = hasMore ? conversations.slice(0, limit) : conversations

  // ── Shard-aware message lookups (parallelized) ──────────────────────────
  const messageRepository = await createMessageRepository()
  const lastMessagesResults = await Promise.all(
    page.map((c) => {
      // Anchor on this conversation's own lastActivityAt, not a contactInbox's
      // lastMessageAt — a contact's ContactInbox is shared across their DM and
      // every comment-thread conversation, so its lastMessageAt reflects
      // whichever of those was most recently active, not this specific one.
      // Using the wrong (later) anchor excludes this conversation's real last
      // message from the sharded time window, returning an empty preview.
      // Don't bail when lastActivityAt is missing: historical imports populate
      // messages but never set it, so bailing hid the last-message preview.
      // resolveLastMessageSinceTime falls back to a full-history scan instead.
      return messageRepository.findLastByConversation(c.id, {
        attachmentCountOnly: true,
        limit: 1,
        sinceTime: resolveLastMessageSinceTime(c.lastActivityAt),
        workspaceId,
      })
    }),
  )

  const lastMessagesByConversationId = new Map(
    page.map((c, index) => [c.id, lastMessagesResults[index]?.[0] ?? null]),
  )

  const personPreviewByConversationId = await resolvePersonPreviews(
    page.map((c) => ({
      id: c.id,
      contactRepliedAt: c.contactRepliedAt,
      contactInboxIds: c.contactInboxes.map((inbox) => inbox.id),
    })),
    workspaceId,
    messageRepository,
  )

  // ── Build cursor pagination response ────────────────────────────────────
  const lastItem = page.at(-1)
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          lastActivityAt: lastItem.lastActivityAt,
          id: lastItem.id,
        } satisfies ConversationCursor)
      : null

  const prevCursor = cursor
    ? encodeCursor({
        lastActivityAt: page[0]?.lastActivityAt ?? new Date(),
        id: page[0]?.id ?? "0",
      } satisfies ConversationCursor)
    : null

  return {
    data: await Promise.all(
      page.map(async (c) => {
        const lastMessage = lastMessagesByConversationId.get(c.id)
        return {
          ...c,
          contact: await resolveConversationContact(
            c.contact ?? null,
            c.contactInboxes,
            workspaceId,
          ),
          contactInboxes: mapConversationContactInboxes(c.contactInboxes),
          assignedUser: c.assignedUser ?? null,
          assignedInboxTeam: c.assignedInboxTeam ?? null,
          messages: lastMessage ? [lastMessage] : [],
          personPreview: personPreviewByConversationId.get(c.id) ?? null,
        }
      }),
    ),
    nextCursor,
    prevCursor,
  }
}

/**
 * The person's own last words for the list row: their last DM, or, for the
 * many threads where Freya's comment DM is the only message, the comment
 * that started it. Without this every row showed the same recipe text and
 * the list said nothing about who was on the other end.
 */
async function resolvePersonPreviews(
  rows: {
    id: string
    contactRepliedAt: Date | null
    contactInboxIds: string[]
  }[],
  workspaceId: string,
  messageRepository: Awaited<ReturnType<typeof createMessageRepository>>,
): Promise<Map<string, string>> {
  const previews = new Map<string, string>()

  // `contactRepliedAt` is the conversation's own record of the person's last
  // message, so it is a safe lower bound for the sharded lookup and skips the
  // lookup entirely where they never wrote.
  const lastIncoming = await Promise.all(
    rows.map((row) =>
      row.contactRepliedAt
        ? messageRepository.findLastByConversation(row.id, {
            attachmentCountOnly: true,
            limit: 1,
            messageTypes: ["incoming"],
            sinceTime: resolveLastMessageSinceTime(row.contactRepliedAt),
            workspaceId,
          })
        : Promise.resolve([]),
    ),
  )
  rows.forEach((row, index) => {
    const text = lastIncoming[index]?.[0]?.text?.trim()
    if (text) {
      previews.set(row.id, text)
    }
  })

  const needComment = rows.filter((row) => !previews.has(row.id))
  const inboxIds = needComment.flatMap((row) => row.contactInboxIds)
  if (inboxIds.length === 0) {
    return previews
  }
  const result = await db.execute(sql`
    SELECT DISTINCT ON ("contactInboxId") "contactInboxId"::text AS "contactInboxId", "text"
    FROM "Message"
    WHERE "workspaceId" = ${workspaceId}
      AND "contactInboxId" IN (${sql.join(
        inboxIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND "type" = 'comment'
      AND "messageType" = 'incoming'
      AND "text" IS NOT NULL
    ORDER BY "contactInboxId", "createdAt" DESC
  `)
  const commentByInbox = new Map(
    (result.rows as { contactInboxId: string; text: string }[]).map((r) => [
      r.contactInboxId,
      r.text,
    ]),
  )
  for (const row of needComment) {
    const text = row.contactInboxIds
      .map((id) => commentByInbox.get(id)?.trim())
      .find((value) => value)
    if (text) {
      previews.set(row.id, `Commented: ${text}`)
    }
  }
  return previews
}

// ── Find single conversation ──────────────────────────────────────────────────

export const findConversation = async (
  input: FindConversationRequest,
): Promise<FindConversationResponse> => {
  const conversation = await conversationService.findWithFullRelations({
    where: input,
  })
  if (!conversation) {
    throw notFoundException("Conversation not found")
  }

  const messageRepository = await createMessageRepository()
  const lastMessages = await messageRepository.findLastByConversation(
    conversation.id,
    {
      attachmentCountOnly: true,
      messageTypes: ["incoming", "outgoing"],
      limit: 1,
      // Anchor on this conversation's own lastActivityAt — see the comment in
      // listConversations() above for why contactInbox.lastMessageAt is wrong
      // here (shared across a contact's DM and every comment-thread conversation).
      // Falls back to a full-history scan when lastActivityAt is unset (historical
      // imports), so opening an imported conversation still shows its messages.
      sinceTime: resolveLastMessageSinceTime(
        conversation.lastActivityAt,
        endOfHour,
      ),
      workspaceId: input.workspaceId,
    },
  )

  return {
    data: {
      ...conversation,
      contact: await resolveConversationContact(
        conversation.contact,
        conversation.contactInboxes,
        input.workspaceId,
      ),
      contactInboxes: mapConversationContactInboxes(
        conversation.contactInboxes,
      ),
      messages: lastMessages.length > 0 ? [lastMessages[0]] : [],
    },
  }
}
