import { createExecutionContext } from 'cloudflare:test';
import { REPORT_BACKLOG_LIMIT } from '@postun/contracts';
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
  it('works even when the IdP is not configured', async () => {
    const s = new ProjectionSink(createExecutionContext(), makeEnv({ ADMIN_OIDC_ISSUER: undefined }));
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

const report = (over: Record<string, unknown> = {}) => ({
  principalRef: 'ref_BBBBBBBBBBBBBBBBBBBB', category: 'session_problem', tool: 'list_dialogs', errorCode: 'ACCOUNT_NOT_ACTIVE', errorReason: 'SESSION_ENDED',
  accountRef: '11111111-1111-4111-8111-111111111111', client: 'ChatGPT', summary: 'Reconnect shows no QR code after pressing the button.', ...over
});

describe('ProjectionSink.submitReport', () => {
  it('stores a report and returns a ticket the user can quote', async () => {
    const r = await sink().submitReport(report() as never);
    expect(r.ticket).toMatch(/^PR-[A-HJKMNP-Z2-9]{8}$/);
    expect(Date.parse(r.receivedAt)).toBeGreaterThan(Date.now() - 5000);
    const row = await db.prepare('SELECT * FROM problem_reports').first<Record<string, unknown>>();
    expect(row).toMatchObject({ id: r.ticket, principal_ref: 'ref_BBBBBBBBBBBBBBBBBBBB', category: 'session_problem', tool: 'list_dialogs', error_code: 'ACCOUNT_NOT_ACTIVE', error_reason: 'SESSION_ENDED', client: 'ChatGPT', status: 'new', note: null });
  });
  it('accepts a report with only the required fields', async () => {
    const r = await sink().submitReport(report({ tool: null, errorCode: null, errorReason: null, accountRef: null, client: null }) as never);
    expect(r.ticket).toMatch(/^PR-/);
  });
  it('rejects anything outside the closed vocabulary and stores nothing', async () => {
    const bad = [
      report({ category: 'free text' }), report({ tool: 'send_message' }), report({ errorCode: 'MY_OWN_CODE' }), report({ errorReason: 'lower case' }),
      report({ accountRef: 'not-a-uuid' }), report({ client: 'x'.repeat(41) }), report({ client: 'bad <script>' }), report({ summary: 'short' }), report({ summary: 'y'.repeat(501) }),
      report({ principalRef: 'short' }), { ...report(), extra: 1 }
    ];
    for (const b of bad) await expect(sink().submitReport(b as never)).rejects.toThrow();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM problem_reports').first<{ n: number }>())?.n).toBe(0);
  });
  it('gives every report its own ticket', async () => {
    const tickets = new Set<string>();
    for (let i = 0; i < 25; i++) tickets.add((await sink().submitReport(report() as never)).ticket);
    expect(tickets.size).toBe(25);
  });
  it('refuses new reports when the unreviewed backlog is full, but not reviewed ones', async () => {
    const ins = db.prepare("INSERT INTO problem_reports (id, created_at, principal_ref, category, summary, status) VALUES (?, ?, 'ref_BBBBBBBBBBBBBBBBBBBB', 'other', 'x'.repeat(10), ?)".replace("'x'.repeat(10)", "'xxxxxxxxxx'"));
    await db.batch(Array.from({ length: REPORT_BACKLOG_LIMIT }, (_, i) => ins.bind(`PR-FULL${String(i).padStart(4, '0')}`, Date.now(), 'new')));
    await expect(sink().submitReport(report() as never)).rejects.toThrow('backlog');
    await db.prepare("UPDATE problem_reports SET status = 'fixed' WHERE id = 'PR-FULL0000'").run();
    expect((await sink().submitReport(report() as never)).ticket).toMatch(/^PR-/);
  });
  it('is not reachable over HTTP', async () => {
    for (const path of ['/submitReport', '/reports', '/problem_reports']) {
      for (const method of ['GET', 'POST']) {
        const res = await call(makeEnv(), path, { method, body: method === 'POST' ? JSON.stringify(report()) : undefined, headers: { 'content-type': 'application/json' } });
        expect([404, 405]).toContain(res.status);
      }
    }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM problem_reports').first<{ n: number }>())?.n).toBe(0);
  });
});
