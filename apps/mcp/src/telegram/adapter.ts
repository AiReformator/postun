/**
 * Boundary between Postun and MTProto. The rest of the code only sees these DTOs.
 * Message text, titles and file names are untrusted third-party data.
 */
import { PostunError } from '@postun/contracts';
import type { Env } from '../env';

export type PeerKind = 'user' | 'group' | 'channel';

export interface DialogDto {
  peerId: string; // opaque peer reference, usable only with the same account
  kind: PeerKind;
  title: string;
  username: string | null;
  unread: number;
  lastMessageDate: string | null;
}

export interface MediaInfoDto {
  kind: 'photo' | 'document' | 'video' | 'audio' | 'voice' | 'other';
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
}

export interface MessageDto {
  id: number;
  peerId: string;
  date: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  replyToId: number | null;
  media: MediaInfoDto | null;
}

export interface ChannelDto {
  peerId: string;
  title: string;
  username: string | null;
}

/** `next` is an adapter-private continuation string; callers sign it into a cursor. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface MediaStream {
  stream: ReadableStream<Uint8Array>;
  size: number;
  mimeType: string | null;
  fileName: string | null;
  /** Aborts the upstream download. */
  cancel(): Promise<void>;
}

/** One authorised Telegram session, open for the duration of a single operation. */
export interface TelegramSession {
  listDialogs(limit: number, offset: string | null): Promise<Page<DialogDto>>;
  getHistory(q: { peerId: string; limit: number; offset: string | null; fromDate: number | null; toDate: number | null }): Promise<Page<MessageDto>>;
  searchMessages(q: { peerId: string | null; query: string; limit: number; offset: string | null }): Promise<Page<MessageDto>>;
  searchChannels(q: { query: string; limit: number }): Promise<ChannelDto[]>;
  getChannelPosts(q: { peerId: string; limit: number; offset: string | null }): Promise<Page<MessageDto>>;
  getMediaInfo(peerId: string, messageId: number): Promise<MediaInfoDto | null>;
  openMediaStream(peerId: string, messageId: number, range: { start: number; end: number }): Promise<MediaStream>;
  /** Closes the connection. Returns a new session string only when auth key / DC changed. */
  close(): Promise<string | null>;
}

export interface LinkHooks {
  onQr(url: string, expiresAt: Date): void;
  requestPassword(): Promise<string>;
  onPasswordInvalid(): void;
}

export interface LinkResult {
  telegramId: string; // decimal string
  firstName: string;
  session: string; // secret: must be sealed immediately
}

export interface LinkRun {
  done: Promise<LinkResult>;
  cancel(): void;
}

export interface TelegramAdapter {
  startQrLink(hooks: LinkHooks): LinkRun;
  open(session: string): Promise<TelegramSession>;
  /** Terminates the authorisation on Telegram's side. Rejects when Telegram is unreachable. */
  logOut(session: string): Promise<void>;
}

/** Production never falls back to the synthetic adapter; it needs APP_ENV=test and an explicit opt-in. */
export async function selectAdapter(env: Env): Promise<TelegramAdapter> {
  if (env.TELEGRAM_ADAPTER === 'synthetic') {
    if (env.APP_ENV !== 'test') throw new PostunError('CONFIG_MISSING');
    const { SyntheticAdapter } = await import('./synthetic');
    return new SyntheticAdapter();
  }
  if (env.TELEGRAM_ADAPTER === 'mtcute') {
    const apiId = Number(env.TELEGRAM_API_ID);
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !env.TELEGRAM_API_HASH) throw new PostunError('CONFIG_MISSING');
    const { MtcuteAdapter, floodOptionsFromEnv } = await import('./mtcute');
    return new MtcuteAdapter(apiId, env.TELEGRAM_API_HASH, floodOptionsFromEnv(env));
  }
  throw new PostunError('CONFIG_MISSING');
}

const PEER_RE = /^[ugc]:\d{1,16}:-?\d{1,20}$/;
export function isPeerRef(v: string): boolean {
  return PEER_RE.test(v);
}
