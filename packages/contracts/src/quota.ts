export const PLAN_BETA_FREE = 'beta_free' as const;
export type PlanId = typeof PLAN_BETA_FREE;

export interface QuotaPolicy {
  plan: PlanId;
  monthlySuccessLimit: number;
  monthlyByteLimit: number | null; // null = not enforced yet (measured separately)
  /** Successful operations per UTC day; null = no daily limit. */
  dailySuccessLimit: number | null;
}

/** Calendar day in UTC, e.g. "2026-11-05". */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Days retained for daily counters: today + 2 previous. */
export function retainedDays(now: Date = new Date()): string[] {
  return [0, 1, 2].map((i) => utcDay(new Date(now.getTime() - i * 86_400_000)));
}

/** Calendar month in UTC, e.g. "2026-11". */
export function utcMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Months retained for usage counters: current + 2 previous (docs/03 §4). */
export function retainedMonths(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(utcMonth(d));
  }
  return out;
}

function positiveInt(raw: string | undefined, name: string): number {
  if (raw === undefined || raw.trim() === '') throw new Error(`${name} is not configured`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** Fails closed: a missing success limit is a configuration error, not "unlimited". */
export function quotaPolicyFromEnv(env: { BETA_MONTHLY_SUCCESS_LIMIT?: string; BETA_MONTHLY_BYTE_LIMIT?: string; BETA_DAILY_SUCCESS_LIMIT?: string }): QuotaPolicy {
  const byteRaw = env.BETA_MONTHLY_BYTE_LIMIT;
  const dayRaw = env.BETA_DAILY_SUCCESS_LIMIT;
  return {
    plan: PLAN_BETA_FREE,
    monthlySuccessLimit: positiveInt(env.BETA_MONTHLY_SUCCESS_LIMIT, 'BETA_MONTHLY_SUCCESS_LIMIT'),
    monthlyByteLimit: byteRaw === undefined || byteRaw === '' ? null : positiveInt(byteRaw, 'BETA_MONTHLY_BYTE_LIMIT'),
    dailySuccessLimit: dayRaw === undefined || dayRaw === '' ? null : positiveInt(dayRaw, 'BETA_DAILY_SUCCESS_LIMIT')
  };
}

export const PRODUCT_MAX_FILE_BYTES = 512_000_000;

/** Enabled file limit; never above the product ceiling. 0 or missing = file download disabled. */
export function maxFileBytesFromEnv(env: { MAX_FILE_BYTES?: string }): number {
  const raw = env.MAX_FILE_BYTES;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('MAX_FILE_BYTES must be a non-negative integer');
  return Math.min(n, PRODUCT_MAX_FILE_BYTES);
}
