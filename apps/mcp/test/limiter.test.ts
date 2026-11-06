import { describe, expect, it } from 'vitest';
import {
  addMessages, admit, bucketLevel, bucketTake, emptyPacing, limitsView, messageBudgetWait, pacingFromEnv, PACING_DEFAULTS, parsePacing,
  windowAdd, windowCount, windowFreeMs, type Admission, type Bucket, type PacingConfig, type PacingState
} from '../src/do/limiter';

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const cfg = (over: Partial<PacingConfig> = {}): PacingConfig => ({ ...PACING_DEFAULTS, ...over });

function must(a: Admission): { state: PacingState; delayMs: number } {
  if (!a.ok) throw new Error(`refused: ${a.reason}`);
  return a;
}

describe('pacingFromEnv', () => {
  it('uses the documented defaults when nothing is set', () => {
    expect(pacingFromEnv({})).toEqual({
      burst: 60, refillMs: 500, hourlyCap: 5000, lookupPerMin: 60, lookupBurst: 5, lookupPerDay: 2000, messagesPerHour: 0, maxSmoothMs: 15000, floodMarginSeconds: 5
    });
  });
  it('accepts valid overrides and falls back to the default for invalid ones', () => {
    const c = pacingFromEnv({ PACING_BURST: '5', PACING_REFILL_MS: 'abc', PACING_HOURLY_CAP: '-1', PACING_LOOKUP_PER_MIN: '1.5', PACING_MESSAGES_PER_HOUR: '' });
    expect(c.burst).toBe(5);
    expect(c.refillMs).toBe(500);
    expect(c.hourlyCap).toBe(5000);
    expect(c.lookupPerMin).toBe(60);
    expect(c.messagesPerHour).toBe(0);
    expect(pacingFromEnv({ PACING_MESSAGES_PER_HOUR: '20000', PACING_MAX_SMOOTH_MS: '999999' })).toMatchObject({ messagesPerHour: 20000, maxSmoothMs: 15000 });
  });
});

describe('token bucket', () => {
  it('starts full, drains by one per call and refills 1 per refillMs', () => {
    let b: Bucket | null = null;
    for (let i = 0; i < 20; i++) {
      const t = bucketTake(b, 20, 2000, T0, 0);
      expect(t.ok).toBe(true);
      if (t.ok) b = t.bucket;
    }
    expect(bucketLevel(b, 20, 2000, T0)).toBe(0);
    expect(bucketLevel(b, 20, 2000, T0 + 10_000)).toBe(5);
    expect(bucketLevel(b, 20, 2000, T0 + 10_000_000)).toBe(20);
  });
  it('refuses with the exact wait when no smoothing is allowed', () => {
    const t = bucketTake({ tokens: 0, at: T0 }, 20, 2000, T0 + 500, 0);
    expect(t).toEqual({ ok: false, retryAfterMs: 1500 });
  });
  it('grants a wait of at most maxDelayMs and borrows the token', () => {
    const t = bucketTake({ tokens: 0, at: T0 }, 20, 2000, T0 + 1500, 1000);
    expect(t.ok && t.delayMs).toBe(500);
    if (t.ok) expect(t.bucket.tokens).toBeCloseTo(-0.25);
  });
});

describe('rolling window', () => {
  const H = 3_600_000;
  const S = 60_000;
  it('counts within the window and holds a slot until it fully expired', () => {
    let w = { slots: [] as [number, number][] };
    w = windowAdd(w, 3, H, S, T0);
    w = windowAdd(w, 2, H, S, T0 + 10_000);
    expect(windowCount(w, H, S, T0 + 10_000)).toBe(5);
    expect(w.slots).toHaveLength(1);
    expect(windowCount(w, H, S, T0 + H)).toBe(5); // slot start + slot + window not reached yet: never released early
    expect(windowCount(w, H, S, T0 + H + S)).toBe(0);
  });
  it('reports when enough room frees up', () => {
    let w = { slots: [] as [number, number][] };
    w = windowAdd(w, 4, H, S, T0);
    w = windowAdd(w, 4, H, S, T0 + 30 * S);
    expect(windowFreeMs(w, 8, 1, H, S, T0 + 31 * S)).toBe(T0 + H + S - (T0 + 31 * S));
    expect(windowFreeMs(w, 9, 1, H, S, T0 + 31 * S)).toBe(0);
  });
});

