/**
 * Local pacing of Telegram-touching tool calls. Pure and clock-injectable: every function takes `now` (ms) and
 * returns new state, so the Durable Object only persists what comes back.
 *
 * Telegram publishes no numeric limits (only FLOOD_WAIT_X); every default below is an initial, tunable guess,
 * overridable with the PACING_* variables (docs/02_ARCHITECTURE.md, "Pacing and Telegram flood protection").
 */

export interface PacingConfig {
  /** Token bucket capacity for Telegram-touching calls (burst). */
  burst: number;
  /** One token is added every refillMs (2000 ms is about 30 calls a minute sustained). */
  refillMs: number;
  /** Rolling one-hour cap on Telegram-touching calls. */
  hourlyCap: number;
  /** Stricter bucket for expensive lookups: sustained rate per minute ... */
  lookupPerMin: number;
  /** ... burst before lookups are spaced out (Telegram slowed contacts.search after about 20 calls in 10 s) ... */
  lookupBurst: number;
  /** ... and a rolling 24 h cap. */
  lookupPerDay: number;
  /** Soft cap of messages returned per rolling hour; 0 turns the budget off (the default). */
  messagesPerHour: number;
  /** Waits up to this long are queued (slept before the call) instead of refused. */
  maxSmoothMs: number;
  /** Added to a Telegram FLOOD_WAIT before it becomes the stored cooldown. */
  floodMarginSeconds: number;
}

/**
 * Generous by design (owner decision 2026-11-06): normal heavy work, such as reading 50 channels x 5000 messages,
 * must not be slowed by Postun. Only spam-like bursts are capped; the real protection is obeying Telegram's own
 * FLOOD_WAIT. Lookups are spaced to about one per second because production data showed Telegram slowing
 * contacts.search after about 20 calls in 10 s, while history and channel reads at 30+ calls a minute were fine.
 */
