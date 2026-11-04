/**
 * Real MTProto adapter built on mtcute. A client is created for each operation from the
 * decrypted session, connected, used and destroyed: no persistent outgoing socket.
 * Never log SDK errors, message text, QR URLs or session strings.
 */
import { Long } from '@mtcute/core';
import type { Document, Message, Peer, Photo, tl } from '@mtcute/core';
import { MemoryStorage, TelegramClient, WebCryptoProvider, WebSocketTransport } from '@mtcute/web';
import { PostunError } from '@postun/contracts';
// Workers forbid compiling WASM from bytes at runtime; a statically imported module is allowed.
import wasmModule from '../../../../node_modules/@mtcute/wasm/mtcute.wasm';
import type {
  ChannelDto, DialogDto, LinkHooks, LinkResult, LinkRun, MediaInfoDto, MediaStream, MessageDto, Page, TelegramAdapter, TelegramSession
} from './adapter';
import { isPeerRef } from './adapter';
import { mapTelegramError } from './errors';

const ALIGN = 4096;

/**
 * `link`: the QR-login client keeps MTProto updates flowing (but without the high-level UpdatesManager), because
 * signInQr detects the scan through `updateLoginToken`; with `disableUpdates: true` the scan is only noticed when
 * the ~30 s login token is re-exported. Data sessions keep updates disabled.
 */
function makeClient(apiId: number, apiHash: string, link = false): TelegramClient {
  return new TelegramClient({
    apiId,
    apiHash,
    storage: new MemoryStorage(),
    crypto: new WebCryptoProvider({ wasmInput: wasmModule }),
    transport: new WebSocketTransport(),
    logLevel: 0,
    ...(link ? { disableUpdates: false, updates: false as const } : { disableUpdates: true })
  });
}

// ---- peer references: "<u|g|c>:<id>:<accessHash>" so a fresh in-memory storage can address the peer ----

function encodePeer(p: tl.TypeInputPeer): string | null {
  switch (p._) {
    case 'inputPeerUser':
      return `u:${p.userId}:${p.accessHash.toString()}`;
    case 'inputPeerChat':
      return `g:${p.chatId}:0`;
    case 'inputPeerChannel':
      return `c:${p.channelId}:${p.accessHash.toString()}`;
    default:
      return null;
  }
}

function decodePeer(ref: string): tl.TypeInputPeer {
  if (!isPeerRef(ref)) throw new PostunError('INVALID_INPUT');
  const [k, id, hash] = ref.split(':') as [string, string, string];
  const n = Number(id);
  if (!Number.isSafeInteger(n)) throw new PostunError('INVALID_INPUT');
  if (k === 'u') return { _: 'inputPeerUser', userId: n, accessHash: Long.fromString(hash) };
  if (k === 'g') return { _: 'inputPeerChat', chatId: n };
  return { _: 'inputPeerChannel', channelId: n, accessHash: Long.fromString(hash) };
}

function peerOf(p: Peer): { id: string; kind: DialogDto['kind'] } | null {
  const id = encodePeer(p.inputPeer);
  if (!id) return null;
  if (p.type === 'user') return { id, kind: 'user' };
  return { id, kind: p.chatType === 'channel' ? 'channel' : 'group' };
}

function mapMedia(m: Message): MediaInfoDto | null {
  const media = m.media;
  if (!media) return null;
  switch (media.type) {
    case 'photo':
      return { kind: 'photo', fileName: null, mimeType: 'image/jpeg', size: media.fileSize ?? null };
    case 'document':
    case 'video':
    case 'audio':
    case 'voice':
      return { kind: media.type, fileName: media.fileName, mimeType: media.mimeType, size: media.fileSize ?? null };
    default:
      return { kind: 'other', fileName: null, mimeType: null, size: null };
  }
}

function mapMessage(m: Message, fallbackPeer: string | null): MessageDto {
  const sender = ((): Peer | null => {
    try {
      return m.sender;
    } catch {
      return null;
    }
  })();
  let peerId = fallbackPeer;
  if (!peerId) {
    try {
      peerId = encodePeer(m.chat.inputPeer);
    } catch {
      peerId = null;
    }
  }
  return {
    id: m.id,
    peerId: peerId ?? '',
    date: m.date.toISOString(),
    senderId: sender ? String(sender.id) : null,
    senderName: sender ? sender.displayName : null,
    text: m.text.slice(0, 4096),
    replyToId: m.replyToMessage?.id ?? null,
    media: mapMedia(m)
  };
}

function boundedNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new PostunError('INVALID_CURSOR');
  return n;
}

/** Exported for tests. */
export class MtcuteSession implements TelegramSession {
  constructor(private readonly tg: TelegramClient, private readonly initial: string) {}

  async listDialogs(limit: number, offset: string | null): Promise<Page<DialogDto>> {
    const skip = boundedNumber(offset) ?? 0;
    const items: DialogDto[] = [];
    let seen = 0;
    let more = false;
    for await (const d of this.tg.iterDialogs({ limit: skip + limit + 1 })) {
      if (seen++ < skip) continue;
      if (items.length >= limit) {
        more = true;
        break;
      }
      const p = peerOf(d.peer);
      if (!p) continue;
      items.push({
        peerId: p.id,
        kind: p.kind,
        title: d.peer.displayName,
        username: d.peer.username,
        unread: d.unreadCount,
        lastMessageDate: d.lastMessage ? d.lastMessage.date.toISOString() : null
      });
    }
    return { items, next: more ? String(skip + limit) : null };
  }

  async getHistory(q: { peerId: string; limit: number; offset: string | null; fromDate: number | null; toDate: number | null }): Promise<Page<MessageDto>> {
    const before = boundedNumber(q.offset);
    const res = await this.tg.getHistory(decodePeer(q.peerId), {
      limit: q.limit,
      offset: before !== null ? { id: before, date: 0 } : q.toDate !== null ? { id: 0, date: q.toDate } : undefined
    });
    const items: MessageDto[] = [];
    let cut = false;
    for (const m of res) {
      if (q.fromDate !== null && m.date.getTime() / 1000 < q.fromDate) {
        cut = true;
        break;
      }
      if (q.toDate !== null && m.date.getTime() / 1000 > q.toDate) continue;
      items.push(mapMessage(m, q.peerId));
    }
    const last = items[items.length - 1];
    return { items, next: !cut && last && res.length >= q.limit ? String(last.id) : null };
  }

  async searchMessages(q: { peerId: string | null; query: string; limit: number; offset: string | null }): Promise<Page<MessageDto>> {
    const pos = boundedNumber(q.offset);
    if (q.peerId) {
      const res = await this.tg.searchMessages({ chatId: decodePeer(q.peerId), query: q.query, limit: q.limit, offset: pos ?? undefined });
      const items = [...res].map((m) => mapMessage(m, q.peerId));
      const last = items[items.length - 1];
      return { items, next: last && res.length >= q.limit ? String(last.id) : null };
    }
    const skip = pos ?? 0;
    const items: MessageDto[] = [];
    let seen = 0;
    let more = false;
    for await (const m of this.tg.iterSearchGlobal({ query: q.query, limit: skip + q.limit + 1 })) {
      if (seen++ < skip) continue;
      if (items.length >= q.limit) {
        more = true;
        break;
      }
      items.push(mapMessage(m, null));
    }
    return { items, next: more ? String(skip + q.limit) : null };
  }

  async searchChannels(q: { query: string; limit: number }): Promise<ChannelDto[]> {
    const res = await this.tg.call({ _: 'contacts.search', q: q.query, limit: q.limit });
    const out: ChannelDto[] = [];
    for (const c of res.chats) {
      if (c._ !== 'channel' || !c.broadcast || !c.username || !c.accessHash) continue;
      out.push({ peerId: `c:${c.id}:${c.accessHash.toString()}`, title: c.title, username: c.username });
      if (out.length >= q.limit) break;
    }
    return out;
  }

  async getChannelPosts(q: { peerId: string; limit: number; offset: string | null }): Promise<Page<MessageDto>> {
    // Defence in depth: the resolved chat must be a broadcast channel, not a megagroup / supergroup / gigagroup.
    const chat = await this.tg.getChat(decodePeer(q.peerId));
    if (chat.chatType !== 'channel') throw new PostunError('FORBIDDEN');
    return this.getHistory({ ...q, fromDate: null, toDate: null });
  }

