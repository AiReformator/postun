import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, callback, CLIENT, db, installIdP, login, makeEnv, ORG, ownerRoles, PROJECT, sessionCount, startClock, startLogin, type IdP, ORIGIN, ISSUER } from './helpers';

let z: IdP;
beforeEach(async () => {
  startClock();
  z = await installIdP();
});
afterEach(() => vi.restoreAllMocks());

describe('unauthenticated', () => {
  it('GET / without a session is 401 and shows only the login link', async () => {
    const res = await call(makeEnv(), '/');
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('Принципалы');
  });
  it('POST write routes without a session are 401/403, never 2xx', async () => {
    const env = makeEnv();
    for (const p of ['/principals/suspend', '/principals/resume', '/settings/quota', '/logout']) {
      const res = await call(env, p, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=x&principalRef=aaaaaaaaaaaaaaaaaaaa' });
      expect([401, 303]).toContain(res.status);
      expect(env.CONTROL.suspend).not.toHaveBeenCalled();
    }
  });
  it('unknown / debug routes are 404', async () => {
    for (const p of ['/debug', '/sql', '/ProjectionSink', '/.well-known/x']) expect((await call(makeEnv(), p)).status).toBe(404);
  });
});

describe('GET /login', () => {
  it('redirects to the discovered authorization endpoint with PKCE S256, state, nonce and the verified scopes', async () => {
    const f = await startLogin(makeEnv(), z);
    expect(f.url.origin + f.url.pathname).toBe(`${ISSUER}/oauth/v2/authorize`);
    const p = f.url.searchParams;
    expect(p.get('client_id')).toBe(CLIENT);
    expect(p.get('redirect_uri')).toBe(`${ORIGIN}/oidc/callback`);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')!.length).toBeGreaterThan(20);
    expect(p.get('nonce')!.length).toBeGreaterThan(20);
    const scopes = p.get('scope')!.split(' ');
    expect(scopes).toEqual(expect.arrayContaining(['openid', 'profile', 'offline_access', `urn:idp:iam:org:project:id:${PROJECT}:aud`, 'urn:idp:iam:org:projects:roles', `urn:idp:iam:org:id:${ORG}`]));
    expect(f.flowCookie).toMatch(/^__Host-postun_admin_flow=/);
  });
  it('discovery failure closes the admin with 503', async () => {
    z.discoveryDown = true;
    expect((await call(makeEnv(), '/login')).status).toBe(503);
  });
});

describe('callback', () => {
  it('creates an opaque hardened session; D1 holds only the id hash and an encrypted refresh token', async () => {
    const env = makeEnv();
    const f = await startLogin(env, z);
    const res = await callback(env, f);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('__Host-postun_admin='))!;
    expect(sc).toMatch(/; Path=\/; Secure; HttpOnly; SameSite=Lax/);
    expect(sc).not.toContain('Domain');
    const id = sc.split(';')[0]!.split('=')[1]!;
    const row = await db.prepare('SELECT * FROM admin_sessions').first<Record<string, unknown>>();
    expect(row).toMatchObject({ subject: 'user-synthetic-1', issuer: ISSUER, mfa: 1 });
    expect(JSON.stringify(row)).not.toContain(id);
    expect(JSON.stringify(row)).not.toContain('rt-synthetic-1');
    expect(String(row!.refresh_enc)).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(JSON.parse(String(row!.roles))).toEqual(['postun.operator']);
  });

  it('AD-01: authenticated user without a Postun role gets 403 and no session', async () => {
    z.roles = undefined;
    const env = makeEnv();
    const f = await startLogin(env, z);
    const res = await callback(env, f);
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-postun_admin='))).toBe(false);
    expect(await sessionCount()).toBe(0);
  });
  it('AD-01: role in another org is rejected (403)', async () => {
    z.roles = { 'postun.owner': { 'other-org': 'x' } };
    const env = makeEnv();
    expect((await callback(env, await startLogin(env, z))).status).toBe(403);
    expect(await sessionCount()).toBe(0);
  });
  it('AD-01: role of another project (claim for a different project id) is rejected', async () => {
    z.idOverrides = { [`urn:idp:iam:org:project:${PROJECT}:roles`]: undefined, 'urn:idp:iam:org:project:other:roles': ownerRoles('postun.owner') };
    z.rolesInIdToken = false;
    z.roles = undefined;
    const env = makeEnv();
    expect((await callback(env, await startLogin(env, z))).status).toBe(403);
  });
  it('unknown role names are ignored', async () => {
    z.roles = ownerRoles('ORG_OWNER', 'admin');
    const env = makeEnv();
    expect((await callback(env, await startLogin(env, z))).status).toBe(403);
  });
  it('reads roles from userinfo when the ID token does not carry them', async () => {
    z.rolesInIdToken = false;
    const env = makeEnv();
    expect((await callback(env, await startLogin(env, z))).status).toBe(303);
    expect(z.calls.userinfo).toBe(1);
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong audience (client id missing)', { aud: [PROJECT], azp: undefined }],
    ['audience without project id', { aud: [CLIENT] }],
    ['foreign azp', { aud: [CLIENT, PROJECT, 'other'], azp: 'other' }],
    ['wrong nonce', { nonce: 'attacker-nonce' }],
    ['expired token', { exp: 1000, iat: 900 }]
  ])('rejects %s', async (_n, over) => {
    z.idOverrides = over;
    const env = makeEnv();
    const res = await callback(env, await startLogin(env, z));
    expect([400, 403]).toContain(res.status);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-postun_admin='))).toBe(false);
    expect(await sessionCount()).toBe(0);
  });

  it('rejects an ID token whose signature does not match the issuer JWKS', async () => {
    z.rogueSignature = true;
    const env = makeEnv();
    expect([400, 403]).toContain((await callback(env, await startLogin(env, z))).status);
    expect(await sessionCount()).toBe(0);
  });

  it('replayed state is rejected (single use)', async () => {
    const env = makeEnv();
    const f = await startLogin(env, z);
    expect((await callback(env, f)).status).toBe(303);
    z.codes.set('code-1', { nonce: f.nonce, challenge: f.challenge });
    expect((await callback(env, f)).status).toBe(400);
    expect(await sessionCount()).toBe(1);
  });
  it('unknown state, missing flow cookie and foreign flow cookie are rejected', async () => {
    const env = makeEnv();
    const f = await startLogin(env, z);
    expect((await callback(env, f, 'code-1', { state: 'forged' })).status).toBe(400);
    const g = await startLogin(env, z, 'code-2');
    expect((await callback(env, g, 'code-2', { cookie: '' })).status).toBe(400);
    const h = await startLogin(env, z, 'code-3');
    expect((await callback(env, h, 'code-3', { cookie: f.flowCookie })).status).toBe(400);
    expect(await sessionCount()).toBe(0);
  });
  it('expired state is rejected', async () => {
    const env = makeEnv();
    const f = await startLogin(env, z);
    vi.mocked(Date.now).mockReturnValue(Date.now() + 11 * 60_000);
    expect((await callback(env, f)).status).toBe(400);
  });
  it('IdP error response (access_denied) is rejected', async () => {
    const env = makeEnv();
    const f = await startLogin(env, z);
    const res = await call(env, `/oidc/callback?error=access_denied&state=${f.state}`, { cookie: f.flowCookie });
    expect(res.status).toBe(400);
  });

  describe('MFA amr policy', () => {
    it('denies a login without a strong amr value (403)', async () => {
      z.idOverrides = { amr: ['pwd'] };
      const env = makeEnv();
      const res = await callback(env, await startLogin(env, z));
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('MFA');
      expect(await sessionCount()).toBe(0);
    });
    it('denies when amr is absent', async () => {
      z.idOverrides = { amr: undefined };
      const env = makeEnv();
      expect((await callback(env, await startLogin(env, z))).status).toBe(403);
    });
    it('can be switched off explicitly and the accepted list is configurable', async () => {
      z.idOverrides = { amr: ['pwd'] };
      let env = makeEnv({ ADMIN_REQUIRE_MFA_AMR: 'false' });
      expect((await callback(env, await startLogin(env, z))).status).toBe(303);
      expect(await db.prepare('SELECT mfa FROM admin_sessions').first()).toEqual({ mfa: 0 });
      await db.prepare('DELETE FROM admin_sessions').run();
      env = makeEnv({ ADMIN_MFA_AMR_VALUES: 'pwd' });
      expect((await callback(env, await startLogin(env, z, 'code-9'), 'code-9')).status).toBe(303);
    });
  });

  it('a locally blocked subject cannot log in', async () => {
    await db.prepare('INSERT INTO admin_blocked_subjects (issuer, subject, created_at) VALUES (?, ?, ?)').bind(ISSUER, 'user-synthetic-1', Date.now()).run();
    const env = makeEnv();
    expect((await callback(env, await startLogin(env, z))).status).toBe(403);
    expect(await sessionCount()).toBe(0);
  });

  it('client authentication uses the secret (basic by default, post configurable)', async () => {
    const env = makeEnv({ IDP_CLIENT_AUTH: 'post' });
    const res = await callback(env, await startLogin(env, z));
    expect(res.status).toBe(400); // mock requires Basic: confirms the setting is honoured
    expect(await login(makeEnv(), z)).toMatch(/^__Host-postun_admin=/);
  });
});
