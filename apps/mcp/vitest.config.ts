import { randomBytes } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

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
const key = () => randomBytes(32).toString("base64url");

const mcpPlugin = () =>
  cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: {
        APP_ENV: "test",
        TELEGRAM_ADAPTER: "synthetic",
        MCP_RESOURCE: "https://mcp.test/mcp",
        AUTH_ISSUER: "https://auth.test",
        BETA_MONTHLY_SUCCESS_LIMIT: "1000",
        BETA_DAILY_SUCCESS_LIMIT: "100",
        MAX_FILE_BYTES: "5000000",
        FEATURE_CHANNELS: "on",
        // Pacing is effectively off for the general suite (it makes hundreds of calls in a burst); test/pacing.test.ts
        // overrides these on the Durable Object's own env to exercise the real defaults and tight limits.
        PACING_BURST: "1000000",
        PACING_REFILL_MS: "1",
        PACING_HOURLY_CAP: "100000000",
        PACING_LOOKUP_PER_MIN: "1000000",
        PACING_LOOKUP_PER_DAY: "100000000",
        PACING_MESSAGES_PER_HOUR: "1000000000",
        SESSION_KEK: key(),
        SESSION_KEK_VERSION: "test-k1",
        SESSION_KEK_PREVIOUS: key(),
        SESSION_KEK_PREVIOUS_VERSION: "test-k0",
        CURSOR_HMAC_KEY: key(),
      },
      workers: [
        {
          name: "postun-auth",
          modules: true,
          script: AUTH_STUB,
          compatibilityDate: "2026-11-01",
        },
        {
          name: "postun-admin",
          modules: true,
          script: SINK_STUB,
          compatibilityDate: "2026-11-01",
        },
      ],
    },
  });

// Two projects, so the transformed mtcute module graph (about 10 MB of code plus sourcemaps) never lands in
// the module cache of the project that runs the other files. The Cloudflare pool inlines the whole cached
// import graph of a test file into ONE websocket message to workerd (inlineCachedModules in
// @cloudflare/vitest-plugin). Once another file in the same project has transformed mtcute, a later file that
// reaches it through selectAdapter's dynamic import gets a ~36 MB message, workerd answers 1009 "Message is too
// large", and the whole shared workerd runtime (every running file) dies. Keep mtcute-importing files apart.
const MTCUTE_FILES = ["test/mtcute-load.test.ts", "test/review-fixes.test.ts", "test/flood-options.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [mcpPlugin()],
        test: {
          name: "mcp",
          include: ["test/**/*.test.ts"],
          exclude: MTCUTE_FILES,
          testTimeout: 20_000,
        },
      },
      {
        plugins: [mcpPlugin()],
        test: {
          name: "mcp-mtcute",
          include: MTCUTE_FILES,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
