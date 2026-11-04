import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Test-only stand-ins for the sibling Workers reached through service bindings.
// Token format used by the stub: "tok." + base64url(JSON {props, audience?}).
const AUTH_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export default class AuthStub extends WorkerEntrypoint {
  async fetch() { return new Response('auth stub'); }
  async validateToken(resource, token) {
    if (typeof token !== 'string' || !token.startsWith('tok.')) return null;
    let o;
    try { o = JSON.parse(atob(token.slice(4).replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
    return { props: o.props, audience: o.audience ?? resource, expiresAt: Math.floor(Date.now() / 1000) + 3600, scope: (o.props && o.props.scopes) || [], userId: 'test-user', clientId: 'test-client' };
  }
}`;

const SINK_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const seen = [];
export class ProjectionSink extends WorkerEntrypoint {
  async upsert(p) { seen.push(p); return { applied: true }; }
  async all() { return seen; }
}
export default { fetch() { return new Response('sink'); } };`;

// Synthetic keys, generated per run. Never real secrets.
const key = () => randomBytes(32).toString('base64url');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_ENV: 'test',
          TELEGRAM_ADAPTER: 'synthetic',
          MCP_RESOURCE: 'https://mcp.test/mcp',
          AUTH_ISSUER: 'https://auth.test',
          BETA_MONTHLY_SUCCESS_LIMIT: '100',
          MAX_FILE_BYTES: '5000000',
          FEATURE_CHANNELS: 'on',
          SESSION_KEK: key(),
          SESSION_KEK_VERSION: 'test-k1',
          SESSION_KEK_PREVIOUS: key(),
          SESSION_KEK_PREVIOUS_VERSION: 'test-k0',
          CURSOR_HMAC_KEY: key()
        },
        workers: [
          { name: 'postun-auth', modules: true, script: AUTH_STUB, compatibilityDate: '2026-11-01' },
          { name: 'postun-admin', modules: true, script: SINK_STUB, compatibilityDate: '2026-11-01' }
        ]
      }
    })
  ],
  test: { include: ['test/**/*.test.ts'], testTimeout: 20_000 }
});
