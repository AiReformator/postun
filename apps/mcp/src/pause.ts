import type { ErrorCode, ErrorReason } from '@postun/contracts';

/**
 * How a refused tool call is shown to the AI client.
 *
 * A pause (RATE_LIMITED, or CONFLICT with reason ACCOUNT_BUSY while the account's previous call or the same operation is
 * still running) is temporary: nothing is wrong
 * with the request, the search is not limited, and the same call succeeds after the wait. Clients such as ChatGPT
 * otherwise read an error as a final refusal and report to the user that "Telegram limited the search". So a pause
 * carries status "paused" and, first in the JSON, one plain sentence that says it is a pause, who paused (Postun's own
 * pacing or Telegram), how long to wait and that the same call should simply be repeated. The text stays one JSON
 * object, so clients that parse it keep working.
 */

export interface ToolFailure {
  code: ErrorCode;
  message: string;
  retryAfterSeconds?: number;
  reason?: ErrorReason;
  hint?: string;
}

export type PauseSource = 'postun' | 'telegram';

const TELEGRAM_REASONS: ReadonlySet<string> = new Set(['FLOOD_WAIT', 'SLOWMODE_WAIT']);

/** A wait the AI can sit out within the task; longer pauses are reported to the user with when they end. */
const SHORT_PAUSE_SECONDS = 120;

/**
 * Pauses up to this long are absorbed by Postun itself when the call is simply repeated: the pacing queue and the
 * cooldown wait-out both cover up to PACING_MAX_SMOOTH_MS (15 s by default) within the call's wait budget.
 */
const REPEAT_NOW_SECONDS = 15;

/** Seconds to wait before repeating a call that found the account busy with the user's previous call. */
export const BUSY_RETRY_SECONDS = 5;

/** Only waits are pauses; a CONFLICT without ACCOUNT_BUSY (operation_id reused for another request) is a real error. */
export function isPause(f: Pick<ToolFailure, 'code' | 'reason'>): boolean {
  return f.code === 'RATE_LIMITED' || (f.code === 'CONFLICT' && f.reason === 'ACCOUNT_BUSY');
}

export function pauseSource(f: Pick<ToolFailure, 'reason'>): PauseSource {
  return f.reason !== undefined && TELEGRAM_REASONS.has(f.reason) ? 'telegram' : 'postun';
}

export function duration(seconds: number): string {
  if (seconds < 120) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}

function who(f: ToolFailure): string {
  if (f.code === 'CONFLICT') return 'Another call for this Telegram account (or this same operation) is still running, so this one has to wait its turn.';
  switch (f.reason) {
    case 'FLOOD_WAIT':
      return 'Telegram itself asked this account to pause requests (FLOOD_WAIT). This is a Telegram wait, not a refusal of the request, and it does not limit what can be found.';
    case 'SLOWMODE_WAIT':
      return 'This chat has Telegram slow mode on, so Telegram asks to wait before the next request to it.';
    case 'LOOKUP_CAP':
      return (f.retryAfterSeconds ?? 0) > SHORT_PAUSE_SECONDS
        ? 'Postun\'s daily allowance of global searches for this account is used up; this is Postun\'s own limit, not Telegram. Searching inside one chat (peer) is not counted.'
        : 'Postun spaces out global searches for this account (about one per second); this is Postun\'s own pacing, not Telegram.';
    case 'MESSAGE_BUDGET':
      return 'Postun\'s hourly message pacing for this account is reached; this is Postun\'s own pacing, not Telegram.';
    case 'HOURLY_CAP':
      return 'Postun\'s hourly call pacing for this account is reached; this is Postun\'s own pacing, not Telegram.';
    default:
      return 'Postun is spacing out calls for this account; this is Postun\'s own pacing, not Telegram.';
  }
}

/** The plain sentence that leads the JSON of a paused call. */
export function pauseText(f: ToolFailure): string {
  const seconds = Math.max(1, f.retryAfterSeconds ?? BUSY_RETRY_SECONDS);
  const head = `PAUSED, not refused: a temporary pause of ${duration(seconds)}. ${who(f)}`;
  const next =
    seconds <= REPEAT_NOW_SECONDS
      ? 'Repeat exactly the same call with the same arguments (or cursor) now: Postun queues it and waits out the rest of the pause itself. Then continue the task. The request itself is fine and nothing was found or missed yet.'
      : seconds <= SHORT_PAUSE_SECONDS
        ? `Wait ${duration(seconds)}, then repeat exactly the same call with the same arguments (or cursor) and continue the task. The request itself is fine and nothing was found or missed yet.`
        : `Repeat the same call after ${duration(seconds)}. If the task cannot wait that long, tell the user this search is on hold until then and can be run again; it was not refused or limited.`;
  return `${head} ${next} Calls for one account run one at a time, so make them one after another rather than in parallel.`;
}

/** MCP tools/call result for a failed call. */
export function toolErrorResult(f: ToolFailure): { isError: true; content: { type: 'text'; text: string }[] } {
  if (!isPause(f)) {
    const error = {
      code: f.code,
      message: f.message,
      ...(f.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: f.retryAfterSeconds }),
      ...(f.reason === undefined ? {} : { reason: f.reason }),
      ...(f.hint === undefined ? {} : { hint: f.hint })
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
  }
  const retryAfterSeconds = Math.max(1, f.retryAfterSeconds ?? BUSY_RETRY_SECONDS);
  const error = {
    status: 'paused',
    message: pauseText(f),
    code: f.code,
    temporary: true,
    source: pauseSource(f),
    retryAfterSeconds,
    action: retryAfterSeconds <= REPEAT_NOW_SECONDS ? 'repeat the same call with the same arguments now' : 'wait retryAfterSeconds, then repeat the same call with the same arguments',
    ...(f.reason === undefined ? {} : { reason: f.reason }),
    ...(f.hint === undefined ? {} : { hint: f.hint })
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
}
