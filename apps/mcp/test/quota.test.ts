import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { utcMonth } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, principalStub, setupWorld } from './helpers';

describe('Q-01 atomic reservation', () => {
  it('101 concurrent operations with daily limit 100 yield exactly 100 successes', async () => {
    const w = await setupWorld();
    syntheticControl.latencyMs = 5;
    const results = await Promise.all(Array.from({ length: 101 }, () => callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 1 })));
    const ok = results.filter((r) => !r.isError).length;
    const rejected = results.filter((r) => errCode(r) === 'QUOTA_EXCEEDED').length;
    expect(ok).toBe(100);
    expect(rejected).toBe(1);
    const usage = await principalStub(w.principalId).getUsage(w.principalId);
    expect(usage.successCount).toBe(100);
    expect(usage.daySuccessCount).toBe(100);
    expect(usage.dailySuccessLimit).toBe(100); // the daily limit is the binding one in this config
    expect(usage.monthlySuccessLimit).toBe(1000);
    // Quota exhausted: the next call is refused before Telegram.
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('QUOTA_EXCEEDED');
    expect(syntheticControl.opens).toBe(0);
  });

  it('failures are not counted and release their reservation', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = Object.assign(new Error('raw'), { text: 'RPC_CALL_FAIL', code: 500 });
    const failed = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect(failed.isError).toBe(true);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] })).isError).toBe(false);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(1);
  });

  it('list_accounts and invalid input do not consume quota', async () => {
    const w = await setupWorld();
    await callTool(w.token, 'list_accounts', {});
    await callTool(w.token, 'list_dialogs', { account_id: 'not-a-uuid' });
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
  });
});

describe('Q-02 idempotency', () => {
  it('the same operation_id retried is counted once', async () => {
    const w = await setupWorld();
    const args = { account_id: w.accountIds[0], limit: 5, operation_id: 'op-retry-0001' };
    expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(false);
    expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(false);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(1);
  });

  it('a failed attempt does not burn the key; the retry is counted once', async () => {
    const w = await setupWorld();
    const args = { account_id: w.accountIds[0], operation_id: 'op-retry-0002' };
    syntheticControl.throwNext = Object.assign(new Error('raw'), { text: 'TIMEOUT', code: 500 });
    expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(true);
    expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(false);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(1);
  });

  it('concurrent duplicates of one key do not double count', async () => {
    const w = await setupWorld();
    syntheticControl.latencyMs = 10;
    const args = { account_id: w.accountIds[0], operation_id: 'op-concurrent-1' };
    const rs = await Promise.all([callTool(w.token, 'list_dialogs', args), callTool(w.token, 'list_dialogs', args)]);
    expect(rs.filter((r) => !r.isError).length).toBe(1);
    expect(rs.filter((r) => errCode(r) === 'CONFLICT').length).toBe(1);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(1);
  });

  it('reusing a key for a different request is a conflict, not a free read', async () => {
    const w = await setupWorld();
    const key = 'op-reuse-00001';
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 1, operation_id: key });
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 2, operation_id: key });
    expect(errCode(r)).toBe('CONFLICT');
    // A real error with a fix, not a "paused" answer the AI would repeat forever.
    const e = r.data.error as Record<string, unknown>;
    expect(e.status).toBeUndefined();
    expect(String(e.hint)).toContain('new operation_id');
  });

  it('the idempotency row stores no arguments or results', async () => {
    const w = await setupWorld();
    await callTool(w.token, 'search_messages', { account_id: w.accountIds[0], query: 'SYNTH-QUERY-MARKER', operation_id: 'op-privacy-001' });
    const dump = await runInDurableObject(principalStub(w.principalId), (_i, state) => state.storage.sql.exec('SELECT * FROM idem').toArray());
    expect(dump.length).toBe(1);
    expect(JSON.stringify(dump)).not.toContain('SYNTH');
  });
});

