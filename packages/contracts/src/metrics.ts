import type { ErrorCode } from './errors';
import type { ToolName } from './scopes';

/**
 * Service metrics written to Workers Analytics Engine (binding METRICS, docs/03_SECURITY_PRIVACY.md, "Service metrics").
 *
 * Aggregates only. A data point never carries a principal, grant, account, client or Telegram identifier, a tool
 * argument, a message or a file: only a fixed kind, a schema version, a tool name, a stable outcome code and numbers.
 * The column order below is the published schema; readers (the operator dashboard) select columns by position, so
 * add new doubles at the end and bump METRICS_SCHEMA only for an incompatible change.
 */
export const METRICS_SCHEMA = 'v1';

export const METRIC_KIND = {
  /** One point per MCP tools/call handled by postun-mcp. */
  mcpCall: 'mcp_call',
  /** One point per hourly control-plane snapshot written by postun-auth. */
  controlSnapshot: 'control_snapshot',
  /** One point per step of an AI client's OAuth connection handled by postun-auth. */
  oauthStep: 'oauth_step'
} as const;

/** Structural subset of AnalyticsEngineDataset, so the package needs no Workers types. */
export interface MetricsDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: (string | null)[]; doubles?: number[] }): void;
}

/** mcp_call: blob1 schema, blob2 tool, blob3 outcome; double1 calls (=1), double2 duration ms, double3 first counted
 * call of this principal in the UTC day (0/1), double4 first counted call in the UTC month (0/1). */
export interface McpCallMetric {
  tool: ToolName;
  outcome: 'ok' | ErrorCode;
  durationMs: number;
  firstOfDay: boolean;
  firstOfMonth: boolean;
  /** Refusal reason vocabulary (FLOOD_WAIT, LOCAL_PACING, ...); empty when none. Never free text. */
  reason?: string;
  /** Items returned (messages, dialogs or channels); 0 on errors. */
  items?: number;
  /** Seconds Telegram or Postun asked to wait; 0 when none. */
  retryAfterSeconds?: number;
}

/** control_snapshot doubles, in column order (double1 … double12). */
export const CONTROL_SNAPSHOT_FIELDS = [
  'principals_total',
  'principals_active',
  'principals_suspended',
  'principals_deleted',
  'principals_created_24h',
  'accounts_active',
  'accounts_pending',
  'principals_with_active_account',
  'grants_active',
  'grants_active_clients',
  'grants_created_24h',
  'web_sessions_live'
] as const;

export type ControlSnapshot = Record<(typeof CONTROL_SNAPSHOT_FIELDS)[number], number>;

/**
 * oauth_step: blob1 schema, blob2 step, blob3 outcome; double1 count (=1). Shows where a client's connection stops
 * (consent shown → approved → code exchanged) without knowing who or which client. Shares blob columns with
 * mcp_call, so always filter by index1.
 * - consent_shown / consent_approved / consent_denied: the consent page and the user's decision;
 * - consent_rejected: the submitted form was refused (outcome pick_required, account_unavailable, scopes_not_requested);
 * - consent_repeat: Allow was submitted again on a page that was already approved (back button, second click);
 * - consent_stale: the page had expired, was used by a failed attempt, or belonged to another browser;
 * - register: dynamic client registration; token_code / token_refresh / token_other: the token endpoint by grant type.
 */
export const OAUTH_STEPS = [
  'consent_shown',
  'consent_approved',
  'consent_denied',
  'consent_rejected',
  'consent_repeat',
  'consent_stale',
  'register',
  'token_code',
  'token_refresh',
  'token_other'
] as const;
export type OauthStep = (typeof OAUTH_STEPS)[number];

/** Closed outcome vocabulary: ok, OAuth (RFC 6749/7591/8707) error codes, consent refusals, or http_<status>. */
export const OAUTH_OUTCOMES = [
  'ok',
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_target',
  'invalid_client_metadata',
  'invalid_redirect_uri',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'pick_required',
  'account_unavailable',
  'scopes_not_requested'
] as const;

const HTTP_OUTCOME_RE = /^http_[1-5][0-9]{2}$/;

/** Anything outside OAUTH_STEPS / OAUTH_OUTCOMES (or http_<status>) is recorded as 'other', never as given. */
export function oauthStepPoint(step: OauthStep, outcome = 'ok') {
  const known = (OAUTH_OUTCOMES as readonly string[]).includes(outcome) || HTTP_OUTCOME_RE.test(outcome);
  return {
    indexes: [METRIC_KIND.oauthStep],
    blobs: [METRICS_SCHEMA, OAUTH_STEPS.includes(step) ? step : 'other', known ? outcome : 'other'],
    doubles: [1]
  };
}

const num = (v: number): number => (Number.isFinite(v) && v >= 0 ? v : 0);

const REASON_RE = /^[A-Z_]{1,32}$/;

export function mcpCallPoint(m: McpCallMetric) {
  return {
    indexes: [METRIC_KIND.mcpCall],
    // Columns are append-only within schema v1: blob4 = reason, double5 = items, double6 = retry-after seconds.
    blobs: [METRICS_SCHEMA, m.tool, m.outcome, REASON_RE.test(m.reason ?? '') ? (m.reason as string) : ''],
    doubles: [1, Math.round(num(m.durationMs)), m.firstOfDay ? 1 : 0, m.firstOfMonth ? 1 : 0, Math.round(num(m.items ?? 0)), Math.round(num(m.retryAfterSeconds ?? 0))]
  };
}

export function controlSnapshotPoint(s: ControlSnapshot) {
  return {
    indexes: [METRIC_KIND.controlSnapshot],
    blobs: [METRICS_SCHEMA],
    doubles: CONTROL_SNAPSHOT_FIELDS.map((f) => num(s[f]))
  };
}

/** Writes one point; a missing binding or a failing write never affects the request that produced it. */
export function writeMetric(
  ds: MetricsDataset | undefined,
  point: ReturnType<typeof mcpCallPoint> | ReturnType<typeof controlSnapshotPoint> | ReturnType<typeof oauthStepPoint>
): void {
  if (!ds) return;
  try {
    ds.writeDataPoint(point);
  } catch {
    // metrics are best effort by design
  }
}
