import { oauthServer } from './oauth';
import { loadConfig, now } from './env';
import type { Env } from './env';

const AUDIT_RETENTION = 30 * 86_400;
const PENDING_MAX_AGE = 3600;
const CURSOR_KEY = 'postun:purge-cursor';

/** Hourly retention sweep. Logs only fixed codes. */
export async function runScheduled(env: Env): Promise<void> {
  const t = now();
  const db = env.CONTROL_DB;
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
