import { PostunError } from '@postun/contracts';

const MAX_RETRY_SECONDS = 86_400;

function clampRetry(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.ceil(v) : 1;
  return Math.min(MAX_RETRY_SECONDS, Math.max(1, n));
}

/** Maps SDK/Telegram failures to safe codes. Raw messages and payloads are never kept. */
export function mapTelegramError(err: unknown): PostunError {
  if (err instanceof PostunError) return err;
  const e = err as { text?: unknown; code?: unknown; name?: unknown } | null;
  const text = typeof e?.text === 'string' ? e.text : '';
  // mtcute's RpcError.fromTl rewrites 'FLOOD_WAIT_17' to the template 'FLOOD_WAIT_%d' and keeps the number in `seconds`.
  const templated = /^(?:FLOOD_PREMIUM_WAIT|FLOOD_WAIT|SLOWMODE_WAIT)_%d$/.test(text);
  if (templated) return new PostunError('RATE_LIMITED', clampRetry((err as { seconds?: unknown }).seconds));
  // Fallback for plain, non-templated text.
  const flood = /^(?:FLOOD_PREMIUM_WAIT|FLOOD_WAIT|SLOWMODE_WAIT)_(\d{1,10})$/.exec(text);
  if (flood?.[1]) return new PostunError('RATE_LIMITED', clampRetry(Number(flood[1])));
  if (text === 'AUTH_KEY_UNREGISTERED' || text === 'SESSION_REVOKED' || text === 'USER_DEACTIVATED' || text === 'AUTH_KEY_DUPLICATED' || text === 'SESSION_EXPIRED') {
    return new PostunError('ACCOUNT_NOT_ACTIVE');
  }
  if (text === 'PEER_ID_INVALID' || text === 'CHANNEL_INVALID' || text === 'CHANNEL_PRIVATE' || text === 'MSG_ID_INVALID') return new PostunError('NOT_FOUND');
  const name = typeof e?.name === 'string' ? e.name : '';
  if (name === 'MtTimeoutError' || name === 'MtcuteTimeoutError' || /Timeout|Network|Connection/i.test(name)) return new PostunError('UPSTREAM_UNAVAILABLE');
  if (typeof e?.code === 'number' && e.code >= 500) return new PostunError('UPSTREAM_UNAVAILABLE');
  return new PostunError('INTERNAL');
}
