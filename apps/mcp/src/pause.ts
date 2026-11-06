import type { ErrorCode, ErrorReason } from '@postun/contracts';

/**
 * How a refused tool call is shown to the AI client.
 *
 * A pause (RATE_LIMITED, or CONFLICT while the account's previous call is still running) is temporary: nothing is wrong
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

/** Seconds to wait before repeating a call that found the account busy with the user's previous call. */
export const BUSY_RETRY_SECONDS = 5;

export function isPause(f: Pick<ToolFailure, 'code'>): boolean {
  return f.code === 'RATE_LIMITED' || f.code === 'CONFLICT';
}

export function pauseSource(f: Pick<ToolFailure, 'reason'>): PauseSource {
  return f.reason !== undefined && TELEGRAM_REASONS.has(f.reason) ? 'telegram' : 'postun';
}

function duration(seconds: number): string {
  if (seconds < 120) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

function who(f: ToolFailure): string {
  if (f.code === 'CONFLICT') return 'Another call for this Telegram account is still running, so this one has to wait its turn.';
  switch (f.reason) {
    case 'FLOOD_WAIT':
      return 'Telegram asked this account to pause requests for a short time (FLOOD_WAIT). It does not limit what can be found.';
    case 'SLOWMODE_WAIT':
      return 'This chat has Telegram slow mode on, so it asks for a short pause.';
    case 'LOOKUP_CAP':
      return 'Postun spaces out global searches for this account (about one per second); this is Postun\'s own pacing, not Telegram.';
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
    seconds <= SHORT_PAUSE_SECONDS
      ? `Wait ${duration(seconds)}, then repeat exactly the same call with the same arguments (or cursor) and continue the task. The request itself is fine and nothing was found or missed yet.`
      : `Repeat the same call after ${duration(seconds)}. If the task cannot wait that long, tell the user the search is paused until then and will continue; do not report that the search was limited or refused.`;
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
    action: 'wait retryAfterSeconds, then repeat the same call with the same arguments',
    ...(f.reason === undefined ? {} : { reason: f.reason }),
    ...(f.hint === undefined ? {} : { hint: f.hint })
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
}