describe('admit', () => {
  it('allows the burst, then refuses with LOCAL_PACING and a small retryAfter, without changing state', () => {
    const c = cfg({ burst: 3, hourlyCap: 1000, refillMs: 2000, maxSmoothMs: 1000 });
    let s = emptyPacing();
    for (let i = 0; i < 3; i++) s = must(admit(s, c, 'normal', T0)).state;
    const refused = admit(s, c, 'normal', T0);
    expect(refused).toEqual({ ok: false, reason: 'LOCAL_PACING', retryAfterSeconds: 2 });
    expect(admit(s, c, 'normal', T0 + 2000).ok).toBe(true);
  });
  it('smooths a wait of up to 1 s instead of refusing', () => {
    const c = cfg({ burst: 1, refillMs: 800, hourlyCap: 1000 });
    const s = must(admit(emptyPacing(), c, 'normal', T0)).state;
    const a = must(admit(s, c, 'normal', T0));
    expect(a.delayMs).toBe(800);
  });
  it('sustains about 120 calls a minute with the defaults (spam guard only)', () => {
    let s = emptyPacing();
    let ok = 0;
    for (let t = 0; t < 120_000; t += 100) {
      const a = admit(s, cfg({ hourlyCap: 100000 }), 'normal', T0 + t);
      if (a.ok && a.delayMs === 0) {
        s = a.state;
        ok++;
      }
    }
    // 60 burst + 2 per second over 2 minutes
    expect(ok).toBeGreaterThanOrEqual(60 + 239 - 1);
    expect(ok).toBeLessThanOrEqual(60 + 240 + 1);
  });
  it('enforces the hourly cap with HOURLY_CAP', () => {
    const c = cfg({ burst: 100, hourlyCap: 5, refillMs: 1 });
    let s = emptyPacing();
    for (let i = 0; i < 5; i++) s = must(admit(s, c, 'normal', T0 + i)).state;
    const r = admit(s, c, 'normal', T0 + 10);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('HOURLY_CAP');
      expect(r.retryAfterSeconds).toBe(Math.ceil((T0 - (T0 % 60_000) + 60_000 + 3_600_000 - (T0 + 10)) / 1000));
    }
  });
  it('applies the stricter lookup bucket and the daily lookup cap', () => {
    const c = cfg({ burst: 1000, refillMs: 1, hourlyCap: 100000, lookupPerMin: 10, lookupBurst: 10, lookupPerDay: 300, maxSmoothMs: 0 });
    let s = emptyPacing();
    for (let i = 0; i < 10; i++) s = must(admit(s, c, 'lookup', T0)).state;
    const r = admit(s, c, 'lookup', T0);
    expect(r).toEqual({ ok: false, reason: 'LOOKUP_CAP', retryAfterSeconds: 6 });
    expect(admit(s, c, 'normal', T0).ok).toBe(true); // normal calls are not affected by the lookup bucket
    expect(admit(s, c, 'lookup', T0 + 6000).ok).toBe(true);

    const d = cfg({ burst: 1000, refillMs: 1, hourlyCap: 100000, lookupPerMin: 1000, lookupBurst: 10, lookupPerDay: 3 });
    let s2 = emptyPacing();
    for (let i = 0; i < 3; i++) s2 = must(admit(s2, d, 'lookup', T0 + i * 1000)).state;
    const r2 = admit(s2, d, 'lookup', T0 + 5000);
    expect(!r2.ok && r2.reason).toBe('LOOKUP_CAP');
    expect(admit(s2, d, 'lookup', T0 + 25 * 3_600_000).ok).toBe(true);
  });
  it('a refused call consumes nothing', () => {
    const c = cfg({ burst: 5, hourlyCap: 1000, refillMs: 2000, lookupPerMin: 1, lookupBurst: 1, maxSmoothMs: 0 });
    let s = must(admit(emptyPacing(), c, 'lookup', T0)).state;
    const before = JSON.stringify(s);
    expect(admit(s, c, 'lookup', T0).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    s = must(admit(s, c, 'normal', T0)).state;
    expect(bucketLevel(s.calls, 5, 2000, T0)).toBe(3);
  });
});