describe('retention alarm', () => {
  it('removes expired idempotency rows, old usage months, expired intents and stale pending accounts', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], operation_id: 'op-expire-0001' });
    const stale = crypto.randomUUID();
    await runInDurableObject(stub, (_i, state) => {
      state.storage.sql.exec("INSERT INTO accounts(account_id, status, label, envelope, created_at, status_at) VALUES(?, 'pending', '', NULL, 1, 1)", stale);
      const sql = state.storage.sql;
      sql.exec('UPDATE idem SET expires_at = 1');
      sql.exec("INSERT INTO usage(month, success_count, out_bytes, revision) VALUES('2020-01', 5, 5, 1), (?, 1, 1, 1)", utcMonth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1))));
    });
    await runDurableObjectAlarm(stub);
    const rows = await runInDurableObject(stub, (_i, state) => ({
      idem: state.storage.sql.exec('SELECT COUNT(*) AS n FROM idem').one().n,
      months: state.storage.sql.exec('SELECT month FROM usage ORDER BY month').toArray().map((r) => r.month),
      stale: state.storage.sql.exec('SELECT COUNT(*) AS n FROM accounts WHERE account_id = ?', stale).one().n
    }));
    expect(rows.idem).toBe(0);
    expect(rows.months).not.toContain('2020-01');
    expect(rows.months.length).toBeLessThanOrEqual(3);
    expect(rows.stale).toBe(0);
  });
});

describe('configuration fails closed', () => {
  it('missing secrets give CONFIG_MISSING, never defaults', async () => {
    const { loadKeys, loadConfig } = await import('../src/config');
    await expect(loadKeys({ ...env, SESSION_KEK: undefined } as never)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(loadKeys({ ...env, CURSOR_HMAC_KEY: 'short' } as never)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    expect(() => loadConfig({ ...env, BETA_MONTHLY_SUCCESS_LIMIT: undefined } as never)).toThrowError(/Service is not configured/);
    expect(() => loadConfig({ ...env, MCP_RESOURCE: 'http://mcp.example/mcp' } as never)).toThrowError(/Service is not configured/);
  });

  it('the synthetic adapter is refused outside APP_ENV=test and unknown adapters never fall back', async () => {
    const { selectAdapter } = await import('../src/telegram/adapter');
    await expect(selectAdapter({ ...env, APP_ENV: 'production', TELEGRAM_ADAPTER: 'synthetic' } as never)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(selectAdapter({ ...env, APP_ENV: 'test', TELEGRAM_ADAPTER: 'whatever' } as never)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(selectAdapter({ ...env, APP_ENV: 'production', TELEGRAM_ADAPTER: 'mtcute', TELEGRAM_API_ID: undefined } as never)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });

  it('feature flags gate channel tools and downloads', async () => {
    const { assertFeatureEnabled } = await import('../src/tools');
    const cfg = { channelsEnabled: false, maxFileBytes: 0 } as never;
    expect(() => assertFeatureEnabled('search_channels', cfg)).toThrowError(/not enabled/);
    expect(() => assertFeatureEnabled('get_channel_posts', cfg)).toThrowError(/not enabled/);
    expect(() => assertFeatureEnabled('get_media', cfg)).toThrowError(/not enabled/);
    expect(() => assertFeatureEnabled('list_dialogs', cfg)).not.toThrow();
  });
});

describe('daily counters', () => {
  it('keep only today and two previous UTC days', async () => {
    const w = await setupWorld();
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 1 });
    const stub = principalStub(w.principalId);
    await runInDurableObject(stub, (_i, state) => {
      state.storage.sql.exec("INSERT INTO usage_day(day, success_count) VALUES('2020-01-01', 5)");
    });
    await runInDurableObject(stub, (_i, state) => state.storage.setAlarm(Date.now()));
    await runDurableObjectAlarm(stub);
    const days = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec('SELECT day FROM usage_day').toArray().map((r) => String(r.day)));
    expect(days).not.toContain('2020-01-01');
    expect(days).toContain(new Date().toISOString().slice(0, 10));
  });
});
