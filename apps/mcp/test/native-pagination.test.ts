import { describe, expect, it } from 'vitest';
import { MtcuteSession } from '../src/telegram/mtcute';
import { encodeDialogOffset, encodeSearchOffset } from '../src/telegram/cursors';

// The real adapter against a fake client: every page is exactly one RPC-shaped call anchored at Telegram's own offset.

const peerOf = (n: number) => ({ id: n, type: 'chat', chatType: 'channel', displayName: `Chat ${n}`, username: null, inputPeer: { _: 'inputPeerChannel', channelId: n, accessHash: { toString: () => '7' } } });
const dialog = (n: number) => ({ peer: peerOf(n), unreadCount: 0, raw: { topMessage: 1000 + n }, lastMessage: { date: new Date((2_000_000_000 - n) * 1000), raw: { date: 2_000_000_000 - n } } });
const message = (id: number) => ({ id, date: new Date(1_700_000_000_000), sender: null, chat: peerOf(1), text: 't', replyToMessage: null, media: null });

describe('list_dialogs pagination (mtcute adapter)', () => {
  /** `pinned` dialogs (numbered 9001...) come first and only with pinned:'only'; `selfAt` makes dialog n Saved Messages. */
  function session(total: number, opts: { pinned?: number; selfAt?: number } = {}) {
    const calls: Record<string, unknown>[] = [];
    const tg = {
      async *iterDialogs(p: { limit?: number; chunkSize?: number; offsetDate?: number; offsetId?: number; pinned?: string }) {
        calls.push(p);
        if (p.pinned === 'only') {
          for (let i = 1; i <= (opts.pinned ?? 0); i++) yield dialog(9000 + i);
          return;
        }
        // Behaves like messages.getDialogs with pinned excluded: one chunk, newest first, starting after the offset.
        const start = p.offsetId ? p.offsetId - 1000 : 0;
        for (let n = start + 1; n <= Math.min(total, start + (p.limit ?? 0)); n++) {
          const d = dialog(n);
          if (n === opts.selfAt) yield { ...d, peer: { ...d.peer, inputPeer: { _: 'inputPeerSelf' } } };
          else yield d;
        }
      }
    };
    return { s: new MtcuteSession(tg as never, 'x'), calls };
  }

  it('limit 100 is a single chunk of 100 (no skip + limit + 1 re-iteration, no look-ahead)', async () => {
    const { s, calls } = session(1000);
    const page = await s.listDialogs(100, null);
    expect(page.items).toHaveLength(100);
    expect(calls).toEqual([{ pinned: 'only' }, { limit: 100, chunkSize: 100, pinned: 'exclude' }]);
    expect(page.next).toBe(encodeDialogOffset({ date: 2_000_000_000 - 100, id: 1100, peer: 'c:100:7' }));
  });

  it('a deep page costs the same as the first page, anchored at the offset', async () => {
    const { s, calls } = session(1000);
    const first = await s.listDialogs(100, null);
    let next = first.next;
    for (let i = 0; i < 8; i++) next = (await s.listDialogs(100, next)).next;
    expect(calls).toHaveLength(10); // the first page also fetches the pinned block once
    const last = calls[calls.length - 1] as { limit: number; chunkSize: number; offsetId: number; offsetPeer: { channelId: number } };
    expect(last.limit).toBe(100);
    expect(last.chunkSize).toBe(100);
    expect(last.offsetId).toBe(1800);
    expect(last.offsetPeer.channelId).toBe(800);
    // mtcute normalizes a numeric offsetDate as milliseconds: the adapter must pass a Date of the real unix time.
    const sent = (last as unknown as { offsetDate: unknown }).offsetDate;
    expect(sent).toBeInstanceOf(Date);
    expect((sent as Date).getTime() / 1000).toBe(2_000_000_000 - 800);
  });

  it('has_more is "returned === limit": a short page ends the list', async () => {
    const { s } = session(130);
    const second = await s.listDialogs(100, (await s.listDialogs(100, null)).next);
    expect(second.items).toHaveLength(30);
    expect(second.next).toBeNull();
  });

  it('returns the whole pinned block on the first page and never anchors on a pinned dialog', async () => {
    const { s, calls } = session(20, { pinned: 8 });
    const first = await s.listDialogs(5, null);
    expect(first.items.map((d) => d.title)).toEqual([...Array.from({ length: 8 }, (_, i) => `Chat ${9001 + i}`), 'Chat 1', 'Chat 2', 'Chat 3', 'Chat 4', 'Chat 5']);
    expect(first.next).toBe(encodeDialogOffset({ date: 2_000_000_000 - 5, id: 1005, peer: 'c:5:7' }));
    const second = await s.listDialogs(5, first.next);
    expect(second.items.map((d) => d.title)).toEqual(['Chat 6', 'Chat 7', 'Chat 8', 'Chat 9', 'Chat 10']);
    expect(calls.filter((c) => c.pinned === 'only')).toHaveLength(1);
    expect(calls.slice(1).every((c) => c.pinned === 'exclude')).toBe(true);
  });

  it('anchors on the last encodable dialog when the page ends on Saved Messages (may repeat, never skips)', async () => {
    const { s } = session(30, { selfAt: 10 });
    const first = await s.listDialogs(10, null);
    expect(first.next).toBe(encodeDialogOffset({ date: 2_000_000_000 - 9, id: 1009, peer: 'c:9:7' }));
    const second = await s.listDialogs(10, first.next);
    expect(second.items.map((d) => d.title)).toContain('Chat 11'); // nothing after the anchor is skipped
  });

  it('refuses a pre-native skip cursor', async () => {
    const { s, calls } = session(10);
    await expect(s.listDialogs(10, '100')).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Cursor expired, start again' });
    expect(calls).toHaveLength(0);
  });
});

