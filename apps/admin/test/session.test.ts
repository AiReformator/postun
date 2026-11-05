import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance, call, csrfOf, db, form, ISSUER, installIdp, login, makeEnv, ORIGIN, ownerRoles, seedProjection, sessionCount, startClock, type Idp } from './helpers';

let z: Idp;
const REF = 'ref_AAAAAAAAAAAAAAAAAAAA';
beforeEach(async () => {
  startClock();
  z = await installIdp();
});
afterEach(() => vi.restoreAllMocks());

describe('dashboard', () => {
  it('viewer sees aggregate counts and a pseudonymous table, with no action buttons', async () => {
    z.roles = ownerRoles('postun.viewer');
    await seedProjection(REF, { success: 1234, bytes: 5 * 1024 * 1024 });
    await seedProjection('ref_<script>alert(1)</script>', { status: 'suspended', accounts: 1 });
    const env = makeEnv();
    const res = await call(env, '/', { cookie: await login(env, z) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Beta');
    expect(html).toContain('1 234');
    expect(html).toContain('5.0 МиБ');
    expect(html).toContain('ref_AAAA…AAAA');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;scr');
    expect(html).not.toContain('Приостановить');
    expect(html).not.toContain('Бета-квота');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'.*style-src 'nonce-.+'.*frame-ancestors 'none'/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('operator gets suspend/resume buttons; owner also sees quota settings', async () => {
    await seedProjection(REF);
    let env = makeEnv();
    let html = await (await call(env, '/', { cookie: await login(env, z) })).text();
    expect(html).toContain('/principals/suspend');
    expect(html).not.toContain('/settings/quota');
    await db.prepare('DELETE FROM admin_sessions').run();
    z.roles = ownerRoles('postun.owner');
    env = makeEnv();
    html = await (await call(env, '/', { cookie: await login(env, z) })).text();
    expect(html).toContain('/settings/quota');
  });
});

describe('lifetime (idle 15 min, absolute 60 min)', () => {
  it('idle timeout ends the session', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    advance(4 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(200);
    advance(14 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(200);
    advance(16 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });
  it('absolute timeout ends an active session', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    for (let i = 0; i < 10; i++) {
      advance(5.5 * 60_000);
      expect((await call(env, '/', { cookie })).status).toBe(200);
    }
    advance(5.5 * 60_000); // > 60 min since login
    expect((await call(env, '/', { cookie })).status).toBe(401);
  });
  it('without a refresh token the session cannot be revalidated and ends after 5 minutes', async () => {
    z.issueRefreshToken = false;
    const env = makeEnv();
    const cookie = await login(env, z);
    advance(60_000);
    expect((await call(env, '/', { cookie })).status).toBe(200);
    advance(5 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });
  it('garbage or foreign cookies are not sessions', async () => {
    const env = makeEnv();
    expect((await call(env, '/', { cookie: '__Host-postun_admin=short' })).status).toBe(401);
    expect((await call(env, '/', { cookie: `__Host-postun_admin=${'A'.repeat(43)}` })).status).toBe(401);
  });
});

describe('revalidation (AD-02)', () => {
  it('re-reads roles from a refreshed token at most every 5 minutes', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    advance(2 * 60_000);
    await call(env, '/', { cookie });
    expect(z.calls.refresh).toBe(0);
    advance(4 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(200);
    expect(z.calls.refresh).toBe(1);
  });
  it('revoked role destroys the session at the next revalidation; the old login token is not trusted', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    z.roles = undefined; // role removed at the IdP; refreshed ID token has no roles claim, userinfo has none either
    advance(6 * 60_000);
    const res = await call(env, '/', { cookie });
    expect(res.status).toBe(401);
    expect(await sessionCount()).toBe(0);
    expect(z.calls.userinfo).toBe(1);
    expect(await db.prepare("SELECT outcome FROM admin_audit WHERE action_code = 'session_revalidation'").first()).toEqual({ outcome: 'role_revoked' });
    expect((await call(env, '/', { cookie })).status).toBe(401);
  });
  it('role moved to another org is revoked too', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    z.roles = { 'postun.owner': { 'other-tenant': 'x' } };
    advance(6 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(401);
  });
  it('invalid_grant from the IdP (user disabled / token revoked) destroys the session', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    z.refresh = 'invalid_grant';
    advance(6 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });
  it('a role downgrade is applied immediately', async () => {
    z.roles = ownerRoles('postun.owner');
    const env = makeEnv();
    const cookie = await login(env, z);
    z.roles = ownerRoles('postun.viewer');
    advance(6 * 60_000);
    const html = await (await call(env, '/', { cookie })).text();
    expect(html).not.toContain('/settings/quota');
    expect(await db.prepare('SELECT roles FROM admin_sessions').first()).toEqual({ roles: '["postun.viewer"]' });
  });
  it('IdP outage fails closed (503) without destroying the session', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    z.refresh = 'down';
    advance(6 * 60_000);
    expect((await call(env, '/', { cookie })).status).toBe(503);
    expect(await sessionCount()).toBe(1);
    z.refresh = 'ok';
    expect((await call(env, '/', { cookie })).status).toBe(200);
  });
  it('blocked subject is denied on the very next request and its session is removed', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    expect((await call(env, '/', { cookie })).status).toBe(200);
    await db.prepare('INSERT INTO admin_blocked_subjects (issuer, subject, created_at) VALUES (?, ?, ?)').bind(ISSUER, 'user-synthetic-1', Date.now()).run();
    expect((await call(env, '/', { cookie })).status).toBe(403);
    expect(await sessionCount()).toBe(0);
  });
});

describe('suspend / resume (operator+), CSRF (AD-04)', () => {
  const setup = async (role = 'postun.operator') => {
    z.roles = ownerRoles(role);
    await seedProjection(REF);
    const env = makeEnv();
    const cookie = await login(env, z);
    return { env, cookie, csrf: await csrfOf(cookie) };
  };

  it('happy path: calls CONTROL with the verified actor and records an audit row', async () => {
    const { env, cookie, csrf } = await setup();
    const res = await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?msg=suspended');
    expect(env.CONTROL.suspend).toHaveBeenCalledWith({ issuer: ISSUER, subject: 'user-synthetic-1', role: 'postun.operator' }, REF);
    expect(await db.prepare('SELECT actor_subject, action_code, target_opaque_id, outcome FROM admin_audit WHERE action_code = ?').bind('suspend').first()).toEqual({ actor_subject: 'user-synthetic-1', action_code: 'suspend', target_opaque_id: REF, outcome: 'ok' });
    const r2 = await call(env, '/principals/resume', { ...form({ csrf, principalRef: REF }), cookie });
    expect(r2.headers.get('location')).toBe('/?msg=resumed');
    expect(env.CONTROL.resume).toHaveBeenCalledTimes(1);
  });
  it('owner is passed to CONTROL with role postun.owner', async () => {
    const { env, cookie, csrf } = await setup('postun.owner');
    await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie });
    expect(env.CONTROL.suspend.mock.calls[0]![0].role).toBe('postun.owner');
  });
  it('CONTROL failure and exception are recorded and surfaced without details', async () => {
    const { env, cookie, csrf } = await setup();
    env.CONTROL.suspend.mockResolvedValueOnce({ ok: false });
    expect((await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie })).headers.get('location')).toBe('/?msg=failed');
    env.CONTROL.suspend.mockRejectedValueOnce(new Error('secret internal detail'));
    const res = await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie });
    expect(res.headers.get('location')).toBe('/?msg=failed');
    const rows = await db.prepare('SELECT outcome FROM admin_audit WHERE action_code = ? ORDER BY id').bind('suspend').all<{ outcome: string }>();
    expect(rows.results.map((r) => r.outcome)).toEqual(['failed', 'error']);
  });

  it('missing Origin is 403', async () => {
    const { env, cookie, csrf } = await setup();
    const f = form({ csrf, principalRef: REF });
    delete (f.headers as Record<string, string>).origin;
    expect((await call(env, '/principals/suspend', { ...f, cookie })).status).toBe(403);
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example', 'https://admin.test.example.evil.example', 'http://admin.test.example', 'null'])('foreign Origin %s is 403', async (origin) => {
    const { env, cookie, csrf } = await setup();
    const f = form({ csrf, principalRef: REF });
    f.headers.origin = origin;
    expect((await call(env, '/principals/suspend', { ...f, cookie })).status).toBe(403);
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
  });
  it('missing or wrong CSRF token is 403', async () => {
    const { env, cookie } = await setup();
    expect((await call(env, '/principals/suspend', { ...form({ principalRef: REF }), cookie })).status).toBe(403);
    expect((await call(env, '/principals/suspend', { ...form({ csrf: 'x'.repeat(43), principalRef: REF }), cookie })).status).toBe(403);
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
  });
  it("another session's CSRF token does not work", async () => {
    const a = await setup();
    await db.prepare('DELETE FROM admin_sessions').run();
    const b = await setup();
    expect((await call(b.env, '/principals/suspend', { ...form({ csrf: a.csrf, principalRef: REF }), cookie: b.cookie })).status).toBe(403);
  });
  it('viewer cannot write (403, audited)', async () => {
    const { env, cookie, csrf } = await setup('postun.viewer');
    expect((await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie })).status).toBe(403);
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT outcome FROM admin_audit WHERE action_code = 'forbidden'").first()).toEqual({ outcome: 'denied' });
  });
  it('operator cannot change quota settings', async () => {
    const { env, cookie, csrf } = await setup();
    expect((await call(env, '/settings/quota', { ...form({ csrf, value: '5' }), cookie })).status).toBe(403);
  });
  it('unknown / malformed principalRef is not forwarded to CONTROL', async () => {
    const { env, cookie, csrf } = await setup();
    for (const ref of ['ref_BBBBBBBBBBBBBBBBBBBB', 'short', 'ref with space aaaaaaaaaaaa']) {
      const res = await call(env, '/principals/suspend', { ...form({ csrf, principalRef: ref }), cookie });
      expect(res.headers.get('location')).toBe('/?msg=invalid');
    }
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
  });
  it('writes force a fresh revalidation: a role revoked 1 minute ago blocks the write', async () => {
    const { env, cookie, csrf } = await setup();
    z.roles = undefined;
    advance(60_000);
    expect((await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie })).status).toBe(401);
    expect(env.CONTROL.suspend).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });
  it('writes are blocked when freshness cannot be proven (no refresh token, >5 min)', async () => {
    z.issueRefreshToken = false;
    const { env, cookie, csrf } = await setup();
    expect((await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie })).status).toBe(303);
    advance(6 * 60_000);
    expect((await call(env, '/principals/suspend', { ...form({ csrf, principalRef: REF }), cookie })).status).toBe(401);
  });
  it('wrong content type is rejected', async () => {
    const { env, cookie, csrf } = await setup();
    const f = form({ csrf, principalRef: REF });
    f.headers['content-type'] = 'text/plain';
    expect((await call(env, '/principals/suspend', { ...f, cookie })).status).toBe(403);
  });
  it('GET on a write route is 405', async () => {
    const { env, cookie } = await setup();
    expect((await call(env, '/principals/suspend', { cookie })).status).toBe(405);
  });
});

