/**
 * Adapter-private continuation strings for Telegram-native pagination. A page costs a flat number of RPCs because the
 * continuation carries Telegram's own offsets (docs/02_ARCHITECTURE.md, "Cloudflare Free fit"), never a skip count.
 * The strings are HMAC-signed into cursors by tools.ts; this file only defines and strictly parses their shape.
 */
import { PostunError } from '@postun/contracts';

/** Dialog list offset (messages.getDialogs): date and id of the last dialog's top message and its peer. */
export interface DialogOffset {
  date: number;
  id: number;
  peer: string;
}

/** Global search offset (messages.searchGlobal): next rate, id of the last message and its chat. */
export interface SearchOffset {
  rate: number;
  id: number;
  peer: string;
}

const PEER = '[ugc]:\\d{1,16}:-?\\d{1,20}';
const DIALOG_RE = new RegExp(`^d1:(\\d{1,10}):(\\d{1,10}):(${PEER})$`);
const SEARCH_RE = new RegExp(`^g1:(\\d{1,10}):(\\d{1,10}):(${PEER})$`);

/** Cursors issued before native offsets were skip counts (a bare number); they are refused with a clear message. */
export function cursorExpired(): PostunError {
  return new PostunError('INVALID_INPUT', undefined, {
    reason: 'CURSOR_EXPIRED',
    message: 'Cursor expired, start again',
    hint: 'Repeat the call without a cursor.'
  });
}

export const encodeDialogOffset = (o: DialogOffset): string => `d1:${o.date}:${o.id}:${o.peer}`;
export const encodeSearchOffset = (o: SearchOffset): string => `g1:${o.rate}:${o.id}:${o.peer}`;

export function parseDialogOffset(raw: string | null): DialogOffset | null {
  if (raw === null) return null;
  const m = DIALOG_RE.exec(raw);
  if (!m) throw cursorExpired();
  return { date: Number(m[1]), id: Number(m[2]), peer: m[3] as string };
}

export function parseSearchOffset(raw: string | null): SearchOffset | null {
  if (raw === null) return null;
  const m = SEARCH_RE.exec(raw);
  if (!m) throw cursorExpired();
  return { rate: Number(m[1]), id: Number(m[2]), peer: m[3] as string };
}
