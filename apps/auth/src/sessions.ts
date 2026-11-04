import { clearHostCookie, hmac, hostCookie, originAllowed, PostunError, randomToken, readCookie, timingSafeEqual, toBase64Url, utf8 } from '@postun/contracts';
import type { Config, Env } from './env';
import { now } from './env';
import { loadKeys } from './keys';

export const SESSION_COOKIE = '__Host-postun_session';

export interface Session {
  principalId: string;
  status: 'active' | 'suspended' | 'deleting';
  termsVersion: string | null;
  csrf: string;
  token: string;
}

async function derive(cfg: Config, purpose: 'session-v1' | 'csrf-v1', token: string): Promise<string> {
  const { session } = await loadKeys(cfg);
  return toBase64Url(await hmac(session, purpose, token));
}

/** Creates a new opaque session; only a keyed hash of the id is stored. Returns the Set-Cookie header value. */
export async function createSession(env: Env, cfg: Config, principalId: string): Promise<string> {
  const token = randomToken(32);
  const t = now();
  await env.CONTROL_DB.prepare(
    'INSERT INTO web_sessions (session_hash, principal_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES (?1, ?2, ?3, ?3, ?4, ?5)'
  )
    .bind(await derive(cfg, 'session-v1', token), principalId, t, t + cfg.sessionIdleSeconds, t + cfg.sessionAbsoluteSeconds)
    .run();
  return hostCookie(SESSION_COOKIE, token, { maxAge: cfg.sessionAbsoluteSeconds });
}

export async function getSession(env: Env, cfg: Config, req: Request): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const hash = await derive(cfg, 'session-v1', token);
  const row = await env.CONTROL_DB.prepare(
    `SELECT s.principal_id, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, p.status, p.accepted_terms_version
       FROM web_sessions s JOIN principals p ON p.principal_id = s.principal_id WHERE s.session_hash = ?1`
  )
    .bind(hash)
    .first<{ principal_id: string; last_seen_at: number; idle_expires_at: number; absolute_expires_at: number; status: string; accepted_terms_version: string | null }>();
  if (!row) return null;
  const t = now();
  if (t >= row.idle_expires_at || t >= row.absolute_expires_at || row.status === 'deleted') {
    await env.CONTROL_DB.prepare('DELETE FROM web_sessions WHERE session_hash = ?1').bind(hash).run();
    return null;
  }
  if (t - row.last_seen_at > 300) {
    await env.CONTROL_DB.prepare('UPDATE web_sessions SET last_seen_at = ?2, idle_expires_at = ?3 WHERE session_hash = ?1')
      .bind(hash, t, Math.min(t + cfg.sessionIdleSeconds, row.absolute_expires_at))
      .run();
  }
  return {
    principalId: row.principal_id,
    status: row.status as Session['status'],
    termsVersion: row.accepted_terms_version,
    csrf: await derive(cfg, 'csrf-v1', token),
    token
  };
}

export async function destroySession(env: Env, cfg: Config, session: Session): Promise<string> {
  await env.CONTROL_DB.prepare('DELETE FROM web_sessions WHERE session_hash = ?1').bind(await derive(cfg, 'session-v1', session.token)).run();
  return clearHostCookie(SESSION_COOKIE);
}

/**
 * CSRF for every browser POST: exact Origin (APP_ORIGIN or AUTH_ISSUER) AND a token bound to the session,
 * sent as X-CSRF-Token (JSON API) or the `_csrf` field of server-rendered forms.
 */
export function assertCsrf(req: Request, cfg: Config, session: Session, formToken?: string): void {
  if (!originAllowed(req, [cfg.appOrigin, cfg.authIssuer])) throw new PostunError('FORBIDDEN');
  const supplied = req.headers.get('x-csrf-token') ?? formToken ?? '';
  if (!timingSafeEqual(utf8(supplied), utf8(session.csrf))) throw new PostunError('FORBIDDEN');
}
