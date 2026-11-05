import { importHmacKey, newId, PostunError, telegramIdIndex } from '@postun/contracts';
import type { LinkedAccountView, LinkState, Scope } from '@postun/contracts';
import type { Config, Env } from './env';
import { now } from './env';

export const MAX_ACCOUNTS = 10;
const PENDING_TTL = 600;

/** Browser-safe link state: never carries the Telegram id or the cleartext label of the vault. */
export type PublicLinkState =
  | { state: 'waiting_scan'; qrUrl: string; expiresAt: string }
  | { state: 'need_password'; hint: string | null; invalidAttempts?: number }
  | { state: 'active' }
  | { state: 'failed'; code: 'EXPIRED' | 'PASSWORD_INVALID' | 'RATE_LIMITED' | 'UPSTREAM' | 'CANCELLED' | 'NOT_ALLOWED' };

interface AccountRow {
  account_id: string;
  status: 'pending' | 'active' | 'revocation_pending' | 'disconnected';
  label: string | null;
  telegram_id_hmac: string | null;
  failure_code: string | null;
  created_at: number;
}

const ROW = 'account_id, status, label, telegram_id_hmac, failure_code, created_at';

export async function listAccounts(env: Env, principalId: string): Promise<LinkedAccountView[]> {
  const rs = await env.CONTROL_DB.prepare(`SELECT ${ROW} FROM linked_accounts WHERE principal_id = ?1 AND status != 'disconnected' ORDER BY created_at`)
    .bind(principalId)
    .all<AccountRow>();
  return rs.results.map((r) => ({
    accountId: r.account_id,
    status: r.status,
    label: r.label ?? 'Аккаунт Telegram',
    createdAt: new Date(r.created_at * 1000).toISOString()
  }));
}

export function cleanLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new PostunError('INVALID_INPUT');
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (s.length === 0 || s.length > 40) throw new PostunError('INVALID_INPUT');
  return s;
}

async function getAccount(env: Env, principalId: string, accountId: string): Promise<AccountRow> {
  const row = await env.CONTROL_DB.prepare(`SELECT ${ROW} FROM linked_accounts WHERE account_id = ?1 AND principal_id = ?2`)
    .bind(accountId, principalId)
    .first<AccountRow>();
  if (!row) throw new PostunError('NOT_FOUND');
  return row;
}

async function markDisconnected(env: Env, accountId: string, failure: string | null): Promise<void> {
  await env.CONTROL_DB.prepare("UPDATE linked_accounts SET status = 'disconnected', telegram_id_hmac = NULL, failure_code = ?2, updated_at = ?3 WHERE account_id = ?1")
    .bind(accountId, failure, now())
    .run();
}

async function bestEffortDisconnect(env: Env, principalId: string, accountId: string): Promise<void> {
  try {
    await env.VAULT.disconnectAccount(principalId, accountId);
  } catch {
    console.warn('vault_disconnect_failed');
  }
}

function upstream(): PostunError {
  return new PostunError('UPSTREAM_UNAVAILABLE');
}

export async function startLink(env: Env, principalId: string, label: unknown): Promise<{ accountId: string; link: PublicLinkState }> {
  const db = env.CONTROL_DB;
  const t = now();
  // Expire stale pending attempts first (they must not block a fresh one).
  const stale = await db
    .prepare("SELECT account_id FROM linked_accounts WHERE principal_id = ?1 AND status = 'pending' AND created_at <= ?2")
    .bind(principalId, t - PENDING_TTL)
    .all<{ account_id: string }>();
  for (const r of stale.results) {
    await bestEffortDisconnect(env, principalId, r.account_id);
    await markDisconnected(env, r.account_id, 'EXPIRED');
  }
  const accountId = newId();
  // Reserve first: the (account_id, operation_id) pair exists in D1 before any vault side effect.
  // One atomic statement enforces both the account cap and "one fresh pending link"; parallel requests cannot both pass.
  const ins = await db
    .prepare(
      `INSERT INTO linked_accounts (account_id, principal_id, status, label, operation_id, created_at, updated_at)
       SELECT ?1, ?2, 'pending', ?3, ?4, ?5, ?5
       WHERE (SELECT COUNT(*) FROM linked_accounts WHERE principal_id = ?2 AND status != 'disconnected') < ?6
         AND NOT EXISTS (SELECT 1 FROM linked_accounts WHERE principal_id = ?2 AND status = 'pending' AND created_at > ?7)`
    )
    .bind(accountId, principalId, cleanLabel(label), newId(), t, MAX_ACCOUNTS, t - PENDING_TTL)
    .run()
    .catch((err: unknown) => {
      if (/UNIQUE/i.test(String(err))) return null; // the partial unique index (migration 0002) caught a concurrent pending insert
      throw err;
    });
  if (!ins || ins.meta.changes !== 1) throw new PostunError('CONFLICT');
  try {
    const state = await env.VAULT.startLink(principalId, accountId);
    return { accountId, link: await settle(env, undefined, principalId, accountId, state) };
  } catch (err) {
    if (err instanceof PostunError) throw err;
    await bestEffortDisconnect(env, principalId, accountId);
    await markDisconnected(env, accountId, 'UPSTREAM');
    throw upstream();
  }
}

/** Translates a vault LinkState; on `authorized` it reserves telegram uniqueness and then activates. */
async function settle(env: Env, cfg: Config | undefined, principalId: string, accountId: string, state: LinkState): Promise<PublicLinkState> {
  switch (state.state) {
    case 'waiting_scan':
      return { state: 'waiting_scan', qrUrl: state.qrUrl, expiresAt: state.expiresAt };
    case 'need_password':
      return state.invalidAttempts ? { state: 'need_password', hint: state.hint, invalidAttempts: state.invalidAttempts } : { state: 'need_password', hint: state.hint };
    case 'failed':
      await bestEffortDisconnect(env, principalId, accountId);
      await markDisconnected(env, accountId, state.code);
      return { state: 'failed', code: state.code };
    case 'unknown':
      throw upstream();
    case 'authorized': {
      if (!cfg) throw upstream();
      return finalize(env, cfg, principalId, accountId, state.telegramId, state.label);
    }
  }
}