export const PACING_DEFAULTS: Readonly<PacingConfig> = {
  burst: 60,
  refillMs: 500,
  hourlyCap: 5000,
  lookupPerMin: 60,
  lookupBurst: 3,
  lookupPerDay: 2000,
  messagesPerHour: 0,
  maxSmoothMs: 3000,
  floodMarginSeconds: 5
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOUR_SLOT_MS = 60_000;
const DAY_SLOT_MS = 600_000;

function intVar(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : def;
}

/** Invalid or missing values fall back to the default; pacing is never silently disabled by a typo. */
export function pacingFromEnv(env: Readonly<Record<string, string | undefined>>): PacingConfig {
  const d = PACING_DEFAULTS;
  return {
    burst: intVar(env.PACING_BURST, d.burst, 1, 1_000_000),
    refillMs: intVar(env.PACING_REFILL_MS, d.refillMs, 1, 3_600_000),
    hourlyCap: intVar(env.PACING_HOURLY_CAP, d.hourlyCap, 1, 100_000_000),
    lookupPerMin: intVar(env.PACING_LOOKUP_PER_MIN, d.lookupPerMin, 1, 1_000_000),
    lookupBurst: intVar(env.PACING_LOOKUP_BURST, d.lookupBurst, 1, 1_000_000),
    lookupPerDay: intVar(env.PACING_LOOKUP_PER_DAY, d.lookupPerDay, 1, 100_000_000),
    messagesPerHour: intVar(env.PACING_MESSAGES_PER_HOUR, d.messagesPerHour, 0, 1_000_000_000),
    maxSmoothMs: intVar(env.PACING_MAX_SMOOTH_MS, d.maxSmoothMs, 0, 60_000),
    floodMarginSeconds: intVar(env.PACING_FLOOD_MARGIN_SECONDS, d.floodMarginSeconds, 0, 3600)
  };
}

export type PacingReason = 'LOCAL_PACING' | 'HOURLY_CAP' | 'LOOKUP_CAP' | 'MESSAGE_BUDGET';

// ------------------------------------------------------------------ token bucket

/** `tokens` may be negative: a smoothed call borrows from the future. */
export interface Bucket {
  tokens: number;
  at: number;
}

export function bucketLevel(b: Bucket | null, capacity: number, refillMs: number, now: number): number {
  if (b === null) return capacity;
  return Math.min(capacity, b.tokens + Math.max(0, now - b.at) / refillMs);
}

export type BucketTake = { ok: true; bucket: Bucket; delayMs: number } | { ok: false; retryAfterMs: number };

/** Takes one token. Waits of at most maxDelayMs are granted (and must be slept by the caller); longer ones are refused. */
export function bucketTake(b: Bucket | null, capacity: number, refillMs: number, now: number, maxDelayMs: number): BucketTake {
  const level = bucketLevel(b, capacity, refillMs, now);
  if (level >= 1) return { ok: true, bucket: { tokens: level - 1, at: now }, delayMs: 0 };
  const wait = Math.ceil((1 - level) * refillMs);
  if (wait <= maxDelayMs) return { ok: true, bucket: { tokens: level - 1, at: now }, delayMs: wait };
  return { ok: false, retryAfterMs: wait };
}

// ------------------------------------------------------------------ rolling window counter

/** Counts per slot, oldest first: [slotStart, n]. A slot is held until slotStart + slotMs + windowMs (never released early). */
export interface Window {
  slots: [number, number][];
}

const slotExpiry = (start: number, slotMs: number, windowMs: number) => start + slotMs + windowMs;

function live(w: Window, windowMs: number, slotMs: number, now: number): [number, number][] {
  return w.slots.filter(([start]) => slotExpiry(start, slotMs, windowMs) > now);
}

export function windowCount(w: Window, windowMs: number, slotMs: number, now: number): number {
  let c = 0;
  for (const [, n] of live(w, windowMs, slotMs, now)) c += n;
  return c;
}

export function windowAdd(w: Window, n: number, windowMs: number, slotMs: number, now: number): Window {
  const slots = live(w, windowMs, slotMs, now);
  const start = Math.floor(now / slotMs) * slotMs;
  const last = slots[slots.length - 1];
  if (last && last[0] === start) last[1] += n;
  else slots.push([start, n]);
  return { slots };
}

/** Milliseconds until `need` more units fit under `limit`; 0 if they fit already. */
export function windowFreeMs(w: Window, limit: number, need: number, windowMs: number, slotMs: number, now: number): number {
  const slots = live(w, windowMs, slotMs, now);
  let c = 0;
  for (const [, n] of slots) c += n;
  if (c + need <= limit) return 0;
  for (const [start, n] of slots) {
    c -= n;
    if (c + need <= limit) return Math.max(0, slotExpiry(start, slotMs, windowMs) - now);
  }
  return windowMs;
}

// ------------------------------------------------------------------ per-account state

export interface PacingState {
  calls: Bucket | null;
  lookups: Bucket | null;
  hour: Window;
  lookupDay: Window;
  messages: Window;
}

export const emptyPacing = (): PacingState => ({ calls: null, lookups: null, hour: { slots: [] }, lookupDay: { slots: [] }, messages: { slots: [] } });

const asSlots = (v: unknown): [number, number][] =>
  Array.isArray(v)
    ? v.filter((x): x is [number, number] => Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= 0)
    : [];
const asBucket = (v: unknown): Bucket | null => {
  const b = v as { tokens?: unknown; at?: unknown } | null;
  return b && typeof b.tokens === 'number' && typeof b.at === 'number' && Number.isFinite(b.tokens) && Number.isFinite(b.at) ? { tokens: b.tokens, at: b.at } : null;
};

export function parsePacing(json: string | null): PacingState {
  if (json === null) return emptyPacing();
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      calls: asBucket(o.calls),
      lookups: asBucket(o.lookups),
      hour: { slots: asSlots((o.hour as { slots?: unknown } | undefined)?.slots) },
      lookupDay: { slots: asSlots((o.lookupDay as { slots?: unknown } | undefined)?.slots) },
      messages: { slots: asSlots((o.messages as { slots?: unknown } | undefined)?.slots) }
    };
  } catch {
    return emptyPacing();
  }
}

export type CallKind = 'normal' | 'lookup';

export type Admission =
  | { ok: true; state: PacingState; delayMs: number }
  | { ok: false; reason: PacingReason; retryAfterSeconds: number };

const secs = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

/**
 * Decides whether one Telegram-touching call may start. All checks run first; the state only advances when every
 * one passes, so a refused call costs nothing.
 */
