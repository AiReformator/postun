import { PostunError, type SessionErrorCode } from '@postun/contracts';

const MAX_RETRY_SECONDS = 86_400;

function clampRetry(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.ceil(v) : 1;
  return Math.min(MAX_RETRY_SECONDS, Math.max(1, n));
}

const FLOOD_HINT = 'Telegram asked this account to pause requests. Wait retryAfterSeconds, then repeat the same call (same cursor).';

function rateLimited(kind: string, seconds: number): PostunError {
  // SLOWMODE_WAIT is a per-chat limit on writing, not an account flood: it must not start the account cooldown.
  const reason = kind === 'SLOWMODE_WAIT' ? 'SLOWMODE_WAIT' : 'FLOOD_WAIT';
  return new PostunError('RATE_LIMITED', seconds, { reason, hint: FLOOD_HINT });
}

const SESSION_ENDED_HINT =
  'Telegram ended this account\'s session (it was terminated in Telegram or expired), so Postun cannot read it now. Ask the user to open the Postun dashboard (https://app.postun.org) and press Reconnect next to the account; AI clients keep their access after reconnecting.';

/** Fixed texts per Telegram reason; the reason itself is a closed vocabulary, so nothing here comes from Telegram. */
const SESSION_ENDED_HINTS: Partial<Record<SessionErrorCode, string>> = {
  SESSION_REVOKED:
    'Telegram reports that this session was closed from the Devices list in Telegram (or by terminating other sessions), so Postun cannot read the account now. Ask the user to open the Postun dashboard (https://app.postun.org) and press Reconnect next to the account; AI clients keep their access after reconnecting.',
  USER_DEACTIVATED:
    'Telegram reports that this account was deleted or deactivated, so Postun cannot read it. Reconnecting will not help until the account works in Telegram again; ask the user to check the account in Telegram first, then use Reconnect in the Postun dashboard (https://app.postun.org).'
};

/**
 * The account's Telegram session is gone for good: the owner must reconnect it. Fixed text, never Telegram output.
 * `code` (when known) only selects a more precise fixed hint; the public error stays ACCOUNT_NOT_ACTIVE / SESSION_ENDED.
 */
export function sessionEnded(code?: SessionErrorCode): PostunError {
  return new PostunError('ACCOUNT_NOT_ACTIVE', undefined, {
    reason: 'SESSION_ENDED',
    hint: (code && SESSION_ENDED_HINTS[code]) ?? SESSION_ENDED_HINT,
    ...(code ? { sessionError: code } : {})
  });
}

/** True when a mapped error says Telegram ended the session (as opposed to Postun refusing to use it). */
export function isSessionEnded(err: unknown): boolean {
  return err instanceof PostunError && err.reason === 'SESSION_ENDED';
}

/** Maps SDK/Telegram failures to safe codes. Raw messages and payloads are never kept. */
export function mapTelegramError(err: unknown): PostunError {
  if (err instanceof PostunError) return err;
  const e = err as { text?: unknown; code?: unknown; name?: unknown } | null;
  const text = typeof e?.text === 'string' ? e.text : '';
  // mtcute's RpcError.fromTl rewrites 'FLOOD_WAIT_17' to the template 'FLOOD_WAIT_%d' and keeps the number in `seconds`.
  const templated = /^(FLOOD_PREMIUM_WAIT|FLOOD_WAIT|SLOWMODE_WAIT)_%d$/.exec(text);
  if (templated?.[1]) return rateLimited(templated[1], clampRetry((err as { seconds?: unknown }).seconds));
  // Fallback for plain, non-templated text.
  const flood = /^(FLOOD_PREMIUM_WAIT|FLOOD_WAIT|SLOWMODE_WAIT)_(\d{1,10})$/.exec(text);
  if (flood?.[1] && flood[2]) return rateLimited(flood[1], clampRetry(Number(flood[2])));
  if (text === 'AUTH_KEY_UNREGISTERED' || text === 'SESSION_REVOKED' || text === 'USER_DEACTIVATED' || text === 'SESSION_EXPIRED') {
    return sessionEnded(text);
  }
  // Two connections used the same key at once. Telegram may invalidate the key after this, so the call is refused and the
  // event is journaled (with a prompt health check), but the account is marked ended only when Telegram confirms the key is gone.
  if (text === 'AUTH_KEY_DUPLICATED') return new PostunError('ACCOUNT_NOT_ACTIVE', undefined, { sessionError: 'AUTH_KEY_DUPLICATED' });
  if (text === 'PEER_ID_INVALID' || text === 'CHANNEL_INVALID' || text === 'CHANNEL_PRIVATE' || text === 'MSG_ID_INVALID') return new PostunError('NOT_FOUND');
  const name = typeof e?.name === 'string' ? e.name : '';
  if (name === 'MtTimeoutError' || name === 'MtcuteTimeoutError' || /Timeout|Network|Connection/i.test(name)) return new PostunError('UPSTREAM_UNAVAILABLE');
  if (typeof e?.code === 'number' && e.code >= 500) return new PostunError('UPSTREAM_UNAVAILABLE');
  return new PostunError('INTERNAL');
}
