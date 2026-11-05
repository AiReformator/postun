import { z } from 'zod';

const operationId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional().describe('Optional idempotency key: a retry with the same key is not counted twice.');
const accountId = z.uuid().describe('Account id from list_accounts');
const peer = z.string().regex(/^[ugc]:\d{1,16}:-?\d{1,20}$/).describe('Opaque peer reference returned by Postun tools');
const cursor = z.string().min(1).max(2048).optional().describe('Opaque cursor from a previous page');
const limit = (def: number, max: number) => z.number().int().min(1).max(max).default(def);
const isoDate = z.iso.datetime({ offset: true });

export const TOOL_INPUT = {
  list_accounts: z.object({ operation_id: operationId }),
  list_dialogs: z.object({ account_id: accountId, limit: limit(50, 100), cursor, operation_id: operationId }),
  get_history: z.object({
    account_id: accountId, peer, from_date: isoDate.optional(), to_date: isoDate.optional(), limit: limit(50, 100), cursor, operation_id: operationId
  }),
  search_messages: z.object({
    account_id: accountId, query: z.string().min(1).max(256), peer: peer.optional(), limit: limit(20, 100), cursor, operation_id: operationId
  }),
  search_channels: z.object({ account_id: accountId, query: z.string().min(1).max(128), limit: limit(20, 50), operation_id: operationId }),
  get_channel_posts: z.object({ account_id: accountId, channel: peer, limit: limit(20, 100), cursor, operation_id: operationId }),
  get_media_info: z.object({ account_id: accountId, peer, message_id: z.number().int().min(1).max(2_000_000_000), operation_id: operationId }),
  get_media: z.object({ account_id: accountId, peer, message_id: z.number().int().min(1).max(2_000_000_000), operation_id: operationId })
} as const;

export const TOOL_DESCRIPTION: Record<keyof typeof TOOL_INPUT, string> = {
  list_accounts: '[Beta] Lists the Telegram accounts this connection may read.',
  list_dialogs: '[Beta] Lists chats, groups and channels of one account, newest first. Paginated (default 50, max 100).',
  get_history: '[Beta] Reads message history of one chat, optionally within a date range. Paginated with an opaque cursor.',
  search_messages: '[Beta] Searches messages of one account, optionally inside a single chat.',
  search_channels: '[Beta] Searches public Telegram channels by name. May be disabled in the current beta.',
  get_channel_posts: '[Beta] Reads recent posts of a public channel. May be disabled in the current beta.',
  get_media_info: '[Beta] Returns metadata (type, name, size) of a message attachment. Does not download.',
  get_media: '[Beta] Issues a short-lived download capability for an attachment. May be disabled in the current beta.'
};
