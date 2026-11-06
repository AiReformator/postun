// Pure logic for the public status page (contract postun-status/v1). No DOM, no network: shared by the browser bundle
// (assets/status.js) and the tests. Data comes from an external JSON that must be treated as untrusted.
export const STATUS_ORIGIN = 'https://status.postun.org';
export const STATUS_URL = `${STATUS_ORIGIN}/v1.json`;
export const SCHEMA = 'postun-status/v1';
export const COMPONENT_IDS = ['site', 'app', 'auth', 'mcp', 'telegram'];
export const STATES = ['operational', 'degraded', 'outage', 'unknown'];
/** Existing pill component class per state (css: .pill-ok / -warn / -bad / -unknown). */
export const PILL_CLASS = { operational: 'pill-ok', degraded: 'pill-warn', outage: 'pill-bad', unknown: 'pill-unknown' };
export const INCIDENT_STATES = ['ongoing', 'resolved'];

export const LIMITS = {
  bytes: 256 * 1024,
  components: 16,
  days: 400,
  incidents: 200,
  incidentComponents: 16,
  idLength: 32,
  shownIncidents: 10,
  barDays: 90
};
/** Data older than this is not trusted: the page shows "monitoring data unavailable", never "outage". */
export const STALE_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 10 * 60 * 1000;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPct = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.idLength && /^[a-z0-9_-]+$/.test(v);

/** Epoch ms of a strict ISO-8601 timestamp, or null. */
export function parseIso(v) {
  if (typeof v !== 'string' || v.length > 40 || !ISO.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}
/** True for a real calendar day "YYYY-MM-DD". */
export function isDay(v) {
  if (typeof v !== 'string' || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

class Invalid extends Error {}
const need = (cond, why) => {
  if (!cond) throw new Invalid(why);
};

function component(c) {
  need(isObj(c), 'component');
  need(isId(c.id), 'component id');
  need(STATES.includes(c.status), 'component status');
  need(c.latency_ms === null || (typeof c.latency_ms === 'number' && Number.isFinite(c.latency_ms) && c.latency_ms >= 0 && c.latency_ms <= 600000), 'latency');
  need(isObj(c.uptime), 'uptime');
  const uptime = {};
  for (const k of ['24h', '7d', '90d']) {
    need(isPct(c.uptime[k]), `uptime ${k}`);
    uptime[k] = c.uptime[k];
  }
  need(Array.isArray(c.days) && c.days.length <= LIMITS.days, 'days');
  const seen = new Set();
  const days = c.days.map((d) => {
    need(isObj(d) && isDay(d.date), 'day date');
    need(d.uptime === null || isPct(d.uptime), 'day uptime');
    need(!seen.has(d.date), 'duplicate day');
    seen.add(d.date);
    return { date: d.date, uptime: d.uptime };
  });
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { id: c.id, status: c.status, latency_ms: c.latency_ms, uptime, days };
}

function incident(i) {
  need(isObj(i), 'incident');
  const start = parseIso(i.start);
  need(start !== null, 'incident start');
  const end = i.end === null ? null : parseIso(i.end);
  need(i.end === null || end !== null, 'incident end');
  need(INCIDENT_STATES.includes(i.status), 'incident status');
  need((i.status === 'ongoing') === (i.end === null), 'incident end/status mismatch');
  need(end === null || end >= start, 'incident order');
  need(Array.isArray(i.components) && i.components.length <= LIMITS.incidentComponents && i.components.every(isId), 'incident components');
  return { start: i.start, end: i.end, startMs: start, endMs: end, components: [...new Set(i.components)], status: i.status };
}

/**
 * Strict validation. Unknown fields are ignored (dropped from the result); anything malformed is rejected as a whole.
 * Components with ids this page has no name for are dropped. Returns { ok: true, data } or { ok: false, reason }.
 */
export function validateStatusData(raw) {
  try {
    need(isObj(raw), 'not an object');
    need(raw.schema === SCHEMA, 'schema');
    const generatedMs = parseIso(raw.generated_at);
    need(generatedMs !== null, 'generated_at');
    need(STATES.includes(raw.overall), 'overall');
    need(Array.isArray(raw.components) && raw.components.length <= LIMITS.components, 'components');
    need(Array.isArray(raw.incidents) && raw.incidents.length <= LIMITS.incidents, 'incidents');
    const all = raw.components.map(component);
    need(new Set(all.map((c) => c.id)).size === all.length, 'duplicate component');
    const components = all.filter((c) => COMPONENT_IDS.includes(c.id));
    const incidents = raw.incidents.map(incident).sort((a, b) => b.startMs - a.startMs);
    // Nothing may lie in the future of the snapshot itself (a day bar for tomorrow, an incident that starts or ends later).
    const horizonMs = generatedMs + FUTURE_SKEW_MS;
    const horizonDay = new Date(horizonMs + 24 * 3600 * 1000).toISOString().slice(0, 10);
    need(all.every((c) => c.days.every((d) => d.date <= horizonDay)), 'future day');
    need(incidents.every((i) => i.startMs <= horizonMs && (i.endMs === null || i.endMs <= horizonMs)), 'future incident');
    return { ok: true, data: { schema: SCHEMA, generated_at: raw.generated_at, generatedMs, overall: raw.overall, components, incidents } };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Parses response text with a size cap, then validates. Never throws. */
export function parseStatusText(text) {
  if (typeof text !== 'string' || text.length > LIMITS.bytes) return { ok: false, reason: 'size' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  return validateStatusData(raw);
}

/**
 * What the page should show right now: { state, data, ageMs, reason }. Missing, invalid, stale or future-dated data gives
 * state "unknown" (monitoring data unavailable); an outage is only ever shown when fresh, valid data says so.
 */
const RANK = { operational: 1, degraded: 2, outage: 3 };

export function evaluate(result, now = Date.now()) {
  if (!result || !result.ok) return { state: 'unknown', data: null, ageMs: null, reason: result?.reason ?? 'unavailable' };
  const ageMs = now - result.data.generatedMs;
  if (ageMs > STALE_MS) return { state: 'unknown', data: null, ageMs, reason: 'stale' };
  if (ageMs < -FUTURE_SKEW_MS) return { state: 'unknown', data: null, ageMs, reason: 'future' };
  // The banner never looks better than the worst component: a feed saying "operational" while a component is down
  // shows the component's state.
  let state = result.data.overall;
  for (const c of result.data.components) if ((RANK[c.status] ?? 0) > (RANK[state] ?? 0)) state = c.status;
  return { state, data: result.data, ageMs: Math.max(0, ageMs), reason: null };
}

/** Level of one bar in the 90-day strip. */
export function dayLevel(uptime) {
  if (uptime === null || uptime === undefined) return 'none';
  if (uptime >= 99.5) return 'ok';
  if (uptime >= 95) return 'warn';
  return 'bad';
}

/** Exactly `count` bars ending at the newest known day; days before the history starts are padded with null. */
export function barDays(days, count = LIMITS.barDays) {
  const tail = days.slice(-count);
  return [...Array.from({ length: count - tail.length }, () => ({ date: null, uptime: null })), ...tail];
}