async function finalize(env: Env, cfg: Config, principalId: string, accountId: string, telegramId: string, vaultLabel: string): Promise<PublicLinkState> {
  let hmacKey: CryptoKey;
  try {
    hmacKey = await importHmacKey(cfg.identityHmacKey);
  } catch {
    throw new PostunError('CONFIG_MISSING');
  }
  const idx = await telegramIdIndex(hmacKey, telegramId);
  try {
    // Atomic uniqueness reservation (UNIQUE telegram_id_hmac). Re-running with the same value is a no-op (resumable).
    await env.CONTROL_DB.prepare(
      "UPDATE linked_accounts SET telegram_id_hmac = ?3, updated_at = ?4 WHERE account_id = ?1 AND principal_id = ?2 AND status = 'pending' AND (telegram_id_hmac IS NULL OR telegram_id_hmac = ?3)"
    )
      .bind(accountId, principalId, idx, now())
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) {
      // Another profile (or this one) already holds this Telegram account. Generic outcome, no owner details.
      await bestEffortDisconnect(env, principalId, accountId);
      await markDisconnected(env, accountId, 'NOT_ALLOWED');
      return { state: 'failed', code: 'NOT_ALLOWED' };
    }
    throw upstream();
  }
  return activate(env, principalId, accountId, vaultLabel);
}

async function activate(env: Env, principalId: string, accountId: string, vaultLabel: string | null): Promise<PublicLinkState> {
  try {
    await env.VAULT.activateAccount(principalId, accountId);
  } catch {
    throw upstream(); // stays pending with the reservation; the next poll resumes activation
  }
  await env.CONTROL_DB.prepare(
    "UPDATE linked_accounts SET status = 'active', label = COALESCE(NULLIF(label, ''), ?3), failure_code = NULL, updated_at = ?4 WHERE account_id = ?1 AND principal_id = ?2 AND status = 'pending'"
  )
    .bind(accountId, principalId, vaultLabel === null ? null : vaultLabel.slice(0, 40), now())
    .run();
  return { state: 'active' };
}

export async function linkStatus(env: Env, cfg: Config, principalId: string, accountId: string): Promise<PublicLinkState> {
  const row = await getAccount(env, principalId, accountId);
  if (row.status === 'active') return { state: 'active' };
  if (row.status === 'disconnected') {
    const code = row.failure_code;
    return { state: 'failed', code: code === 'NOT_ALLOWED' || code === 'EXPIRED' || code === 'PASSWORD_INVALID' || code === 'RATE_LIMITED' || code === 'CANCELLED' ? code : 'UPSTREAM' };
  }
  if (row.status !== 'pending') throw new PostunError('CONFLICT');
  // Reservation already made but activation did not complete: resume activation, do not ask the vault again.
  if (row.telegram_id_hmac) return activate(env, principalId, accountId, null);
  try {
    return await settle(env, cfg, principalId, accountId, await env.VAULT.linkStatus(principalId, accountId));
  } catch (err) {
    if (err instanceof PostunError) throw err;
    throw upstream();
  }
}

export async function submitPassword(env: Env, cfg: Config, principalId: string, accountId: string, password: unknown): Promise<PublicLinkState> {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256) throw new PostunError('INVALID_INPUT');
  const row = await getAccount(env, principalId, accountId);
  if (row.status !== 'pending') throw new PostunError('CONFLICT');
  try {
    return await settle(env, cfg, principalId, accountId, await env.VAULT.submitPassword(principalId, accountId, password));
  } catch (err) {
    if (err instanceof PostunError) throw err;
    throw upstream();
  }
}

/** Removes the account from every active grant (new grant version) and only then disconnects it in the vault. */
export async function disconnectAccount(env: Env, principalId: string, accountId: string): Promise<void> {
  const row = await getAccount(env, principalId, accountId);
  if (row.status === 'disconnected') return;
  const db = env.CONTROL_DB;
  await db.prepare("UPDATE linked_accounts SET status = 'revocation_pending', updated_at = ?3 WHERE account_id = ?1 AND principal_id = ?2").bind(accountId, principalId, now()).run();
  const grants = await db
    .prepare("SELECT grant_id, accounts_json, scopes_json, version FROM grant_reference WHERE principal_id = ?1 AND status IN ('active', 'revoking', 'expired')")
    .bind(principalId)
    .all<{ grant_id: string; accounts_json: string; scopes_json: string; version: number }>();
  try {
    for (const g of grants.results) {
      const accounts = (JSON.parse(g.accounts_json) as string[]).filter((a) => a !== accountId);
      if (accounts.length === (JSON.parse(g.accounts_json) as string[]).length) continue;
      const version = g.version + 1;
      await env.VAULT.putGrant(principalId, { grantId: g.grant_id, accounts, scopes: JSON.parse(g.scopes_json) as Scope[], version });
      await db
        .prepare('UPDATE grant_reference SET accounts_json = ?3, version = ?4, updated_at = ?5 WHERE grant_id = ?1 AND version = ?2')
        .bind(g.grant_id, g.version, JSON.stringify(accounts), version, now())
        .run();
    }
    await env.VAULT.disconnectAccount(principalId, accountId);
  } catch {
    throw upstream(); // account stays revocation_pending; retry is safe
  }
  await markDisconnected(env, accountId, null);
}
