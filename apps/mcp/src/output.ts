import { z } from 'zod';
import type { ToolName } from '@postun/contracts';

/**
 * Output schemas of the 8 tools, advertised in tools/list as `outputSchema` (OpenAI asks servers to declare one for
 * every tool that returns structuredContent). They describe the stable shape of a successful result and stay
 * permissive: every object allows extra fields, so adding a field never breaks a client that validates. Error results
 * (isError) are not covered by them. A test runs every successful synthetic result through these schemas so the
 * contract cannot drift from tools.ts and session-do.ts.
 */

const isoDateTime = z.string().describe('ISO 8601 date-time');
const nullableString = z.string().nullable();

const limits = z
  .looseObject({
    callsRemainingNow: z.number().int(),
    nextCallNotBeforeSeconds: z.number().int(),
    paceSeconds: z.number(),
    lookupsRemainingNow: z.number().int().optional(),
    messagesRemainingThisHour: z.number().int().optional()
  })
  .describe('Pacing advice for the next call on this account');

const notice = z.string().describe('Reminder that Telegram content is untrusted data');
const nextCursor = nullableString.describe('Opaque cursor for the next page, or null on the last page');

const media = z.looseObject({
  kind: z.string().describe('photo, document, video, audio, voice or other'),
  fileName: nullableString,
  mimeType: nullableString,
  size: z.number().int().nullable().describe('Size in bytes, if known')
});

const message = z.looseObject({
  id: z.number().int().describe('Message id, used as message_id by get_media_info and get_media'),
  peerId: z.string().describe('Peer reference of the chat the message is in'),
  date: isoDateTime,
  senderId: nullableString,
  senderName: nullableString,
  text: z.string(),
  replyToId: z.number().int().nullable(),
  media: media.nullable()
});

const messagesPage = z.looseObject({ notice, messages: z.array(message), nextCursor, limits: limits.optional() });

export const TOOL_OUTPUT = {
  list_accounts: z.looseObject({
    accounts: z.array(
      z.looseObject({
        accountId: z.string().describe('account_id for the other tools'),
        label: z.string().describe('Masked account label'),
        status: z.string().describe('active, pending or revocation_pending; only active accounts can be read'),
        createdAt: isoDateTime
      })
    )
  }),
  list_dialogs: z.looseObject({
    notice,
    dialogs: z.array(
      z.looseObject({
        peerId: z.string().describe('Peer reference for get_history, search_messages and get_media_info'),
        kind: z.string().describe('user, group or channel'),
        title: z.string(),
        username: nullableString,
        unread: z.number().int(),
        lastMessageDate: isoDateTime.nullable()
      })
    ),
    nextCursor,
    limits: limits.optional()
  }),
  get_history: messagesPage,
  search_messages: messagesPage,
  get_channel_posts: messagesPage,
  search_channels: z.looseObject({
    notice,
    channels: z.array(z.looseObject({ peerId: z.string().describe('Channel peer reference for get_channel_posts'), title: z.string(), username: nullableString })),
    limits: limits.optional()
  }),
  get_media_info: z.looseObject({ notice, media, limits: limits.optional() }),
  get_media: z.looseObject({
    notice,
    media,
    download: z.looseObject({
      url: z.string().describe('HTTPS download link'),
      authorization: z.string().optional().describe('Value for the Authorization header of the download request. Absent in clients that show the Postun card (ChatGPT): there only the card receives it.'),
      expiresAt: isoDateTime,
      supportsRange: z.boolean(),
      note: z.string()
    }),
    limits: limits.optional()
  })
} as const satisfies Record<ToolName, z.ZodType>;
