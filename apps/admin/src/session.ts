import { fromBase64Url, randomBytes, randomToken, readCookie, sha256, toBase64Url, utf8 } from '@postun/contracts';
import { roleLevel, type Cfg, type Role, ROLES } from './config';
import { refreshRoles } from './oidc';

export const COOKIE = '__Host-postun_admin';
export const FLOW_COOKIE = '__Host-postun_admin_flow';
export const IDLE_MS = 15 * 60_000;
export const ABSOLUTE_MS = 60 * 60_000;
export const REVALIDATE_MS = 5 * 60_000;
const LOCK_MS = 15_000;

export const hashOf = async (v: string): Promise<string> => toBase64Url(await sha256(v));

export interface Session {
  idHash: string;
  subject: string;
  issuer: string;
  roles: Role[];
  level: Role;
  mfa: boolean;
  csrf: string;
}
interface Row {
  id_hash: string;
  subject: string;
  issuer: string;
  roles: string;
  mfa: number;
  created_at: number;
  last_seen: number;
  last_revalidated: number;
  csrf_secret: string;
  refresh_enc: string | null;
}

async function seal(key: CryptoKey, plain: string, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, utf8(plain)));
  return `${toBase64Url(iv)}.${toBase64Url(ct)}`;
}
async function open(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  const [iv, ct] = sealed.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv ?? ''), additionalData: utf8(aad) }, key, fromBase64Url(ct ?? ''));
  return new TextDecoder().decode(pt);
}

export async function audit(db: D1Database, now: number, actor: string, action: string, target: string | null, outcome: string): Promise<void> {
  await db.prepare('INSERT INTO admin_audit (ts, actor_subject, action_code, target_opaque_id, outcome) VALUES (?, ?, ?, ?, ?)').bind(now, actor, action, target, outcome).run();
}

export const isBlocked = async (db: D1Database, issuer: string, subject: string): Promise<boolean> =>
  (await db.prepare('SELECT 1 AS x FROM admin_blocked_subjects WHERE issuer = ? AND subject = ?').bind(issuer, subject).first()) !== null;

export async function createSession(
  cfg: Cfg,
  db: D1Database,
  now: number,
  p: { subject: string; issuer: string; roles: Role[]; mfa: boolean; refreshToken: string | null }
): Promise<string> {
  const id = randomToken(32);
  const idHash = await hashOf(id);
  const enc = p.refreshToken ? await seal(cfg.sessionKey, p.refreshToken, idHash) : null;
  await db
    .prepare('INSERT INTO admin_sessions (id_hash, subject, issuer, roles, mfa, created_at, last_seen, last_revalidated, csrf_secret, refresh_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(idHash, p.subject, p.issuer, JSON.stringify(p.roles), p.mfa ? 1 : 0, now, now, now, randomToken(32), enc)
    .run();
  return id;
}

export const destroySession = async (db: D1Database, idHash: string): Promise<void> => {
  await db.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').bind(idHash).run();
};

function toSession(row: Row, roles: Role[]): Session | null {
  const level = roleLevel(roles);
  return level ? { idHash: row.id_hash, subject: row.subject, issuer: row.issuer, roles, level, mfa: row.mfa === 1, csrf: row.csrf_secret } : null;
}
const parseStoredRoles = (s: string): Role[] => {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? ROLES.filter((r) => v.includes(r)) : [];
  } catch {
    return [];
  }
};

export type AuthResult = { status: 'ok'; session: Session } | { status: 'none' | 'blocked' | 'unavailable' };

/**
 * Resolves the cookie to a live session. Checks idle/absolute expiry, the local block list and (every 5 min, or always
 * when `fresh`) re-reads the roles from IDP. A session that cannot be revalidated (no refresh token) ends 5 minutes
 * after login. Revoked roles destroy the session (AD-02).
 */
export async function authenticate(cfg: Cfg, db: D1Database, req: Request, now: number, fresh = false): Promise<AuthResult> {
  const id = readCookie(req, COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return { status: 'none' };
  const idHash = await hashOf(id);
  const row = await db.prepare('SELECT * FROM admin_sessions WHERE id_hash = ?').bind(idHash).first<Row>();
  if (!row) return { status: 'none' };
  if (now - row.created_at > ABSOLUTE_MS || now - row.last_seen > IDLE_MS) {
    await destroySession(db, idHash);
    return { status: 'none' };
  }
  if (await isBlocked(db, row.issuer, row.subject)) {
    await destroySession(db, idHash);
    await audit(db, now, row.subject, 'session_blocked', null, 'denied');
    return { status: 'blocked' };
  }
  let roles = parseStoredRoles(row.roles);
  if (fresh || now - row.last_revalidated >= REVALIDATE_MS) {
    if (!row.refresh_enc) {
      // No way to obtain fresh authorization: only the login moment itself counts as fresh.
      if (now - row.last_revalidated >= REVALIDATE_MS) {
        await destroySession(db, idHash);
        return { status: 'none' };
      }
    } else {
      const lock = await db.prepare('UPDATE admin_sessions SET revalidating_until = ? WHERE id_hash = ? AND revalidating_until <= ?').bind(now + LOCK_MS, idHash, now).run();
      if (lock.meta.changes === 0) {
        // Another request is refreshing (refresh tokens rotate): tolerate short staleness for reads only.
        if (!fresh && now - row.last_revalidated < REVALIDATE_MS + 60_000) return finish(row, roles);
        return { status: 'unavailable' };
      }
      let rt: string;
      try {
        rt = await open(cfg.sessionKey, row.refresh_enc, idHash);
      } catch {
        await destroySession(db, idHash);
        return { status: 'none' };
      }
      const r = await refreshRoles(cfg, row.subject, rt);
      if (r.status === 'unavailable') {
        await db.prepare('UPDATE admin_sessions SET revalidating_until = 0 WHERE id_hash = ?').bind(idHash).run();
        return { status: 'unavailable' };
      }
      if (r.status === 'revoked') {
        await destroySession(db, idHash);
        await audit(db, now, row.subject, 'session_revalidation', null, 'role_revoked');
        return { status: 'none' };
      }
      roles = r.roles;
      const enc = r.refreshToken ? await seal(cfg.sessionKey, r.refreshToken, idHash) : row.refresh_enc;
      await db
        .prepare('UPDATE admin_sessions SET roles = ?, last_revalidated = ?, last_seen = ?, refresh_enc = ?, revalidating_until = 0 WHERE id_hash = ?')
        .bind(JSON.stringify(roles), now, now, enc, idHash)
        .run();
      return finish(row, roles);
    }
  }
  if (now - row.last_seen > 30_000) await db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE id_hash = ?').bind(now, idHash).run();
  return finish(row, roles);
}

function finish(row: Row, roles: Role[]): AuthResult {
  const session = toSession(row, roles);
  return session ? { status: 'ok', session } : { status: 'none' };
}
