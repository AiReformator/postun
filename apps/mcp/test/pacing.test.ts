import { runInDurableObject } from 'cloudflare:test';
import { toSafeError, PostunError } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTION } from '../src/schemas';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, mcpRequest, principalStub, setupWorld, withVars, type ToolResult, type World } from './helpers';

const err = (r: ToolResult) => r.data.error as { code: string; message: string; retryAfterSeconds?: number; reason?: string; hint?: string };
const dialogs = (w: World, extra: Record<string, unknown> = {}, i = 0) => callTool(w.token, 'list_dialogs', { account_id: w.accountIds[i], limit: 1, ...extra });

async function aPeer(w: World, kind: 'u' | 'c' = 'u'): Promise<string> {
  const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 100 });
  const peer = (r.data.dialogs as { peerId: string }[]).find((d) => d.peerId.startsWith(`${kind}:`));
  if (!peer) throw new Error('no peer');
  return peer.peerId;
}

async function reservations(w: World): Promise<number> {
  return runInDurableObject(principalStub(w.principalId), (inst) => {
    const o = inst as unknown as { reserved: Map<string, number>; reservedDay: Map<string, number> };
    return [...o.reserved.values(), ...o.reservedDay.values()].reduce((a, b) => a + b, 0);
  });
}

describe('persisted flood cooldown', () => {
  it('stores a Telegram FLOOD_WAIT and then refuses before any client is opened, releasing the quota reservation', async () => {
    const w = await setupWorld({ accounts: 2 });
    syntheticControl.throwNext = Object.assign(new Error('raw'), { text: 'FLOOD_WAIT_%d', seconds: 30, code: 420 });
    const first = await dialogs(w);
    expect(first.isError).toBe(true);
    expect(err(first)).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 30, reason: 'FLOOD_WAIT' });
    expect(err(first).hint).toMatch(/retryAfterSeconds/);

    syntheticControl.opens = 0;
    syntheticControl.ops = 0;
    const second = await dialogs(w);
    expect(err(second).code).toBe('RATE_LIMITED');
    expect(err(second).reason).toBe('FLOOD_WAIT');
    expect(err(second).retryAfterSeconds).toBeGreaterThanOrEqual(30);
    expect(err(second).retryAfterSeconds).toBeLessThanOrEqual(36); // 30 s + the 5 s margin
    expect(syntheticControl.opens).toBe(0);
    expect(syntheticControl.ops).toBe(0);

    // The refusal released its reservation and was not counted.
    expect(await reservations(w)).toBe(0);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);

    // Another account of the same principal is unaffected.
    expect((await dialogs(w, {}, 1)).isError).toBe(false);

    // Once the stored cooldown has passed, the account works again.
    await runInDurableObject(principalStub(w.principalId), (inst) => {
      (inst as unknown as { ctx: DurableObjectState }).ctx.storage.sql.exec('UPDATE pacing SET cooldown_until = 1');
    });
    expect((await dialogs(w)).isError).toBe(false);
  });

  it('SLOWMODE_WAIT is reported but does not start an account cooldown', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = Object.assign(new Error('raw'), { text: 'SLOWMODE_WAIT_%d', seconds: 20, code: 420 });
    const first = await dialogs(w);
    expect(err(first)).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 20, reason: 'SLOWMODE_WAIT' });
    expect((await dialogs(w)).isError).toBe(false);
  });

  it('the AI sees a Telegram flood as a pause from Telegram, not a refusal', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = Object.assign(new Error('raw'), { text: 'FLOOD_WAIT_%d', seconds: 30, code: 420 });
    const e = err(await dialogs(w));
    expect(e).toMatchObject({ status: 'paused', temporary: true, source: 'telegram', code: 'RATE_LIMITED', retryAfterSeconds: 30 });
    expect(String(e.message)).toMatch(/^PAUSED, not refused/);
  });

  it('a short remaining cooldown is sat out inside the call instead of being returned to the AI', async () => {
    const w = await setupWorld();
    await runInDurableObject(principalStub(w.principalId), (inst) => {
      (inst as unknown as { ctx: DurableObjectState }).ctx.storage.sql.exec(
        `INSERT INTO pacing(account_id, state, cooldown_until, updated_at) VALUES(?, '{}', ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET cooldown_until = excluded.cooldown_until`,
        w.accountIds[0], Date.now() + 1200, Date.now()
      );
    });
    syntheticControl.opens = 0;
    const t0 = Date.now();
    const r = await dialogs(w);
    expect(r.isError).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect(syntheticControl.opens).toBe(1);
  });
});