describe('message budget and limits view', () => {
  it('refuses once the hourly budget is used and says when it frees', () => {
    const c = cfg({ messagesPerHour: 100 });
    let s = emptyPacing();
    expect(messageBudgetWait(s, c, T0)).toBeNull();
    s = addMessages(s, 100, T0);
    const wait = messageBudgetWait(s, c, T0 + 1000);
    expect(wait).toBe(Math.ceil((T0 - (T0 % 60_000) + 60_000 + 3_600_000 - (T0 + 1000)) / 1000));
    expect(messageBudgetWait(s, c, T0 + 2 * 3_600_000)).toBeNull();
  });
  it('limitsView reports remaining calls, messages and the next allowed time', () => {
    const c = cfg({ burst: 3, hourlyCap: 1000, messagesPerHour: 100, refillMs: 2000 });
    let s = emptyPacing();
    expect(limitsView(s, c, T0)).toEqual({ callsRemainingNow: 3, messagesRemainingThisHour: 100, nextCallNotBeforeSeconds: 0, paceSeconds: 2 });
    for (let i = 0; i < 3; i++) s = must(admit(s, c, 'normal', T0)).state;
    s = addMessages(s, 40, T0);
    expect(limitsView(s, c, T0)).toEqual({ callsRemainingNow: 0, messagesRemainingThisHour: 60, nextCallNotBeforeSeconds: 2, paceSeconds: 2 });
  });
  it('the message budget is off by default and then not reported', () => {
    const s = addMessages(emptyPacing(), 1_000_000, T0);
    expect(messageBudgetWait(s, cfg(), T0)).toBeNull();
    expect(limitsView(s, cfg(), T0, 'normal', true)).not.toHaveProperty('messagesRemainingThisHour');
  });
  it('queues lookups to about one per second instead of refusing (Telegram slowed contacts.search after ~20 in 10 s)', () => {
    // A client firing 20 global searches at once (ChatGPT does this) gets them all, spaced about one per second.
    let s = emptyPacing();
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) {
      const a = must(admit(s, cfg(), 'lookup', T0));
      delays.push(a.delayMs);
      s = a.state;
    }
    expect(delays.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(delays.slice(5)).toEqual(Array.from({ length: 15 }, (_, i) => (i + 1) * 1000));
    const r = admit(s, cfg(), 'lookup', T0);
    expect(!r.ok && r.reason).toBe('LOOKUP_CAP');
    const v = limitsView(s, cfg(), T0, 'lookup');
    expect(v.lookupsRemainingNow).toBe(0);
    expect(v.nextCallNotBeforeSeconds).toBe(16);
    expect(v.paceSeconds).toBe(1);
  });
  it('limitsView is capped by the hourly allowance', () => {
    const c = cfg({ burst: 20, hourlyCap: 2 });
    const s = must(admit(emptyPacing(), c, 'normal', T0)).state;
    expect(limitsView(s, c, T0).callsRemainingNow).toBe(1);
  });
});

describe('parsePacing', () => {
  it('survives garbage and round-trips real state', () => {
    expect(parsePacing(null)).toEqual(emptyPacing());
    expect(parsePacing('not json')).toEqual(emptyPacing());
    expect(parsePacing('{"calls":"x","hour":{"slots":[[1,"a"],[2,3]]}}').hour.slots).toEqual([[2, 3]]);
    const s = must(admit(emptyPacing(), cfg(), 'lookup', T0)).state;
    expect(parsePacing(JSON.stringify(s))).toEqual(s);
  });
});
