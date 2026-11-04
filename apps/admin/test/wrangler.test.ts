import { describe, expect, it } from 'vitest';
import raw from '../wrangler.jsonc?raw';

/** Minimal JSONC reader: strips line and block comments outside strings. */
function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_m, s: string | undefined) => s ?? '');
  return JSON.parse(stripped) as Record<string, unknown>;
}
const cfg = parseJsonc(raw);

const BINDING_KEYS = [
  'kv_namespaces', 'durable_objects', 'r2_buckets', 'queues', 'analytics_engine_datasets', 'hyperdrive', 'vectorize', 'ai', 'browser', 'send_email',
  'secrets_store_secrets', 'workflows', 'pipelines', 'containers', 'version_metadata', 'images', 'dispatch_namespaces', 'mtls_certificates', 'assets',
  'unsafe', 'migrations', 'tail_consumers', 'vpc_services', 'media', 'ratelimits', 'worker_loaders', 'artifacts'
];
const FORBIDDEN = ['CONTROL_DB', 'OAUTH_KV', 'SESSIONS', 'SESSION_KEK', 'SessionAndQuotaDO'];

describe.each([['production', cfg], ['staging', (cfg.env as Record<string, Record<string, unknown>>).staging!]] as const)('AD-03 wrangler bindings (%s)', (name, c) => {
  it('exposes exactly ADMIN_DB (D1) and CONTROL (service -> AdminControl)', () => {
    const d1 = c.d1_databases as { binding: string }[];
    expect(d1.map((d) => d.binding)).toEqual(['ADMIN_DB']);
    const svc = c.services as { binding: string; entrypoint?: string; service: string }[];
    expect(svc).toHaveLength(1);
    expect(svc[0]).toMatchObject({ binding: 'CONTROL', entrypoint: 'AdminControl', service: name === 'production' ? 'postun-auth' : 'postun-auth-staging' });
  });
  it('has no other binding types', () => {
    for (const k of BINDING_KEYS) expect(c, k).not.toHaveProperty(k);
  });
  it('names no forbidden resources and keeps secrets out of vars', () => {
    const text = JSON.stringify(c);
    for (const f of FORBIDDEN) expect(text).not.toContain(f);
    expect(Object.keys(c.vars as object).sort()).toEqual(['ADMIN_ORIGIN', 'APP_ENV']);
  });
  it('is not public via workers.dev and has observability disabled', () => {
    expect(c.workers_dev).toBe(false);
    expect(c.observability).toEqual({ enabled: false });
  });
});

describe('wrangler identity', () => {
  it('production and staging are distinct resources with distinct redirect origins', () => {
    const s = (cfg.env as Record<string, Record<string, unknown>>).staging!;
    expect(cfg.name).toBe('postun-admin');
    expect(s.name).not.toBe(cfg.name);
    expect((cfg.vars as Record<string, string>).ADMIN_ORIGIN).toBe('https://admin.postun.org');
    expect((s.vars as Record<string, string>).ADMIN_ORIGIN).not.toBe('https://admin.postun.org');
    const p = (cfg.d1_databases as { database_name: string }[])[0]!;
    const q = (s.d1_databases as { database_name: string }[])[0]!;
    expect(p.database_name).toBe('postun-admin-meta');
    expect(q.database_name).not.toBe(p.database_name);
  });
});
