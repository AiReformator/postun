#!/usr/bin/env node
// Renders apps/<app>/wrangler.deploy.json (git-ignored) for a production deploy from the public apps/<app>/wrangler.jsonc.
// The public configs carry REPLACE_WITH_* placeholders instead of real resource IDs; the deploy workflow fills them
// from its protected environment. Custom-domain routes are derived from one domain setting. The staging `env` block
// is dropped so the rendered file describes exactly one deployment.
//
// Environment: POSTUN_DOMAIN (e.g. example.org), POSTUN_KV_OAUTH_ID, POSTUN_D1_CONTROL_ID, POSTUN_D1_ADMIN_ID.
// Usage: node scripts/deploy/render-wrangler.mjs [app ...]   (default: every deployable app)
// Errors name the missing setting, never a value.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from '../lib/jsonc.mjs';

/**
 * Deploy order. auth is the hub every other Worker calls over RPC, so it goes first; the site goes last.
 * The service bindings form a cycle (auth -> mcp, mcp -> auth/admin, admin -> auth), so no order is safe for every
 * change: RPC changes must be additive and backward compatible for one release (add a method, ship, then use it).
 */
export const APPS = ['auth', 'mcp', 'admin', 'web'];

const PLACEHOLDERS = {
  REPLACE_WITH_KV_ID: 'POSTUN_KV_OAUTH_ID',
  REPLACE_WITH_D1_ID: 'POSTUN_D1_CONTROL_ID',
  REPLACE_WITH_ADMIN_D1_ID: 'POSTUN_D1_ADMIN_ID'
};
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Custom-domain hostnames each Worker serves. */
export const hostsFor = (app, domain) => (app === 'web' ? [domain, `www.${domain}`, `app.${domain}`] : [`${app}.${domain}`]);

/** Returns the rendered config text; throws with the name of the first missing or malformed setting. */
export function render(app, src, env) {
  if (!APPS.includes(app)) throw new Error(`unknown app: ${app}`);
  const domain = env.POSTUN_DOMAIN?.trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain)) throw new Error('POSTUN_DOMAIN missing or invalid');
  const cfg = JSON.parse(stripJsonc(src));
  delete cfg.env;
  // The public vars carry absolute URLs (issuer, origins, MCP resource). A deployment on another domain must change
  // them in wrangler.jsonc too, otherwise OAuth would advertise the wrong origin while routes point elsewhere.
  for (const [name, value] of Object.entries(cfg.vars ?? {})) {
    if (typeof value !== 'string' || !/^https:\/\//.test(value)) continue;
    const host = new URL(value).hostname;
    if (host !== domain && !host.endsWith(`.${domain}`)) throw new Error(`${app}: vars.${name} is not on POSTUN_DOMAIN`);
  }
  cfg.routes = hostsFor(app, domain).map((pattern) => ({ pattern, custom_domain: true }));
  let text = JSON.stringify(cfg, null, 2);
  for (const [placeholder, name] of Object.entries(PLACEHOLDERS)) {
    if (!text.includes(placeholder)) continue;
    const value = env[name]?.trim().toLowerCase();
    if (!value || !ID_RE.test(value)) throw new Error(`${name} missing or invalid`);
    text = text.split(placeholder).join(value);
  }
  if (text.includes('REPLACE_WITH_')) throw new Error(`${app}: unfilled placeholder in wrangler.jsonc`);
  return `${text}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apps = process.argv.slice(2).length ? process.argv.slice(2) : APPS;
  try {
    for (const app of apps) {
      const dir = new URL(`../../apps/${app}/`, import.meta.url);
      writeFileSync(new URL('wrangler.deploy.json', dir), render(app, readFileSync(new URL('wrangler.jsonc', dir), 'utf8'), process.env));
      console.log(`rendered ${app}`);
    }
  } catch (e) {
    console.error(`render failed: ${e.message}`);
    process.exit(1);
  }
}
