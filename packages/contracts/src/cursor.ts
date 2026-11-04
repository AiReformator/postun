/**
 * Opaque pagination cursors. A cursor is signed and bound to principal + account + dialog + tool,
 * so a cursor issued for one account cannot be replayed against another (AU-02).
 */
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './encoding';
import { hmac, hmacVerify } from './crypto';
import { PostunError } from './errors';

export interface CursorBinding {
  principalId: string;
  accountId: string;
  tool: string;
  scope: string; // e.g. dialog peer id or "*"
}

export interface CursorPayload {
  o: string; // upstream offset (opaque to clients)
  exp: number; // epoch seconds
}

const CURSOR_TTL_SECONDS = 60 * 60;

export async function encodeCursor(key: CryptoKey, b: CursorBinding, offset: string, now = Date.now()): Promise<string> {
  const payload: CursorPayload = { o: offset, exp: Math.floor(now / 1000) + CURSOR_TTL_SECONDS };
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  const mac = toBase64Url(await hmac(key, 'cursor-v1', b.principalId, b.accountId, b.tool, b.scope, body));
  return `${body}.${mac}`;
}

export async function decodeCursor(key: CryptoKey, b: CursorBinding, cursor: string, now = Date.now()): Promise<string> {
  const [body, mac, extra] = cursor.split('.');
  if (!body || !mac || extra !== undefined || cursor.length > 2048) throw new PostunError('INVALID_CURSOR');
  const ok = await hmacVerify(key, fromBase64Url(mac), 'cursor-v1', b.principalId, b.accountId, b.tool, b.scope, body).catch(() => false);
  if (!ok) throw new PostunError('INVALID_CURSOR');
  const payload = JSON.parse(fromUtf8(fromBase64Url(body))) as CursorPayload;
  if (typeof payload.o !== 'string' || typeof payload.exp !== 'number' || payload.exp * 1000 < now) {
    throw new PostunError('INVALID_CURSOR');
  }
  return payload.o;
}