describe('local pacing', () => {
  it('refuses with LOCAL_PACING before Telegram once the burst is used, and does not count the refusal', async () => {
    const w = await setupWorld();
    await withVars(w, { PACING_BURST: '2', PACING_REFILL_MS: '60000' }, async () => {
      expect((await dialogs(w)).isError).toBe(false);
      expect((await dialogs(w)).isError).toBe(false);
      syntheticControl.opens = 0;
      const r = await dialogs(w);
      expect(err(r)).toMatchObject({ code: 'RATE_LIMITED', reason: 'LOCAL_PACING', retryAfterSeconds: 60 });
      expect(err(r).hint).toBeTruthy();
      expect(syntheticControl.opens).toBe(0);
      expect(await reservations(w)).toBe(0);
      expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(2);
    });
  });

  it('enforces the hourly cap', async () => {
    const w = await setupWorld();
    await withVars(w, { PACING_HOURLY_CAP: '2' }, async () => {
      await dialogs(w);
      await dialogs(w);
      syntheticControl.opens = 0;
      const r = await dialogs(w);
      expect(err(r)).toMatchObject({ code: 'RATE_LIMITED', reason: 'HOURLY_CAP' });
      expect(err(r).retryAfterSeconds).toBeGreaterThan(60);
      expect(syntheticControl.opens).toBe(0);
    });
  });

  it('applies the stricter cap to search_channels and global search, not to peer-scoped search', async () => {
    const w = await setupWorld();
    const peer = await aPeer(w);
    await withVars(w, { PACING_LOOKUP_PER_MIN: '2', PACING_LOOKUP_BURST: '2', PACING_MAX_SMOOTH_MS: '0' }, async () => {
      const search = (a: Record<string, unknown>) => callTool(w.token, 'search_messages', { account_id: w.accountIds[0], query: 'SYNTH', limit: 1, ...a });
      expect((await callTool(w.token, 'search_channels', { account_id: w.accountIds[0], query: 'a' })).isError).toBe(false);
      expect((await search({})).isError).toBe(false); // global: second lookup
      syntheticControl.opens = 0;
      expect(err(await callTool(w.token, 'search_channels', { account_id: w.accountIds[0], query: 'a' })).reason).toBe('LOOKUP_CAP');
      expect(err(await search({})).reason).toBe('LOOKUP_CAP');
      expect(syntheticControl.opens).toBe(0);
      // With a peer it is an ordinary call; so are other tools.
      expect((await search({ peer })).isError).toBe(false);
      expect((await dialogs(w)).isError).toBe(false);
    });
  });
});

describe('message budget', () => {
  it('counts returned messages and refuses with MESSAGE_BUDGET until the window frees', async () => {
    const w = await setupWorld();
    const peer = await aPeer(w);
    await withVars(w, { PACING_MESSAGES_PER_HOUR: '60' }, async () => {
      const read = () => callTool(w.token, 'get_history', { account_id: w.accountIds[0], peer, limit: 50 });
      const a = await read();
      expect((a.data.limits as { messagesRemainingThisHour: number }).messagesRemainingThisHour).toBe(10);
      expect((await read()).isError).toBe(false); // soft cap: allowed while the budget is not yet used up
      syntheticControl.opens = 0;
      const r = await read();
      expect(err(r)).toMatchObject({ code: 'RATE_LIMITED', reason: 'MESSAGE_BUDGET' });
      expect(err(r).retryAfterSeconds).toBeGreaterThan(0);
      expect(syntheticControl.opens).toBe(0);
      // Non-message tools are not blocked by it.
      expect((await dialogs(w)).isError).toBe(false);
    });
  });
});

