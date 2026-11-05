import { jsonResponse, PostunError, UuidSchema } from '@postun/contracts';
import { disconnectAccount, linkStatus, listAccounts, startLink, submitPassword } from './accounts';
import type { Config, Env } from './env';
import { now } from './env';
import { apiError, readJson } from './http';
import { listGrants, revokeAllGrants, revokeGrant } from './grants';
import { oauthServer } from './oauth';
import { assertCsrf, destroySession, getSession } from './sessions';
import type { Session } from './sessions';

export const DELETE_PHRASE = 'УДАЛИТЬ ПРОФИЛЬ';
/** The cabinet is localized; non-Russian locales ask for the English phrase. */
export const DELETE_PHRASES: readonly string[] = [DELETE_PHRASE, 'DELETE PROFILE'];

const ACCOUNT_ROUTE = /^\/api\/accounts\/([0-9a-fA-F-]{36})\/(link-status|password|disconnect)$/;
const GRANT_ROUTE = /^\/api\/grants\/([0-9a-fA-F-]{36})\/revoke$/;

/** Creating new access (linking, grants) needs an active profile that accepted the current beta terms. */
function assertMayConnect(session: Session, cfg: Config): Response | null {
  if (session.status !== 'active') return apiError('FORBIDDEN', { reason: 'SUSPENDED' });
  if (session.termsVersion !== cfg.termsVersion) return apiError('FORBIDDEN', { reason: 'TERMS_REQUIRED' });
  return null;
}

function assertNotDeleting(session: Session): Response | null {
  return session.status === 'deleting' ? apiError('FORBIDDEN', { reason: 'DELETING' }) : null;
}

export async function handleApi(env: Env, cfg: Config, req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const session = await getSession(env, cfg, req);

  if (path === '/api/session' && method === 'GET') {
    if (!session) return jsonResponse({ authenticated: false, loginUrl: `${cfg.authIssuer}/login`, beta: true, registrationOpen: cfg.registrationOpen });
    return jsonResponse({
      authenticated: true,
      beta: true,
      principal: { id: session.principalId, status: session.status, plan: 'beta_free' },
      termsRequired: session.termsVersion !== cfg.termsVersion,
      termsVersion: cfg.termsVersion,
      termsUrl: `${cfg.authIssuer}/terms`,
      csrfToken: session.csrf,
      registrationOpen: cfg.registrationOpen
    });
  }
  if (!session) return apiError('UNAUTHENTICATED');

  if (method === 'POST') assertCsrf(req, cfg, session);
  else if (method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });

  const pid = session.principalId;
  const oauth = (): ReturnType<ReturnType<typeof oauthServer>['getOAuthApi']> => oauthServer(cfg).getOAuthApi(env);

  if (path === '/api/accounts' && method === 'GET') return jsonResponse({ accounts: await listAccounts(env, pid) });

  if (path === '/api/accounts/link' && method === 'POST') {
    const denied = assertMayConnect(session, cfg);
    if (denied) return denied;
    const body = await readJson(req);
    return jsonResponse(await startLink(env, pid, body['label']), 201);
  }

  const acc = ACCOUNT_ROUTE.exec(path);
  if (acc) {
    const accountId = (acc[1] as string).toLowerCase();
    const action = acc[2];
    if (!UuidSchema.safeParse(accountId).success) return apiError('NOT_FOUND');
    if (action === 'link-status' && method === 'GET') {
      const d = assertNotDeleting(session);
      return d ?? jsonResponse(await linkStatus(env, cfg, pid, accountId));
    }
    if (action === 'password' && method === 'POST') {
      const denied = assertMayConnect(session, cfg);
      if (denied) return denied;
      const body = await readJson(req);
      return jsonResponse(await submitPassword(env, cfg, pid, accountId, body['password'])); // never stored or logged
    }
    if (action === 'disconnect' && method === 'POST') {
      const d = assertNotDeleting(session);
      if (d) return d;
      await disconnectAccount(env, pid, accountId);
      return jsonResponse({ ok: true });
    }
    return apiError('NOT_FOUND');
  }

  if (path === '/api/grants' && method === 'GET') {
    const d = assertNotDeleting(session);
    return d ?? jsonResponse({ grants: await listGrants(env, oauth(), pid) });
  }
  const gr = GRANT_ROUTE.exec(path);
  if (gr && method === 'POST') {
    const grantId = (gr[1] as string).toLowerCase();
    await revokeGrant(env, oauth(), pid, grantId);
    return jsonResponse({ ok: true });
  }

  if (path === '/api/usage' && method === 'GET') {
    const d = assertNotDeleting(session);
    if (d) return d;
    try {
      return jsonResponse({ usage: await env.VAULT.getUsage(pid) });
    } catch {
      throw new PostunError('UPSTREAM_UNAVAILABLE');
    }
  }

  if (path === '/api/profile/delete' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body['confirm'] !== 'string' || !DELETE_PHRASES.includes(body['confirm'])) return apiError('INVALID_INPUT', { reason: 'CONFIRM_PHRASE' });
    return deleteProfile(env, cfg, oauth(), session);
  }

  return apiError('NOT_FOUND');
}

export async function handleLogout(env: Env, cfg: Config, req: Request): Promise<Response> {
  const session = await getSession(env, cfg, req);
  if (!session) return apiError('UNAUTHENTICATED');
  assertCsrf(req, cfg, session);
  const cookie = await destroySession(env, cfg, session);
  const res = jsonResponse({ ok: true });
  res.headers.append('set-cookie', cookie);
  return res;
}

/** Deny + revoke every grant, wipe the vault, then delete D1 rows leaving a tombstone (principal_id + deleted_at). */
async function deleteProfile(env: Env, cfg: Config, oauth: ReturnType<ReturnType<typeof oauthServer>['getOAuthApi']>, session: Session): Promise<Response> {
  const pid = session.principalId;
  const db = env.CONTROL_DB;
  await db.prepare("UPDATE principals SET status = 'deleting' WHERE principal_id = ?1 AND status != 'deleted'").bind(pid).run();
  try {
    await revokeAllGrants(env, oauth, pid);
    await env.VAULT.deletePrincipal(pid);
  } catch (err) {
    if (err instanceof PostunError) throw err;
    throw new PostunError('UPSTREAM_UNAVAILABLE'); // stays 'deleting'; the same request can be repeated
  }
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM web_sessions WHERE principal_id = ?1').bind(pid),
    db.prepare('DELETE FROM grant_reference WHERE principal_id = ?1').bind(pid),
    db.prepare('DELETE FROM linked_accounts WHERE principal_id = ?1').bind(pid),
    db.prepare('DELETE FROM entitlements WHERE principal_id = ?1').bind(pid),
    db
      .prepare(
        "UPDATE principals SET status = 'deleted', oidc_issuer = NULL, oidc_subject = NULL, primary_telegram_id_hmac = NULL, telegram_id_enc = NULL, accepted_terms_version = NULL, accepted_terms_at = NULL, deleted_at = ?2 WHERE principal_id = ?1"
      )
      .bind(pid, t)
  ]);
  void cfg;
  const res = jsonResponse({ ok: true });
  res.headers.append('set-cookie', '__Host-postun_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  return res;
}
