import { GrantPropsSchema, newId, PostunError } from '@postun/contracts';
import type { GrantProps, Scope } from '@postun/contracts';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from './env';
import { now } from './env';

export interface GrantView {
  grantId: string;
  clientName: string;
  accounts: string[];
  scopes: Scope[];
  version: number;
  createdAt: string;
}

interface GrantRow {
  grant_id: string;
  client_id: string;
  client_name: string | null;
  accounts_json: string;
  scopes_json: string;
  version: number;
  status: string;
  created_at: number;
}

/** Library grant id for one of our grants (we store our grant_id in the grant metadata). */
async function libraryGrantIds(oauth: OAuthHelpers, principalId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await oauth.listUserGrants(principalId, cursor ? { limit: 1000, cursor } : { limit: 1000 });
    for (const g of page.items) {
      const m = g.metadata as { grantId?: unknown } | null;
      if (m && typeof m.grantId === 'string') out.set(m.grantId, g.id);
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listGrants(env: Env, oauth: OAuthHelpers, principalId: string): Promise<GrantView[]> {
  const rs = await env.CONTROL_DB.prepare(
    "SELECT grant_id, client_id, client_name, accounts_json, scopes_json, version, status, created_at FROM grant_reference WHERE principal_id = ?1 AND status = 'active' ORDER BY created_at DESC"
  )
    .bind(principalId)
    .all<GrantRow>();
  if (rs.results.length === 0) return [];
  const live = await libraryGrantIds(oauth, principalId);
  const out: GrantView[] = [];
  for (const r of rs.results) {
    if (!live.has(r.grant_id)) {
      // Refresh token lifetime ended (or library record gone): tokens cannot work any more.
      await env.CONTROL_DB.prepare("UPDATE grant_reference SET status = 'expired', updated_at = ?2 WHERE grant_id = ?1 AND status = 'active'").bind(r.grant_id, now()).run();
      continue;
    }
    out.push({
      grantId: r.grant_id,
      clientName: r.client_name ?? r.client_id,
      accounts: JSON.parse(r.accounts_json) as string[],
      scopes: JSON.parse(r.scopes_json) as Scope[],
      version: r.version,
      createdAt: new Date(r.created_at * 1000).toISOString()
    });
  }
  return out;
}

/** Accounts offered to a grant must be ACTIVE and owned by the principal (server-side check, never the form). */
export async function ownedActiveAccounts(env: Env, principalId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rs = await env.CONTROL_DB.prepare(
    `SELECT account_id FROM linked_accounts WHERE principal_id = ?1 AND status = 'active' AND account_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`
  )
    .bind(principalId, ...ids)
    .all<{ account_id: string }>();
  return rs.results.map((r) => r.account_id);
}

export async function createGrant(
  env: Env,
  principalId: string,
  client: { id: string; name: string },
  accounts: string[],
  scopes: Scope[]
): Promise<GrantProps> {
  const grantId = newId();
  const t = now();
  await env.CONTROL_DB.prepare(
    "INSERT INTO grant_reference (grant_id, principal_id, client_id, client_name, accounts_json, scopes_json, version, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'active', ?7, ?7)"
  )
    .bind(grantId, principalId, client.id, client.name.slice(0, 100), JSON.stringify(accounts), JSON.stringify(scopes), t)
    .run();
  try {
    await env.VAULT.putGrant(principalId, { grantId, accounts, scopes, version: 1 });
  } catch {
    await env.CONTROL_DB.prepare("UPDATE grant_reference SET status = 'revoked', revoked_at = ?2, updated_at = ?2 WHERE grant_id = ?1").bind(grantId, t).run();
    throw new PostunError('UPSTREAM_UNAVAILABLE');
  }
  return GrantPropsSchema.parse({ principalId, grantId, accounts, scopes, grantVersion: 1 });
}

/**
 * AU-04: the authoritative deny state in the vault is written FIRST. Only after it succeeds are the library's
 * token records revoked (KV is eventually consistent and is never the source of truth for revocation).
 */
export async function revokeGrant(env: Env, oauth: OAuthHelpers, principalId: string, grantId: string): Promise<void> {
  const row = await env.CONTROL_DB.prepare('SELECT status FROM grant_reference WHERE grant_id = ?1 AND principal_id = ?2').bind(grantId, principalId).first<{ status: string }>();
  if (!row) throw new PostunError('NOT_FOUND');
  if (row.status === 'revoked') return;
  const t = now();
  try {
    await env.VAULT.denyGrant(principalId, grantId);
  } catch {
    throw new PostunError('UPSTREAM_UNAVAILABLE'); // nothing else is touched: the grant stays usable and visible, retry is safe
  }
  await env.CONTROL_DB.prepare("UPDATE grant_reference SET status = 'revoking', updated_at = ?2 WHERE grant_id = ?1 AND status != 'revoked'").bind(grantId, t).run();
  const libId = (await libraryGrantIds(oauth, principalId)).get(grantId);
  if (libId) await oauth.revokeGrant(libId, principalId);
  await env.CONTROL_DB.prepare("UPDATE grant_reference SET status = 'revoked', revoked_at = ?2, updated_at = ?2 WHERE grant_id = ?1").bind(grantId, t).run();
}

export async function revokeAllGrants(env: Env, oauth: OAuthHelpers, principalId: string): Promise<void> {
  const rs = await env.CONTROL_DB.prepare("SELECT grant_id FROM grant_reference WHERE principal_id = ?1 AND status IN ('active', 'revoking')").bind(principalId).all<{ grant_id: string }>();
  for (const r of rs.results) await revokeGrant(env, oauth, principalId, r.grant_id);
  // Library grants without a D1 reference (should not exist) are removed too.
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await oauth.listUserGrants(principalId, cursor ? { limit: 1000, cursor } : { limit: 1000 });
    for (const g of page.items) await oauth.revokeGrant(g.id, principalId);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
}

export async function activeGrantIdsForClient(env: Env, principalId: string, clientId: string): Promise<string[]> {
  const rs = await env.CONTROL_DB.prepare("SELECT grant_id FROM grant_reference WHERE principal_id = ?1 AND client_id = ?2 AND status IN ('active', 'revoking')").bind(principalId, clientId).all<{ grant_id: string }>();
  return rs.results.map((r) => r.grant_id);
}