  private async media(peerId: string, messageId: number): Promise<Message | null> {
    const [m] = await this.tg.getMessages(decodePeer(peerId), [messageId]);
    return m ?? null;
  }

  async getMediaInfo(peerId: string, messageId: number): Promise<MediaInfoDto | null> {
    const m = await this.media(peerId, messageId);
    return m ? mapMedia(m) : null;
  }

  async openMediaStream(peerId: string, messageId: number, range: { start: number; end: number }): Promise<MediaStream> {
    const m = await this.media(peerId, messageId);
    const media = m?.media;
    const downloadable = ['photo', 'document', 'video', 'audio', 'voice', 'sticker'];
    if (!media || !downloadable.includes(media.type)) throw new PostunError('NOT_FOUND');
    const info = mapMedia(m);
    if (!info || info.size === null || range.end >= info.size) throw new PostunError('NOT_FOUND');
    const alignedStart = range.start - (range.start % ALIGN);
    let skip = range.start - alignedStart;
    let remaining = range.end - range.start + 1;
    const upstream = this.tg.downloadAsStream(media as Photo | Document, {
      fileSize: info.size,
      offset: alignedStart,
      limit: range.end - alignedStart + 1,
      highWaterMark: 1024 * 1024
    });
    const reader = upstream.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (remaining > 0) {
            const { done, value } = await reader.read();
            if (done) throw new PostunError('UPSTREAM_UNAVAILABLE');
            let chunk = value;
            if (skip > 0) {
              const s = Math.min(skip, chunk.length);
              skip -= s;
              chunk = chunk.subarray(s);
              if (chunk.length === 0) continue;
            }
            if (chunk.length > remaining) chunk = chunk.subarray(0, remaining);
            remaining -= chunk.length;
            controller.enqueue(chunk);
            if (remaining === 0) {
              await reader.cancel().catch(() => undefined);
              controller.close();
            }
            return;
          }
        } catch (e) {
          controller.error(mapTelegramError(e));
        }
      },
      async cancel() {
        await reader.cancel().catch(() => undefined);
      }
    });
    return {
      stream,
      size: info.size,
      mimeType: info.mimeType,
      fileName: info.fileName,
      cancel: async () => {
        await reader.cancel().catch(() => undefined);
      }
    };
  }

  async close(): Promise<string | null> {
    let updated: string | null = null;
    try {
      const now = await this.tg.exportSession();
      if (now !== this.initial) updated = now;
    } catch {
      updated = null;
    }
    await this.tg.destroy().catch(() => undefined);
    return updated;
  }
}

export class MtcuteAdapter implements TelegramAdapter {
  constructor(private readonly apiId: number, private readonly apiHash: string) {}

  startQrLink(hooks: LinkHooks): LinkRun {
    const tg = makeClient(this.apiId, this.apiHash, true);
    const ac = new AbortController();
    const done = (async (): Promise<LinkResult> => {
      try {
        await tg.connect();
        const user = await tg.signInQr({
          onUrlUpdated: (url, expires) => hooks.onQr(url, expires),
          password: () => hooks.requestPassword(),
          invalidPasswordCallback: () => hooks.onPasswordInvalid(),
          abortSignal: ac.signal
        });
        if (!Number.isSafeInteger(user.id)) throw new PostunError('INTERNAL');
        return { telegramId: String(user.id), firstName: user.firstName, session: await tg.exportSession() };
      } finally {
        await tg.destroy().catch(() => undefined);
      }
    })();
    return { done, cancel: () => ac.abort() };
  }

  async open(session: string): Promise<TelegramSession> {
    const tg = makeClient(this.apiId, this.apiHash);
    try {
      await tg.importSession(session, true);
      await tg.connect();
    } catch (e) {
      await tg.destroy().catch(() => undefined);
      throw mapTelegramError(e);
    }
    return new MtcuteSession(tg, session);
  }

  async logOut(session: string): Promise<void> {
    const tg = makeClient(this.apiId, this.apiHash);
    try {
      await tg.importSession(session, true);
      await tg.connect();
      await tg.logOut();
    } catch (e) {
      // An already dead authorisation is the outcome we want.
      if (mapTelegramError(e).code !== 'ACCOUNT_NOT_ACTIVE') throw mapTelegramError(e);
    } finally {
      await tg.destroy().catch(() => undefined);
    }
  }
}
