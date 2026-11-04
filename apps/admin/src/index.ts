import { clearHostCookie, hostCookie, originAllowed, randomToken, readCookie, timingSafeEqual, utf8, withSecurityHeaders } from '@postun/contracts';
import { loadCfg, type Cfg } from './config';
import type { Env } from './env';
import { authorizationUrl, completeLogin, Denied, discover, endSessionUrl, IdpUnavailable, newLoginParams } from './oidc';
import { audit, authenticate, COOKIE, createSession, destroySession, FLOW_COOKIE, hashOf, isBlocked, ABSOLUTE_MS, type Session } from './session';
import { dashboard, flashText, loginPage, messagePage, type DashData } from './views';

export { ProjectionSink } from './projection';

const LOGIN_TTL_MS = 10 * 60_000;
const MAX_PENDING_LOGINS = 1000;
const AUDIT_RETENTION_MS = 30 * 24 * 3600_000;
const PAGE_SIZE = 50;
const QUOTA_KEY = 'beta_monthly_success_limit_desired';

type Ctx = { req: Request; env: Env; cfg: Cfg; url: URL; now: number; nonce: string };

function html(c: Ctx, status: number, body: (nonce: string) => string, headers: Record<string, string> = {}): Response {
  const csp = `default-src 'none'; style-src 'nonce-${c.nonce}'; form-action 'self' ${new URL(c.cfg.issuer).origin}; frame-ancestors 'none'; base-uri 'none'`;
  return withSecurityHeaders(new Response(body(c.nonce), { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } }), { 'Content-Security-Policy': csp });
}
const msg = (c: Ctx, status: number, title: string, text: string, headers?: Record<string, string>): Response => html(c, status, (n) => messagePage(n, title, text), headers);
const redirect = (c: Ctx, to: string, cookies: string[] = []): Response => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const k of cookies) h.append('set-cookie', k);
  return withSecurityHeaders(new Response(null, { status: 303, headers: h }), { 'Content-Security-Policy': `default-src 'none'; frame-ancestors 'none'` });
};