export function admit(state: PacingState, cfg: PacingConfig, kind: CallKind, now: number): Admission {
  const hourWait = windowFreeMs(state.hour, cfg.hourlyCap, 1, HOUR_MS, HOUR_SLOT_MS, now);
  if (hourWait > 0) return { ok: false, reason: 'HOURLY_CAP', retryAfterSeconds: secs(hourWait) };

  let lookups = state.lookups;
  let lookupDay = state.lookupDay;
  let lookupDelay = 0;
  if (kind === 'lookup') {
    const dayWait = windowFreeMs(state.lookupDay, cfg.lookupPerDay, 1, DAY_MS, DAY_SLOT_MS, now);
    if (dayWait > 0) return { ok: false, reason: 'LOOKUP_CAP', retryAfterSeconds: secs(dayWait) };
    const t = bucketTake(state.lookups, cfg.lookupBurst, lookupRefillMs(cfg), now, cfg.maxSmoothMs);
    if (!t.ok) return { ok: false, reason: 'LOOKUP_CAP', retryAfterSeconds: secs(t.retryAfterMs) };
    lookups = t.bucket;
    lookupDelay = t.delayMs;
    lookupDay = windowAdd(state.lookupDay, 1, DAY_MS, DAY_SLOT_MS, now);
  }

  const c = bucketTake(state.calls, cfg.burst, cfg.refillMs, now, cfg.maxSmoothMs);
  if (!c.ok) return { ok: false, reason: 'LOCAL_PACING', retryAfterSeconds: secs(c.retryAfterMs) };

  return {
    ok: true,
    delayMs: Math.max(c.delayMs, lookupDelay),
    state: { ...state, calls: c.bucket, lookups, lookupDay, hour: windowAdd(state.hour, 1, HOUR_MS, HOUR_SLOT_MS, now) }
  };
}

/** Null while the soft message budget has room; otherwise how long until it does. */
export function messageBudgetWait(state: PacingState, cfg: PacingConfig, now: number): number | null {
  if (cfg.messagesPerHour === 0) return null;
  const wait = windowFreeMs(state.messages, cfg.messagesPerHour, 1, HOUR_MS, HOUR_SLOT_MS, now);
  return wait > 0 ? secs(wait) : null;
}

export function addMessages(state: PacingState, n: number, now: number): PacingState {
  return n > 0 ? { ...state, messages: windowAdd(state.messages, n, HOUR_MS, HOUR_SLOT_MS, now) } : state;
}

const lookupRefillMs = (cfg: PacingConfig): number => Math.max(1, Math.floor(60_000 / cfg.lookupPerMin));

export interface LimitsView {
  callsRemainingNow: number;
  /** Present for lookup tools (search_channels, search_messages without peer). */
  lookupsRemainingNow?: number;
  /** Present only when the hourly message budget is on. */
  messagesRemainingThisHour?: number;
  nextCallNotBeforeSeconds: number;
  /** Recommended spacing between calls, in seconds. */
  paceSeconds: number;
}

/**
 * What the AI sees after a call. `kind` and `messageTool` describe the call that just ran, so the advice covers the
 * limits that apply to repeating it (lookup bucket and daily cap, message budget), not only the general bucket.
 */
export function limitsView(state: PacingState, cfg: PacingConfig, now: number, kind: CallKind = 'normal', messageTool = false): LimitsView {
  const level = bucketLevel(state.calls, cfg.burst, cfg.refillMs, now);
  const hourLeft = Math.max(0, cfg.hourlyCap - windowCount(state.hour, HOUR_MS, HOUR_SLOT_MS, now));
  const hourWait = windowFreeMs(state.hour, cfg.hourlyCap, 1, HOUR_MS, HOUR_SLOT_MS, now);
  let waitMs = Math.max(level >= 1 ? 0 : (1 - level) * cfg.refillMs, hourWait);
  const view: LimitsView = { callsRemainingNow: Math.max(0, Math.min(Math.floor(level), hourLeft)), nextCallNotBeforeSeconds: 0, paceSeconds: 0 };
  let paceMs = cfg.refillMs;
  if (kind === 'lookup') {
    const lv = bucketLevel(state.lookups, cfg.lookupBurst, lookupRefillMs(cfg), now);
    const dayLeft = Math.max(0, cfg.lookupPerDay - windowCount(state.lookupDay, DAY_MS, DAY_SLOT_MS, now));
    view.lookupsRemainingNow = Math.max(0, Math.min(Math.floor(lv), dayLeft));
    waitMs = Math.max(waitMs, lv >= 1 ? 0 : (1 - lv) * lookupRefillMs(cfg), windowFreeMs(state.lookupDay, cfg.lookupPerDay, 1, DAY_MS, DAY_SLOT_MS, now));
    paceMs = Math.max(paceMs, lookupRefillMs(cfg));
  }
  if (cfg.messagesPerHour > 0) {
    view.messagesRemainingThisHour = Math.max(0, cfg.messagesPerHour - windowCount(state.messages, HOUR_MS, HOUR_SLOT_MS, now));
    if (messageTool) waitMs = Math.max(waitMs, windowFreeMs(state.messages, cfg.messagesPerHour, 1, HOUR_MS, HOUR_SLOT_MS, now));
  }
  view.nextCallNotBeforeSeconds = waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
  view.paceSeconds = Math.round(paceMs / 100) / 10;
  return view;
}
