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
  controlSnapshot: 'control_snapshot'
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

const num = (v: number): number => (Number.isFinite(v) && v >= 0 ? v : 0);

export function mcpCallPoint(m: McpCallMetric) {
  return {
    indexes: [METRIC_KIND.mcpCall],
    blobs: [METRICS_SCHEMA, m.tool, m.outcome],
    doubles: [1, Math.round(num(m.durationMs)), m.firstOfDay ? 1 : 0, m.firstOfMonth ? 1 : 0]
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
export function writeMetric(ds: MetricsDataset | undefined, point: ReturnType<typeof mcpCallPoint> | ReturnType<typeof controlSnapshotPoint>): void {
  if (!ds) return;
  try {
    ds.writeDataPoint(point);
  } catch {
    // metrics are best effort by design
  }
}
