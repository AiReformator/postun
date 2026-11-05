#!/usr/bin/env node
// Post-deploy smoke checks against the public endpoints of the deployed Workers (no credentials, no user data).
// Usage: POSTUN_DOMAIN=example.org node scripts/deploy/smoke.mjs [app ...]
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { APPS } from './render-wrangler.mjs';

/** Expected status per public endpoint: config loaded, auth wall in place, nothing open by mistake. */
export const CHECKS = {
  admin: [['admin', '/login', 303]],
  mcp: [['mcp', '/mcp', 401]],
  auth: [['auth', '/.well-known/oauth-authorization-server', 200]],
  web: [
    ['', '/', 200],
    ['app', '/app/', 200]
  ]
};

const url = (sub, path, domain) => `https://${sub ? `${sub}.` : ''}${domain}${path}`;

export async function smoke(apps, domain, fetchFn = globalThis.fetch, attempts = 6, delayMs = 5000) {
  const failures = [];
  for (const app of apps) {
    for (const [sub, path, want] of CHECKS[app] ?? []) {
      const target = url(sub, path, domain);
      let got = 0;
      for (let i = 0; i < attempts && got !== want; i++) {
        if (i) await sleep(delayMs);
        try {
          got = (await fetchFn(target, { redirect: 'manual', headers: { 'user-agent': 'postun-deploy-smoke' } })).status;
        } catch {
          got = 0;
        }
      }
      console.log(`${got === want ? 'ok  ' : 'FAIL'} ${app} ${path} -> ${got} (want ${want})`);
      if (got !== want) failures.push(`${app} ${path}`);
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const domain = process.env.POSTUN_DOMAIN?.trim().toLowerCase();
  const apps = process.argv.slice(2).filter((a) => APPS.includes(a));
  if (!domain) {
    console.error('POSTUN_DOMAIN missing');
    process.exit(1);
  }
  const failures = await smoke(apps.length ? apps : APPS, domain);
  if (failures.length) process.exit(1);
}
