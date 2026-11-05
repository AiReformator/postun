import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, installIdp, makeEnv, startClock } from './helpers';

beforeEach(async () => {
  startClock();
  await installIdp();
});
afterEach(() => vi.restoreAllMocks());

const KEYS = ['ADMIN_OIDC_ISSUER', 'ADMIN_OIDC_CLIENT_ID', 'ADMIN_OIDC_CLIENT_SECRET', 'ADMIN_OIDC_SCOPES', 'ADMIN_OIDC_ROLES_CLAIM', 'ADMIN_OIDC_ROLES_TENANT', 'ADMIN_OIDC_EXTRA_AUDIENCE', 'ADMIN_SESSION_KEY', 'ADMIN_ORIGIN'] as const;
const ROUTES: [string, string][] = [['GET', '/'], ['GET', '/login'], ['GET', '/oidc/callback?code=a&state=b'], ['POST', '/logout'], ['POST', '/principals/suspend'], ['POST', '/settings/quota'], ['GET', '/anything']];

describe('fail closed when not configured', () => {
  it.each(KEYS)('missing %s -> every HTTP route is 503', async (key) => {
    for (const bad of [undefined, '', '  ']) {
      const env = makeEnv({ [key]: bad });
      for (const [method, path] of ROUTES) {
        const res = await call(env, path, { method, headers: { origin: 'https://admin.test.example' } });
        expect(res.status, `${method} ${path}`).toBe(503);
        expect(await res.text()).toBe('admin disabled: not configured');
      }
    }
  });
  it('malformed values also disable the admin (short session key, http origin, origin with path, http issuer)', async () => {
    for (const over of [{ ADMIN_SESSION_KEY: 'c2hvcnQ' }, { ADMIN_ORIGIN: 'http://admin.test.example' }, { ADMIN_ORIGIN: 'https://admin.test.example/x' }, { ADMIN_OIDC_ISSUER: 'http://idp.test.example' }]) {
      expect((await call(makeEnv(over), '/')).status).toBe(503);
    }
  });
  it('tenant and audience checks switch off only with the explicit value none', async () => {
    for (const key of ['ADMIN_OIDC_ROLES_TENANT', 'ADMIN_OIDC_EXTRA_AUDIENCE']) {
      expect((await call(makeEnv({ [key]: 'none' }), '/')).status, key).toBe(401);
      expect((await call(makeEnv({ [key]: ' NONE ' }), '/')).status, key).toBe(401);
    }
  });
  it('configured admin is not 503 (sanity)', async () => {
    expect((await call(makeEnv(), '/')).status).toBe(401);
  });
});
