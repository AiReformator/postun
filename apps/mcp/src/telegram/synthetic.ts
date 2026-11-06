/**
 * In-memory synthetic Telegram, used only when TELEGRAM_ADAPTER=synthetic AND APP_ENV=test.
 * All data is generated deterministically from the session seed; nothing here is a real person.
 */
import type {
  ChannelDto, DialogDto, LinkHooks, LinkResult, LinkRun, MediaInfoDto, MediaStream, MessageDto, Page, PeerKind,
  TelegramAdapter, TelegramSession
} from './adapter';

export const SYNTH_SESSION_MARKER = 'SYNTH-SESSION-MARKER';
const BASE_DATE = Math.floor(Date.UTC(2026, 10, 1) / 1000);
const HISTORY_SIZE = 250;
import { encodeDialogOffset, parseDialogOffset } from './cursors';

const DIALOG_COUNT = 120;

/** Test hooks. Shared by the test and the DO because both run in the same isolate. */
export const syntheticControl = {
  /** Number of upstream operations opened (used to prove "denied before Telegram"). */
  opens: 0,
  ops: 0,
  active: 0,
  maxActive: 0,
  latencyMs: 0,
  chunkDelayMs: 0,
  throwNext: null as unknown,
  logoutFails: false,
  logouts: 0,
  require2fa: false,
  linkDelayMs: 5,
  nextTelegramId: '700000001',
  streamErrorAfterBytes: -1,
  reset(): void {
    this.opens = 0;
    this.ops = 0;
    this.active = 0;
    this.maxActive = 0;
    this.latencyMs = 0;
    this.chunkDelayMs = 0;
    this.throwNext = null;
    this.logoutFails = false;
    this.logouts = 0;
    this.require2fa = false;
    this.linkDelayMs = 5;
    this.nextTelegramId = '700000001';
    this.streamErrorAfterBytes = -1;
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function seedOf(session: string): string {
  const parts = session.split(':');
  if (parts[0] !== 'synthetic' || !parts[1]) {
    throw Object.assign(new Error('bad session'), { text: 'AUTH_KEY_UNREGISTERED', code: 401 });
  }
  return parts[1];
}

function hashNum(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 9000;
  return h;
}

function kindOf(i: number): PeerKind {
  return i % 3 === 0 ? 'user' : i % 3 === 1 ? 'group' : 'channel';
}
const KIND_PREFIX: Record<PeerKind, string> = { user: 'u', group: 'g', channel: 'c' };

function fileSize(id: number): number {
  return id === 10 ? 2_500_000 : id === 20 ? 9_000_000 : 1000 + id;
}

class SyntheticSession implements TelegramSession {
  constructor(private readonly seed: string) {}

  private async tick(): Promise<void> {
    syntheticControl.ops++;
    syntheticControl.active++;
    syntheticControl.maxActive = Math.max(syntheticControl.maxActive, syntheticControl.active);
    try {
      if (syntheticControl.latencyMs > 0) await sleep(syntheticControl.latencyMs);
    } finally {
      syntheticControl.active--;
    }
    const t = syntheticControl.throwNext;
    if (t) {
      syntheticControl.throwNext = null;
      throw t;
    }
  }

  private peer(i: number): string {
    return `${KIND_PREFIX[kindOf(i)]}:${hashNum(this.seed) * 1000 + i}:${i * 7919}`;
  }

  private message(peerId: string, id: number): MessageDto {
    const hasMedia = id % 10 === 0;
    const media: MediaInfoDto | null = hasMedia
      ? { kind: 'document', fileName: `SYNTH-FILE-${id}.bin`, mimeType: 'application/octet-stream', size: fileSize(id) }
      : null;
    return {
      id,
      peerId,
      date: new Date((BASE_DATE - (HISTORY_SIZE - id) * 60) * 1000).toISOString(),
      senderId: String(5000 + (id % 3)),
      senderName: `Synthetic Sender ${id % 3}`,
      text: `SYNTH-MSG-${this.seed}-${peerId}-${id}`,
      replyToId: id > 1 && id % 5 === 0 ? id - 1 : null,
      media
    };
  }

  private page(peerId: string, limit: number, offset: string | null, from: number | null, to: number | null, query?: string): Page<MessageDto> {
    let before = offset === null ? HISTORY_SIZE + 1 : Number(offset);
    if (!Number.isSafeInteger(before)) before = HISTORY_SIZE + 1;
    const items: MessageDto[] = [];
    let id = Math.min(before - 1, HISTORY_SIZE);
    let exhausted = false;
    while (items.length < limit) {
      if (id < 1) {
        exhausted = true;
        break;
      }
      const m = this.message(peerId, id);
      const ts = Date.parse(m.date) / 1000;
      if (to !== null && ts > to) {
        id--;
        continue;
      }
      if (from !== null && ts < from) {
        exhausted = true;
        break;
      }
      if (query === undefined || m.text.toLowerCase().includes(query.toLowerCase())) items.push(m);
      id--;
    }
    const last = items[items.length - 1];
    return { items, next: exhausted || !last ? null : String(last.id) };
  }

  async listDialogs(limit: number, offset: string | null): Promise<Page<DialogDto>> {
    await this.tick();
    // Native-style continuation: the last dialog's (date, id, peer), parsed strictly like the real adapter does.
    const o = parseDialogOffset(offset);
    let start = 0;
    if (o) {
      for (let i = 0; i < DIALOG_COUNT; i++) if (this.peer(i) === o.peer) start = i + 1;
    }
    const items: DialogDto[] = [];
    for (let i = start; i < Math.min(DIALOG_COUNT, start + limit); i++) {
      items.push({
        peerId: this.peer(i),
        kind: kindOf(i),
        title: `Synthetic Dialog ${i}`,
        username: i % 4 === 0 ? `synth_dialog_${i}` : null,
        unread: i % 5,
        lastMessageDate: new Date((BASE_DATE - i * 3600) * 1000).toISOString()
      });
    }
    const end = start + items.length;
    const lastIdx = end - 1;
    return {
      items,
      next: items.length === limit && end < DIALOG_COUNT ? encodeDialogOffset({ date: BASE_DATE - lastIdx * 3600, id: lastIdx + 1, peer: this.peer(lastIdx) }) : null
    };
  }

  async getHistory(q: { peerId: string; limit: number; offset: string | null; fromDate: number | null; toDate: number | null }): Promise<Page<MessageDto>> {
    await this.tick();
    return this.page(q.peerId, q.limit, q.offset, q.fromDate, q.toDate);
  }

  async searchMessages(q: { peerId: string | null; query: string; limit: number; offset: string | null }): Promise<Page<MessageDto>> {
    await this.tick();
    return this.page(q.peerId ?? this.peer(0), q.limit, q.offset, null, null, q.query);
  }

  async searchChannels(q: { query: string; limit: number }): Promise<ChannelDto[]> {
    await this.tick();
    return Array.from({ length: Math.min(3, q.limit) }, (_, i) => ({
      peerId: `c:${900000 + i}:${i + 1}`,
      title: `SYNTH-CHANNEL-${i}`,
      username: `synth_channel_${i}`
    }));
  }

  async getChannelPosts(q: { peerId: string; limit: number; offset: string | null }): Promise<Page<MessageDto>> {
    await this.tick();
    return this.page(q.peerId, q.limit, q.offset, null, null);
  }

  async getMediaInfo(peerId: string, messageId: number): Promise<MediaInfoDto | null> {
    await this.tick();
    if (messageId < 1 || messageId > HISTORY_SIZE) return null;
    return this.message(peerId, messageId).media;
  }

  async openMediaStream(peerId: string, messageId: number, range: { start: number; end: number }): Promise<MediaStream> {
    await this.tick();
    const m = this.message(peerId, messageId).media;
    if (!m || m.size === null) throw Object.assign(new Error('x'), { text: 'MSG_ID_INVALID' });
    const size = m.size;
    let pos = range.start;
    let delivered = 0;
    const CHUNK = 64 * 1024;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (cancelled) return;
        if (syntheticControl.chunkDelayMs > 0) await sleep(syntheticControl.chunkDelayMs);
        if (pos > range.end) {
          controller.close();
          return;
        }
        if (syntheticControl.streamErrorAfterBytes >= 0 && delivered >= syntheticControl.streamErrorAfterBytes) {
          controller.error(new Error('synthetic upstream failure'));
          return;
        }
        const n = Math.min(CHUNK, range.end - pos + 1);
        const buf = new Uint8Array(n);
        for (let i = 0; i < n; i++) buf[i] = ((pos + i) * 31 + 7) & 0xff;
        pos += n;
        delivered += n;
        controller.enqueue(buf);
      },
      cancel() {
        cancelled = true;
      }
    });
    return {
      stream,
      size,
      mimeType: m.mimeType,
      fileName: m.fileName,
      cancel: async () => {
        cancelled = true;
        await stream.cancel().catch(() => undefined);
      }
    };
  }

  async close(): Promise<string | null> {
    return null;
  }
}

