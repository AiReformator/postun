import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ProjectionSink } from '../src/projection';
import { call, db, makeEnv } from './helpers';

const proj = (over: Record<string, unknown> = {}) => ({ principalRef: 'ref_BBBBBBBBBBBBBBBBBBBB', revision: 1, linkedAccounts: 2, status: 'active' as const, plan: 'beta_free' as const, month: '2026-11', successCount: 10, outBytes: 1000, ...over });
const sink = (): ProjectionSink => new ProjectionSink(createExecutionContext(), makeEnv());
const row = () => db.prepare('SELECT revision, success_count, status FROM projections').first();

describe('ProjectionSink', () => {
  it('applies only strictly newer revisions (idempotent, order-independent)', async () => {
    const s = sink();
    expect(await s.upsert(proj({ revision: 2, successCount: 20 }))).toEqual({ applied: true });
    expect(await s.upsert(proj({ revision: 1, successCount: 5 }))).toEqual({ applied: false });
    expect(await s.upsert(proj({ revision: 2, successCount: 99 }))).toEqual({ applied: false });
    expect(await row()).toEqual({ revision: 2, success_count: 20, status: 'active' });
    expect(await s.upsert(proj({ revision: 3, successCount: 30, status: 'suspended' }))).toEqual({ applied: true });
    expect(await row()).toEqual({ revision: 3, success_count: 30, status: 'suspended' });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM projections').first<{ n: number }>())?.n).toBe(1);
  });
  it('rejects invalid payloads and stores nothing', async () => {
    const s = sink();
    for (const bad of [proj({ principalRef: 'short' }), proj({ status: 'weird' }), proj({ plan: 'paid' }), proj({ month: '2026-13x' }), proj({ successCount: -1 }), proj({ revision: 1.5 })]) {
      await expect(s.upsert(bad as never)).rejects.toThrow();
    }
    expect(await row()).toBeNull();
  });
  it('works even when IDP is not configured', async () => {
    const s = new ProjectionSink(createExecutionContext(), makeEnv({ IDP_ISSUER: undefined }));
    expect(await s.upsert(proj())).toEqual({ applied: true });
  });
  it('is not reachable over HTTP', async () => {
    for (const path of ['/ProjectionSink', '/upsert', '/projections']) {
      for (const method of ['GET', 'POST']) {
        const res = await call(makeEnv(), path, { method, body: method === 'POST' ? JSON.stringify(proj()) : undefined, headers: { 'content-type': 'application/json' } });
        expect([404, 405]).toContain(res.status);
      }
    }
    expect(await row()).toBeNull();
  });
});
