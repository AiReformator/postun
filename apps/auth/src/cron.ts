import { CONTROL_SNAPSHOT_FIELDS, controlSnapshotPoint, writeMetric, type ControlSnapshot } from '@postun/contracts';
import { oauthServer } from './oauth';
import { loadConfig, now } from './env';
import type { Env } from './env';

const AUDIT_RETENTION = 30 * 86_400;
const PENDING_MAX_AGE = 3600;
const CURSOR_KEY = 'postun:purge-cursor';

const DAY = 86_400;

/**
 * Counts for the hourly service-metrics snapshot (docs/03 "Service metrics"): one pass over each table, aggregates
 * only. Deleted principals keep their row (status 'deleted', identity columns cleared), so principals_total is the
 * cumulative number of registrations.
 */
export async function controlSnapshot(db: D1Database, t: number): Promise<ControlSnapshot> {
  const [p, a, g, s] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS principals_total, COALESCE(SUM(status = 'active'), 0) AS principals_active,
         COALESCE(SUM(status = 'suspended'), 0) AS principals_suspended, COALESCE(SUM(status IN ('deleting', 'deleted')), 0) AS principals_deleted,
         COALESCE(SUM(created_at > ?1), 0) AS principals_created_24h FROM principals`
      )
      .bind(t - DAY),
    db.prepare(
      `SELECT COALESCE(SUM(status = 'active'), 0) AS accounts_active, COALESCE(SUM(status = 'pending'), 0) AS accounts_pending,
       COUNT(DISTINCT CASE WHEN status = 'active' THEN principal_id END) AS principals_with_active_account FROM linked_accounts`
    ),
    db
      .prepare(
        `SELECT COALESCE(SUM(status = 'active'), 0) AS grants_active, COUNT(DISTINCT CASE WHEN status = 'active' THEN client_id END) AS grants_active_clients,
         COALESCE(SUM(created_at > ?1), 0) AS grants_created_24h FROM grant_reference`
      )
      .bind(t - DAY),
    db.prepare('SELECT COUNT(*) AS web_sessions_live FROM web_sessions WHERE idle_expires_at > ?1 AND absolute_expires_at > ?1').bind(t)
  ]);
  const row: Record<string, unknown> = Object.assign({}, ...[p, a, g, s].map((r) => (r?.results[0] ?? {}) as Record<string, unknown>));
  return Object.fromEntries(CONTROL_SNAPSHOT_FIELDS.map((f) => [f, Number(row[f] ?? 0)])) as ControlSnapshot;
}

/** Hourly retention sweep and service-metrics snapshot. Logs only fixed codes. */
export async function runScheduled(env: Env): Promise<void> {
  const t = now();
  const db = env.CONTROL_DB;
  // First and isolated: a failing snapshot never blocks retention, and a failing retention step never hides the metrics.
  if (env.METRICS) {
    try {
      writeMetric(env.METRICS, controlSnapshotPoint(await controlSnapshot(db, t)));
    } catch {
      console.warn('metrics_snapshot_failed');
    }
  }
  await db.prepare('DELETE FROM login_states WHERE expires_at <= ?1').bind(t).run();
  await db.prepare('DELETE FROM web_sessions WHERE idle_expires_at <= ?1 OR absolute_expires_at <= ?1').bind(t).run();
  await db.prepare('DELETE FROM admin_audit WHERE created_at < ?1').bind(t - AUDIT_RETENTION).run();

  // Abandoned link attempts: discard the vault side too, so no half-open session lingers.
  const stale = await db
    .prepare("SELECT account_id, principal_id FROM linked_accounts WHERE status = 'pending' AND telegram_id_hmac IS NULL AND created_at < ?1 LIMIT 20")
    .bind(t - PENDING_MAX_AGE)
    .all<{ account_id: string; principal_id: string }>();
  for (const a of stale.results) {
    try {
      await env.VAULT.disconnectAccount(a.principal_id, a.account_id);
      await db.prepare("UPDATE linked_accounts SET status = 'disconnected', failure_code = 'EXPIRED', updated_at = ?2 WHERE account_id = ?1").bind(a.account_id, t).run();
    } catch {
      console.warn('stale_link_cleanup_failed');
    }
  }

  try {
    const server = oauthServer(loadConfig(env));
    const cursor = (await env.OAUTH_KV.get(CURSOR_KEY)) ?? undefined;
    const result = await server.purgeExpiredData(env, cursor ? { batchSize: 100, cursor } : { batchSize: 100 });
    if (result.cursor) await env.OAUTH_KV.put(CURSOR_KEY, result.cursor, { expirationTtl: 86_400 });
    else await env.OAUTH_KV.delete(CURSOR_KEY);
  } catch {
    console.warn('oauth_purge_failed');
  }
}