export class SyntheticAdapter implements TelegramAdapter {
  startQrLink(hooks: LinkHooks): LinkRun {
    let cancelled = false;
    const done = (async (): Promise<LinkResult> => {
      hooks.onQr('tg://login?token=SYNTHETIC-QR-TOKEN', new Date(Date.now() + 60_000));
      await sleep(syntheticControl.linkDelayMs);
      if (cancelled) throw new Error('cancelled');
      if (syntheticControl.require2fa) {
        for (;;) {
          const pw = await hooks.requestPassword();
          if (pw === 'synthetic-password') break;
          hooks.onPasswordInvalid();
        }
      }
      const seed = crypto.randomUUID().slice(0, 8);
      return { telegramId: syntheticControl.nextTelegramId, firstName: 'Alice', session: `synthetic:${seed}:${SYNTH_SESSION_MARKER}` };
    })();
    return {
      done,
      cancel: () => {
        cancelled = true;
      }
    };
  }

  async open(session: string): Promise<TelegramSession> {
    const seed = seedOf(session);
    syntheticControl.opens++;
    if (syntheticControl.latencyMs > 0) await sleep(0);
    return new SyntheticSession(seed);
  }

  async logOut(session: string): Promise<void> {
    seedOf(session);
    if (syntheticControl.logoutFails) throw new Error('unreachable');
    syntheticControl.logouts++;
  }
}
