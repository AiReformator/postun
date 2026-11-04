import { PostunError } from '@postun/contracts';

/** Maps SDK/Telegram failures to safe codes. Raw messages and payloads are never kept. */
export function mapTelegramError(err: unknown): PostunError {
  if (err instanceof PostunError) return err;
  const e = err as { text?: unknown; code?: unknown; name?: unknown } | null;
  const text = typeof e?.text === 'string' ? e.text : '';
  const flood = /^(?:FLOOD_PREMIUM_WAIT|FLOOD_WAIT|SLOWMODE_WAIT)_(\d{1,7})$/.exec(text);
  if (flood?.[1]) return new PostunError('RATE_LIMITED', Number(flood[1]));
  if (text === 'AUTH_KEY_UNREGISTERED' || text === 'SESSION_REVOKED' || text === 'USER_DEACTIVATED' || text === 'AUTH_KEY_DUPLICATED' || text === 'SESSION_EXPIRED') {
    return new PostunError('ACCOUNT_NOT_ACTIVE');
  }
  if (text === 'PEER_ID_INVALID' || text === 'CHANNEL_INVALID' || text === 'CHANNEL_PRIVATE' || text === 'MSG_ID_INVALID') return new PostunError('NOT_FOUND');
  const name = typeof e?.name === 'string' ? e.name : '';
  if (name === 'MtTimeoutError' || name === 'MtcuteTimeoutError' || /Timeout|Network|Connection/i.test(name)) return new PostunError('UPSTREAM_UNAVAILABLE');
  if (typeof e?.code === 'number' && e.code >= 500) return new PostunError('UPSTREAM_UNAVAILABLE');
  return new PostunError('INTERNAL');
}
