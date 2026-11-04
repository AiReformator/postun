import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, installIdP, makeEnv, startClock } from './helpers';

beforeEach(async () => {
  startClock();
  await installIdP();
});
afterEach(() => vi.restoreAllMocks());

const KEYS = ['IDP_ISSUER', 'IDP_PROJECT_ID', 'IDP_ORG_ID', 'IDP_CLIENT_ID', 'IDP_CLIENT_SECRET', 'ADMIN_SESSION_KEY', 'ADMIN_ORIGIN'] as const;
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
    for (const over of [{ ADMIN_SESSION_KEY: 'c2hvcnQ' }, { ADMIN_ORIGIN: 'http://admin.test.example' }, { ADMIN_ORIGIN: 'https://admin.test.example/x' }, { IDP_ISSUER: 'http://idp.test.example' }]) {
      expect((await call(makeEnv(over), '/')).status).toBe(503);
    }
  });
  it('configured admin is not 503 (sanity)', async () => {
    expect((await call(makeEnv(), '/')).status).toBe(401);
  });
});