describe('global search pagination (mtcute adapter)', () => {
  function session(total: number) {
    const calls: Record<string, unknown>[] = [];
    const tg = {
      async searchGlobal(p: { query: string; limit: number; offset?: { rate: number; id: number } }) {
        calls.push(p);
        const start = p.offset ? p.offset.id : 0;
        const msgs = Array.from({ length: Math.max(0, Math.min(total, start + p.limit) - start) }, (_, i) => message(start + i + 1));
        const last = msgs[msgs.length - 1];
        return Object.assign(msgs, { next: last ? { rate: 555, peer: peerOf(1).inputPeer, id: last.id } : undefined });
      },
      iterSearchGlobal() {
        throw new Error('the skip-based iterator must not be used');
      }
    };
    return { s: new MtcuteSession(tg as never, 'x'), calls };
  }

  it('one searchGlobal RPC per page with the rate/peer/id offset, no look-ahead', async () => {
    const { s, calls } = session(1000);
    const q = { peerId: null, query: 'hello', limit: 100 };
    const first = await s.searchMessages({ ...q, offset: null });
    expect(first.items).toHaveLength(100);
    expect(first.next).toBe(encodeSearchOffset({ rate: 555, id: 100, peer: 'c:1:7' }));
    const second = await s.searchMessages({ ...q, offset: first.next });
    expect(second.items).toHaveLength(100);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ query: 'hello', limit: 100 });
    expect(calls[1]).toMatchObject({ limit: 100, offset: { rate: 555, id: 100, peer: { channelId: 1 } } });
  });

  it('a short page ends the list; a skip cursor is refused before any RPC', async () => {
    const { s, calls } = session(130);
    const q = { peerId: null, query: 'x', limit: 100 };
    const second = await s.searchMessages({ ...q, offset: (await s.searchMessages({ ...q, offset: null })).next });
    expect(second.items).toHaveLength(30);
    expect(second.next).toBeNull();
    const before = calls.length;
    await expect(s.searchMessages({ ...q, offset: '100' })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Cursor expired, start again' });
    expect(calls).toHaveLength(before);
  });
});