describe('owner quota display setting (informational)', () => {
  it('stores a validated desired value and shows it', async () => {
    z.roles = ownerRoles('postun.owner');
    const env = makeEnv();
    const cookie = await login(env, z);
    const csrf = await csrfOf(cookie);
    expect((await call(env, '/settings/quota', { ...form({ csrf, value: '250' }), cookie })).headers.get('location')).toBe('/?msg=saved');
    expect((await call(env, '/settings/quota', { ...form({ csrf, value: '-1' }), cookie })).headers.get('location')).toBe('/?msg=invalid');
    expect((await call(env, '/settings/quota', { ...form({ csrf, value: '1e9' }), cookie })).headers.get('location')).toBe('/?msg=invalid');
    expect(await db.prepare('SELECT value, updated_by FROM admin_settings').first()).toEqual({ value: '250', updated_by: 'user-synthetic-1' });
    expect(await (await call(env, '/', { cookie })).text()).toContain('250');
  });
});

describe('logout', () => {
  it('destroys the local session, clears the cookie and ends the IdP session', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    const csrf = await csrfOf(cookie);
    const res = await call(env, '/logout', { ...form({ csrf }), cookie });
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${ISSUER}/oidc/v1/end_session`);
    expect(loc.searchParams.get('post_logout_redirect_uri')).toBe(`${ORIGIN}/`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-postun_admin=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(await sessionCount()).toBe(0);
    expect((await call(env, '/', { cookie })).status).toBe(401);
  });
  it('requires Origin and CSRF token', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    const f = form({ csrf: 'wrong' });
    expect((await call(env, '/logout', { ...f, cookie })).status).toBe(403);
    delete (f.headers as Record<string, string>).origin;
    expect((await call(env, '/logout', { ...f, cookie })).status).toBe(403);
    expect(await sessionCount()).toBe(1);
  });
  it('still logs out locally when the IdP is unreachable', async () => {
    const env = makeEnv();
    const cookie = await login(env, z);
    const csrf = await csrfOf(cookie);
    z.discoveryDown = true;
    const { resetDiscoveryCache } = await import('../src/oidc');
    resetDiscoveryCache();
    const res = await call(env, '/logout', { ...form({ csrf }), cookie });
    expect(res.headers.get('location')).toBe('/');
    expect(await sessionCount()).toBe(0);
  });
});