async function readForm(req: Request): Promise<URLSearchParams | null> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(req.headers.get('content-length') ?? '0') > 4096) return null;
  try {
    return new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Maps a non-ok authentication result to a response. */
function deny(c: Ctx, status: 'none' | 'blocked' | 'unavailable', write: boolean): Response {
  if (status === 'blocked') return msg(c, 403, 'Доступ запрещён', 'Доступ для этой учётной записи заблокирован.', { 'set-cookie': clearHostCookie(COOKIE) });
  if (status === 'unavailable') return msg(c, 503, 'Временно недоступно', 'Не удалось подтвердить полномочия в IDP. Повторите позже.');
  const headers = { 'set-cookie': clearHostCookie(COOKIE) };
  return write ? msg(c, 401, 'Требуется вход', 'Сессия отсутствует или истекла.', headers) : html(c, 401, loginPage, headers);
}

async function login(c: Ctx): Promise<Response> {
  const as = await discover(c.cfg);
  const pending = await c.env.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM login_states WHERE expires_at > ?').bind(c.now).first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING_LOGINS) return msg(c, 429, 'Слишком много попыток', 'Повторите через несколько минут.');
  const p = newLoginParams();
  const flow = randomToken(32);
  await c.env.ADMIN_DB.prepare('INSERT INTO login_states (state_hash, binding_hash, nonce, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await hashOf(p.state), await hashOf(flow), p.nonce, p.verifier, c.now, c.now + LOGIN_TTL_MS)
    .run();
  return redirect(c, await authorizationUrl(c.cfg, as, p), [hostCookie(FLOW_COOKIE, flow, { maxAge: 600 })]);
}

async function callback(c: Ctx): Promise<Response> {
  const clearFlow = clearHostCookie(FLOW_COOKIE);
  const fail = (status: number, text: string): Response => msg(c, status, 'Вход не выполнен', text, { 'set-cookie': clearFlow });
  const state = c.url.searchParams.get('state');
  const flow = readCookie(c.req, FLOW_COOKIE);
  if (!state || !flow || state.length > 256) return fail(400, 'Недействительный запрос входа.');
  // Single use: the row is consumed even if validation below fails.
  const row = await c.env.ADMIN_DB.prepare('DELETE FROM login_states WHERE state_hash = ? RETURNING binding_hash, nonce, code_verifier, expires_at')
    .bind(await hashOf(state))
    .first<{ binding_hash: string; nonce: string; code_verifier: string; expires_at: number }>();
  if (!row || row.expires_at <= c.now || row.binding_hash !== (await hashOf(flow))) return fail(400, 'Запрос входа устарел или уже использован. Начните вход заново.');
  try {
    const as = await discover(c.cfg);
    const r = await completeLogin(c.cfg, as, c.url, { state, nonce: row.nonce, verifier: row.code_verifier });
    if (await isBlocked(c.env.ADMIN_DB, r.issuer, r.subject)) {
      await audit(c.env.ADMIN_DB, c.now, r.subject, 'login', null, 'blocked');
      return fail(403, 'Доступ для этой учётной записи заблокирован.');
    }
    const id = await createSession(c.cfg, c.env.ADMIN_DB, c.now, r);
    await audit(c.env.ADMIN_DB, c.now, r.subject, 'login', null, r.refreshToken ? 'ok' : 'ok_no_refresh');
    return redirect(c, '/', [hostCookie(COOKIE, id, { maxAge: ABSOLUTE_MS / 1000 }), clearFlow]);
  } catch (e) {
    if (e instanceof Denied) {
      await audit(c.env.ADMIN_DB, c.now, e.subject, 'login', null, e.reason);
      return fail(403, e.reason === 'mfa_required' ? 'Требуется многофакторная аутентификация (MFA) в IDP.' : 'У вашей учётной записи нет роли Postun для этой организации.');
    }
    if (e instanceof IdpUnavailable) return fail(503, 'IDP временно недоступен.');
    return fail(400, 'Не удалось подтвердить вход.');
  }
}

async function dashboardPage(c: Ctx, s: Session): Promise<Response> {
  const db = c.env.ADMIN_DB;
  const month = new Date(c.now).toISOString().slice(0, 7);
  const pageNo = Math.min(10_000, Math.max(0, Number.parseInt(c.url.searchParams.get('page') ?? '0', 10) || 0));
  const t = await db
    .prepare(
      `SELECT COUNT(*) AS principals, COALESCE(SUM(linked_accounts), 0) AS accounts,
       COALESCE(SUM(status = 'active'), 0) AS active, COALESCE(SUM(status = 'suspended'), 0) AS suspended, COALESCE(SUM(status = 'deleted'), 0) AS deleted,
       COALESCE(SUM(plan = 'beta_free'), 0) AS betaFree,
       COALESCE(SUM(CASE WHEN month = ? THEN success_count END), 0) AS monthSuccess, COALESCE(SUM(CASE WHEN month = ? THEN out_bytes END), 0) AS monthBytes
       FROM projections`
    )
    .bind(month, month)
    .first<Omit<DashData, 'rows' | 'page' | 'hasNext' | 'quota' | 'month'>>();
  const rows = await db
    .prepare('SELECT principal_ref, status, linked_accounts, plan, month, success_count, out_bytes FROM projections ORDER BY updated_at DESC, principal_ref LIMIT ? OFFSET ?')
    .bind(PAGE_SIZE + 1, pageNo * PAGE_SIZE)
    .all<DashData['rows'][number]>();
  const q = await db.prepare('SELECT value FROM admin_settings WHERE key = ?').bind(QUOTA_KEY).first<{ value: string }>();
  const data: DashData = {
    principals: 0, accounts: 0, active: 0, suspended: 0, deleted: 0, betaFree: 0, monthSuccess: 0, monthBytes: 0,
    ...t, month, rows: rows.results.slice(0, PAGE_SIZE), page: pageNo, hasNext: rows.results.length > PAGE_SIZE, quota: q?.value ?? null
  };
  return html(c, 200, (n) => dashboard(n, data, s, flashText(c.url.searchParams.get('msg'))));
}

/** Common gate for state-changing routes: exact Origin, fresh revalidation, CSRF token, minimum role. */
async function writeGate(c: Ctx, minOwner: boolean): Promise<{ s: Session; form: URLSearchParams } | Response> {
  if (!originAllowed(c.req, [c.cfg.origin])) return msg(c, 403, 'Запрещено', 'Недопустимый источник запроса.');
  const a = await authenticate(c.cfg, c.env.ADMIN_DB, c.req, c.now, true);
  if (a.status !== 'ok') return deny(c, a.status, true);
  const form = await readForm(c.req);
  const token = form?.get('csrf') ?? '';
  if (!form || !timingSafeEqual(utf8(token), utf8(a.session.csrf))) return msg(c, 403, 'Запрещено', 'Недействительный CSRF-токен.');
  const ok = minOwner ? a.session.level === 'postun.owner' : a.session.level !== 'postun.viewer';
  if (!ok) {
    await audit(c.env.ADMIN_DB, c.now, a.session.subject, 'forbidden', c.url.pathname, 'denied');
    return msg(c, 403, 'Запрещено', 'Недостаточно прав для этого действия.');
  }
  return { s: a.session, form };
}

async function control(c: Ctx, action: 'suspend' | 'resume'): Promise<Response> {
  const g = await writeGate(c, false);
  if (g instanceof Response) return g;
  const ref = g.form.get('principalRef') ?? '';
  const known = /^[\x21-\x7e]{16,64}$/.test(ref) ? await c.env.ADMIN_DB.prepare('SELECT 1 AS x FROM projections WHERE principal_ref = ?').bind(ref).first() : null;
  if (!known) return redirect(c, '/?msg=invalid');
  const db = c.env.ADMIN_DB;
  const ins = await db.prepare('INSERT INTO admin_audit (ts, actor_subject, action_code, target_opaque_id, outcome) VALUES (?, ?, ?, ?, ?)').bind(c.now, g.s.subject, action, ref, 'requested').run();
  let outcome: string;
  try {
    const actor = { issuer: g.s.issuer, subject: g.s.subject, role: g.s.level === 'postun.owner' ? ('postun.owner' as const) : ('postun.operator' as const) };
    const r = await c.env.CONTROL[action](actor, ref);
    outcome = r.ok ? 'ok' : 'failed';
  } catch {
    outcome = 'error';
  }
  await db.prepare('UPDATE admin_audit SET outcome = ? WHERE id = ?').bind(outcome, ins.meta.last_row_id).run();
  return redirect(c, `/?msg=${outcome === 'ok' ? (action === 'suspend' ? 'suspended' : 'resumed') : 'failed'}`);
}

async function setQuota(c: Ctx): Promise<Response> {
  const g = await writeGate(c, true);
  if (g instanceof Response) return g;
  const v = g.form.get('value') ?? '';
  if (!/^\d{1,9}$/.test(v) || Number(v) > 100_000_000) return redirect(c, '/?msg=invalid');
  await c.env.ADMIN_DB.prepare('INSERT INTO admin_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(QUOTA_KEY, String(Number(v)), c.now, g.s.subject)
    .run();
  await audit(c.env.ADMIN_DB, c.now, g.s.subject, 'settings_quota', QUOTA_KEY, 'ok');
  return redirect(c, '/?msg=saved');
}

async function logout(c: Ctx): Promise<Response> {
  if (!originAllowed(c.req, [c.cfg.origin])) return msg(c, 403, 'Запрещено', 'Недопустимый источник запроса.');
  const a = await authenticate(c.cfg, c.env.ADMIN_DB, c.req, c.now);
  if (a.status === 'ok') {
    const form = await readForm(c.req);
    if (!form || !timingSafeEqual(utf8(form.get('csrf') ?? ''), utf8(a.session.csrf))) return msg(c, 403, 'Запрещено', 'Недействительный CSRF-токен.');
    await destroySession(c.env.ADMIN_DB, a.session.idHash);
    await audit(c.env.ADMIN_DB, c.now, a.session.subject, 'logout', null, 'ok');
  }
  return redirect(c, (await endSessionUrl(c.cfg)) ?? '/', [clearHostCookie(COOKIE)]);
}

async function route(c: Ctx): Promise<Response> {
  const { method } = c.req;
  const path = c.url.pathname;
  if (method === 'GET' && path === '/login') return login(c);
  if (method === 'GET' && path === '/oidc/callback') return callback(c);
  if (method === 'POST' && path === '/logout') return logout(c);
  if (method === 'POST' && path === '/principals/suspend') return control(c, 'suspend');
  if (method === 'POST' && path === '/principals/resume') return control(c, 'resume');
  if (method === 'POST' && path === '/settings/quota') return setQuota(c);
  if (method === 'GET' && path === '/') {
    const a = await authenticate(c.cfg, c.env.ADMIN_DB, c.req, c.now);
    return a.status === 'ok' ? dashboardPage(c, a.session) : deny(c, a.status, false);
  }
  return msg(c, Object.hasOwn({ '/': 1, '/login': 1, '/oidc/callback': 1, '/logout': 1, '/principals/suspend': 1, '/principals/resume': 1, '/settings/quota': 1 }, path) ? 405 : 404, 'Не найдено', 'Страница не найдена.');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cfg = await loadCfg(env);
    if (!cfg) return withSecurityHeaders(new Response('admin disabled: not configured', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }));
    const c: Ctx = { req, env, cfg, url: new URL(req.url), now: Date.now(), nonce: randomToken(16) };
    try {
      return await route(c);
    } catch (e) {
      // Never log the error object: it may carry tokens or codes.
      if (e instanceof IdpUnavailable) return msg(c, 503, 'Временно недоступно', 'IDP недоступен. Админка закрыта до восстановления.');
      console.error('admin: internal error');
      return msg(c, 500, 'Ошибка', 'Внутренняя ошибка.');
    }
  },

  /** Hourly retention purge: audit 30 days, expired login states and sessions. */
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.ADMIN_DB.batch([
      env.ADMIN_DB.prepare('DELETE FROM admin_audit WHERE ts < ?').bind(now - AUDIT_RETENTION_MS),
      env.ADMIN_DB.prepare('DELETE FROM login_states WHERE expires_at < ?').bind(now),
      env.ADMIN_DB.prepare('DELETE FROM admin_sessions WHERE created_at < ? OR last_seen < ?').bind(now - 60 * 60_000, now - 15 * 60_000)
    ]);
  }
} satisfies ExportedHandler<Env>;
