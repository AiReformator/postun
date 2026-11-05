// Tests for the production deploy helpers (synthetic IDs only). Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS, hostsFor, render } from './render-wrangler.mjs';
import { appsFor, plan } from './changed-apps.mjs';
import { smoke } from './smoke.mjs';

const ENV = {
  POSTUN_DOMAIN: 'postun.org',
  POSTUN_KV_OAUTH_ID: '0123456789abcdef0123456789abcdef',
  POSTUN_D1_CONTROL_ID: '11111111-2222-4333-8444-555555555555',
  POSTUN_D1_ADMIN_ID: '66666666-7777-4888-8999-aaaaaaaaaaaa'
};
const src = (app) => readFileSync(new URL(`../../apps/${app}/wrangler.jsonc`, import.meta.url), 'utf8');

test('every app renders with routes for the configured domain and no placeholders or staging block', () => {
  for (const app of APPS) {
    const cfg = JSON.parse(render(app, src(app), ENV));
    assert.deepEqual(cfg.routes.map((r) => r.pattern), hostsFor(app, 'postun.org'));
    assert.ok(cfg.routes.every((r) => r.custom_domain === true));
    assert.equal(cfg.env, undefined);
    assert.doesNotMatch(JSON.stringify(cfg), /REPLACE_WITH_/);
    assert.equal(cfg.observability?.enabled, false, `${app}: observability must stay disabled`);
  }
});

test('resource IDs land in the right bindings', () => {
  const auth = JSON.parse(render('auth', src('auth'), ENV));
  assert.equal(auth.kv_namespaces[0].id, ENV.POSTUN_KV_OAUTH_ID);
  assert.equal(auth.d1_databases[0].database_id, ENV.POSTUN_D1_CONTROL_ID);
  const admin = JSON.parse(render('admin', src('admin'), ENV));
  assert.equal(admin.d1_databases[0].database_id, ENV.POSTUN_D1_ADMIN_ID);
});

test('missing or malformed settings fail closed and name the setting, not the value', () => {
  assert.throws(() => render('auth', src('auth'), { ...ENV, POSTUN_D1_CONTROL_ID: '' }), /POSTUN_D1_CONTROL_ID missing or invalid/);
  assert.throws(() => render('auth', src('auth'), { ...ENV, POSTUN_KV_OAUTH_ID: 'not-an-id' }), /POSTUN_KV_OAUTH_ID/);
  assert.throws(() => render('web', src('web'), { ...ENV, POSTUN_DOMAIN: 'https://postun.org/' }), /POSTUN_DOMAIN/);
  assert.throws(() => render('evil', '{}', ENV), /unknown app/);
  try {
    render('admin', src('admin'), { ...ENV, POSTUN_D1_ADMIN_ID: 'zz-secret-looking-zz' });
  } catch (e) {
    assert.doesNotMatch(e.message, /zz-secret-looking-zz/);
  }
});

test('vars with absolute URLs must sit on POSTUN_DOMAIN', () => {
  for (const app of ['auth', 'mcp', 'admin']) {
    assert.throws(() => render(app, src(app), { ...ENV, POSTUN_DOMAIN: 'example.test' }), /is not on POSTUN_DOMAIN/);
    assert.doesNotThrow(() => render(app, src(app), { ...ENV, POSTUN_DOMAIN: 'postun.org' }));
  }
});

test('changed paths map to the Workers they affect, in deploy order', () => {
  assert.deepEqual(appsFor(['docs/04_DEPLOYMENT.md', '.github/workflows/ci.yml', 'scripts/check-docs.mjs']), []);
  assert.deepEqual(appsFor(['apps/web/i18n/en.mjs', 'apps/auth/src/index.ts']), ['auth', 'web']);
  assert.deepEqual(APPS, ['auth', 'mcp', 'admin', 'web']);
  assert.deepEqual(appsFor(['migrations/admin/0003_x.sql']), ['admin']);
  assert.deepEqual(appsFor(['migrations/control/0003_x.sql']), ['auth']);
  assert.deepEqual(appsFor(['packages/contracts/src/quota.ts']), APPS);
  assert.deepEqual(appsFor(['package-lock.json']), APPS);
});

test('plan modes', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  assert.deepEqual(plan('all'), APPS);
  assert.deepEqual(plan('mcp'), ['mcp']);
  assert.deepEqual(plan('changed', '0'.repeat(40), b, () => []), APPS);
  assert.deepEqual(plan('changed', undefined, b, () => []), APPS);
  assert.deepEqual(plan('changed', a, b, () => ['apps/admin/src/x.ts']), ['admin']);
  assert.deepEqual(plan('changed', a, b, () => { throw new Error('unknown revision'); }), APPS);
  assert.throws(() => plan('rm -rf /'), /unknown mode/);
});

test('smoke checks compare statuses and retry', async () => {
  const seen = [];
  const ok = await smoke(['admin', 'mcp'], 'example.test', async (u) => {
    seen.push(u);
    return { status: u.endsWith('/login') ? 303 : 401 };
  }, 2, 0);
  assert.deepEqual(ok, []);
  assert.deepEqual(seen, ['https://admin.example.test/login', 'https://mcp.example.test/mcp']);
  const bad = await smoke(['web'], 'example.test', async () => ({ status: 500 }), 2, 0);
  assert.deepEqual(bad, ['web /', 'web /app/']);
});