describe('native pagination', () => {
  it('list_dialogs pages with Telegram-native offsets: one RPC per page, no skip re-iteration, no look-ahead', async () => {
    const w = await setupWorld();
    syntheticControl.ops = 0;
    const first = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 100 });
    expect((first.data.dialogs as unknown[]).length).toBe(100);
    expect(syntheticControl.ops).toBe(1);
    const cursor = first.data.nextCursor as string;
    expect(cursor).toBeTruthy();
    syntheticControl.ops = 0;
    const second = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 100, cursor });
    expect(second.isError).toBe(false);
    expect(syntheticControl.ops).toBe(1);
    expect((second.data.dialogs as unknown[]).length).toBe(20);
    expect(second.data.nextCursor).toBeNull();
  });

  it('a pre-native skip cursor is refused with INVALID_INPUT "Cursor expired, start again" before reaching Telegram data', async () => {
    const w = await setupWorld();
    const { loadKeys } = await import('../src/config');
    const { env } = await import('cloudflare:workers');
    const { encodeCursor } = await import('@postun/contracts');
    const cursor = await encodeCursor(
      (await loadKeys(env)).cursor,
      { principalId: w.principalId, accountId: w.accountIds[0] as string, tool: 'list_dialogs', scope: '*' },
      '100'
    );
    syntheticControl.opens = 0;
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 10, cursor });
    expect(err(r)).toMatchObject({ code: 'INVALID_INPUT', reason: 'CURSOR_EXPIRED', message: 'Cursor expired, start again' });
    expect(await reservations(w)).toBe(0);
    expect(syntheticControl.opens).toBe(0); // refused before pacing, the lock and any Telegram session
    // A forged cursor is refused the same cheap way.
    const forged = await callTool(w.token, 'get_history', { account_id: w.accountIds[0], peer: 'c:1:1', limit: 10, cursor: 'x'.repeat(40) });
    expect(err(forged).code).toBe('INVALID_CURSOR');
    expect(syntheticControl.opens).toBe(0);
  });
});

describe('quota messages', () => {
  it('names the daily and the monthly quota separately', async () => {
    const w = await setupWorld();
    await withVars(w, { BETA_DAILY_SUCCESS_LIMIT: '1' }, async () => {
      expect((await dialogs(w)).isError).toBe(false);
      expect(err(await dialogs(w))).toMatchObject({ code: 'QUOTA_EXCEEDED', reason: 'DAILY_QUOTA', message: 'Daily beta quota exhausted' });
    });
    await withVars(w, { BETA_MONTHLY_SUCCESS_LIMIT: '1' }, async () => {
      expect(err(await dialogs(w))).toMatchObject({ code: 'QUOTA_EXCEEDED', reason: 'MONTHLY_QUOTA', message: 'Monthly beta quota exhausted' });
    });
  });
});

describe('error shape', () => {
  it('toSafeError passes reason and hint through and omits them when absent', () => {
    expect(toSafeError(new PostunError('RATE_LIMITED', 7, { reason: 'LOCAL_PACING', hint: 'wait' }))).toEqual({
      code: 'RATE_LIMITED', message: 'Telegram asked to retry later', retryAfterSeconds: 7, reason: 'LOCAL_PACING', hint: 'wait'
    });
    expect(toSafeError(new PostunError('NOT_FOUND'))).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(toSafeError(new Error('secret detail'))).toEqual({ code: 'INTERNAL', message: 'Internal error' });
  });
});

describe('AI contract', () => {
  it('the server instructions explain pacing, cursors and RATE_LIMITED', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    const body = await res.text();
    const msg = JSON.parse(body.startsWith('{') ? body : (body.split('\n').find((l) => l.startsWith('data:')) ?? 'data: {}').slice(5)) as { result: { instructions?: string } };
    const text = msg.result.instructions ?? '';
    expect(text).toBe(SERVER_INSTRUCTIONS);
    expect(text).toMatch(/nextCursor/);
    expect(text).toMatch(/RATE_LIMITED/);
    expect(text).toMatch(/retryAfterSeconds/);
    expect(text).toMatch(/limits object/);
    expect(text).toMatch(/Large reads .* are supported/);
  });

  it('every Telegram tool description carries a pacing line', () => {
    for (const [tool, d] of Object.entries(TOOL_DESCRIPTION)) {
      if (tool === 'list_accounts') continue;
      expect(d, tool).toMatch(/pacing|spaces these out/i);
    }
  });

  it('successful tool results carry a limits object next to the existing fields', async () => {
    const w = await setupWorld();
    const r = await dialogs(w);
    expect(r.data.dialogs).toBeDefined();
    expect(r.data.nextCursor).toBeDefined();
    const limits = r.data.limits as Record<string, number>;
    expect(Object.keys(limits).sort()).toEqual(['callsRemainingNow', 'messagesRemainingThisHour', 'nextCallNotBeforeSeconds', 'paceSeconds']);
    for (const v of Object.values(limits)) expect(Number.isFinite(v)).toBe(true);
    expect((await callTool(w.token, 'list_accounts', {})).data.limits).toBeUndefined();
  });

  it('with the default pacing the first calls of an account report the full burst', async () => {
    const w = await setupWorld();
    await withVars(w, { PACING_BURST: '20', PACING_REFILL_MS: '2000', PACING_HOURLY_CAP: '600' }, async () => {
      const r = await dialogs(w);
      expect((r.data.limits as { callsRemainingNow: number }).callsRemainingNow).toBe(19);
    });
  });
});
