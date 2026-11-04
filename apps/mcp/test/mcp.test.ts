import { runInDurableObject } from 'cloudflare:test';
import { TOOLS } from '@postun/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, mcpRequest, principalStub, setupWorld } from './helpers';

describe('tools/list', () => {
  it('returns exactly the 8 read-only tools', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; inputSchema: { properties: Record<string, unknown> } }[] } };
    const tools = body.result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    expect(tools).toHaveLength(8);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
      expect(t.description).toContain('Beta');
    }
    // No tool accepts a principal id, and none can write.
    expect(JSON.stringify(tools)).not.toMatch(/principal|send|delete|write/i);
  });

  it('tools/list does not consume quota and works without touching Telegram', async () => {
    const w = await setupWorld();
    await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
    expect(syntheticControl.opens).toBe(0);
  });

  it('exposes protected resource metadata for discovery', async () => {
    const { exports } = await import('cloudflare:workers');
    const res = await exports.default.fetch('https://mcp.test/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resource: 'https://mcp.test/mcp', authorization_servers: ['https://auth.test'] });
  });
});

describe('read tools', () => {
  it('list_accounts returns only the grant accounts, with masked labels', async () => {
    const w = await setupWorld({ accounts: 2 });
    const r = await callTool(w.token, 'list_accounts', {});
    const accounts = r.data.accounts as { accountId: string; label: string; status: string }[];
    expect(accounts.map((a) => a.accountId).sort()).toEqual([...w.accountIds].sort());
    expect(accounts.every((a) => a.status === 'active' && a.label === 'A•••')).toBe(true);
  });

  it('list_dialogs: default 50, max 100 (above is invalid), pages through everything with signed cursors', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const first = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect((first.data.dialogs as unknown[]).length).toBe(50);
    expect((await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 101 })).isError).toBe(true);
    expect((await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 0 })).isError).toBe(true);
    const ids: string[] = [];
    let cursor: string | null | undefined;
    do {
      const r = await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const d of r.data.dialogs as { peerId: string }[]) ids.push(d.peerId);
      cursor = r.data.nextCursor as string | null;
    } while (cursor);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it('get_history: pagination, date range and untrusted-content wrapping', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const peer = ((await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 1 })).data.dialogs as { peerId: string }[])[0]!.peerId;
    const p1 = await callTool(w.token, 'get_history', { account_id: acc, peer, limit: 100 });
    const m1 = p1.data.messages as { id: number; text: string; date: string }[];
    expect(m1).toHaveLength(100);
    expect(m1[0]!.id).toBeGreaterThan(m1[99]!.id);
    expect(String(p1.data.notice)).toContain('untrusted');
    const p2 = await callTool(w.token, 'get_history', { account_id: acc, peer, limit: 100, cursor: p1.data.nextCursor });
    const m2 = p2.data.messages as { id: number }[];
    expect(m2[0]!.id).toBe(m1[99]!.id - 1);
    // Date range: messages are one minute apart; ask for a 10 minute window.
    const hi = new Date(m1[0]!.date);
    const lo = new Date(hi.getTime() - 9 * 60_000);
    const ranged = await callTool(w.token, 'get_history', { account_id: acc, peer, from_date: lo.toISOString(), to_date: hi.toISOString(), limit: 100 });
    expect((ranged.data.messages as unknown[]).length).toBe(10);
    expect(ranged.data.nextCursor).toBeNull();
    // Unbounded or malformed inputs are rejected.
    expect((await callTool(w.token, 'get_history', { account_id: acc, peer: '../../etc/passwd' })).isError).toBe(true);
    expect((await callTool(w.token, 'get_history', { account_id: acc, peer, from_date: 'yesterday' })).isError).toBe(true);
  });

  it('search_messages works globally and inside one chat; the cursor is bound to the query', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const g = await callTool(w.token, 'search_messages', { account_id: acc, query: 'synth-msg', limit: 5 });
    expect((g.data.messages as unknown[]).length).toBe(5);
    const other = await callTool(w.token, 'search_messages', { account_id: acc, query: 'different query', cursor: g.data.nextCursor });
    expect(errCode(other)).toBe('INVALID_CURSOR');
    const same = await callTool(w.token, 'search_messages', { account_id: acc, query: 'synth-msg', limit: 5, cursor: g.data.nextCursor });
    expect(same.isError).toBe(false);
  });

  it('channel tools work when FEATURE_CHANNELS=on', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const ch = await callTool(w.token, 'search_channels', { account_id: acc, query: 'news' });
    const channels = ch.data.channels as { peerId: string }[];
    expect(channels.length).toBeGreaterThan(0);
    const posts = await callTool(w.token, 'get_channel_posts', { account_id: acc, channel: channels[0]!.peerId, limit: 5 });
    expect((posts.data.messages as unknown[]).length).toBe(5);
  });

  it('get_media_info for a message without media is NOT_FOUND', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'get_media_info', { account_id: w.accountIds[0], peer: 'c:1000:7', message_id: 11 });
    expect(errCode(r)).toBe('NOT_FOUND');
  });

  it('operation_id must be well formed', async () => {
    const w = await setupWorld();
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], operation_id: 'x' })).isError).toBe(true);
  });
});

describe('MT-02 per-account serialization', () => {
  it('never runs two upstream operations on one account at the same time, but accounts run in parallel', async () => {
    const w = await setupWorld({ accounts: 2 });
    syntheticControl.latencyMs = 15;
    await Promise.all(Array.from({ length: 6 }, () => callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 1 })));
    expect(syntheticControl.maxActive).toBe(1);
    syntheticControl.maxActive = 0;
    await Promise.all(w.accountIds.flatMap((a) => [callTool(w.token, 'list_dialogs', { account_id: a, limit: 1 }), callTool(w.token, 'list_dialogs', { account_id: a, limit: 1 })]));
    expect(syntheticControl.maxActive).toBe(2);
  });
});

describe('PR-02 errors are mapped to safe codes', () => {
  it('FLOOD_WAIT becomes RATE_LIMITED with retry-after; revoked auth becomes ACCOUNT_NOT_ACTIVE', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = Object.assign(new Error('Telegram API error 420: FLOOD_WAIT_17 RAW-SECRET'), { text: 'FLOOD_WAIT_17', code: 420 });
    const flood = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect(errCode(flood)).toBe('RATE_LIMITED');
    expect((flood.data.error as { retryAfterSeconds: number }).retryAfterSeconds).toBe(17);
    expect(flood.raw).not.toContain('RAW-SECRET');
    syntheticControl.throwNext = Object.assign(new Error('x'), { text: 'AUTH_KEY_UNREGISTERED', code: 401 });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('unknown SDK errors are reduced to INTERNAL without any detail', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = new Error('SYNTH-RAW-ERROR-WITH-PHONE +10000000000 and message text');
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect(errCode(r)).toBe('INTERNAL');
    expect(r.raw).not.toContain('SYNTH-RAW');
    expect(r.raw).not.toContain('+1000');
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
  });
});

describe('PR-01 no content in storage or logs', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'] as const;
  afterEach(() => vi.restoreAllMocks());

  it('message text, file names, queries and QR urls never reach DO tables or console output', async () => {
    const calls: string[] = [];
    for (const m of spies) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void calls.push(a.map(String).join(' ')));
    console.warn('SPY-SELF-CHECK');
    expect(calls).toContain('SPY-SELF-CHECK'); // the spy really observes console output
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const peer = 'c:1000:7';
    await callTool(w.token, 'get_history', { account_id: acc, peer, limit: 100, operation_id: 'op-pr01-00001' });
    expect(syntheticControl.opens).toBeGreaterThan(0); // the synthetic adapter was really exercised
    await callTool(w.token, 'search_messages', { account_id: acc, query: 'SYNTH-QUERY-MARKER', operation_id: 'op-pr01-00002' });
    const media = await callTool(w.token, 'get_media', { account_id: acc, peer, message_id: 10 });
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    syntheticControl.throwNext = new Error('SYNTH-MSG-LEAK-IN-ERROR');
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    const capability = (media.data.download as { authorization: string }).authorization.replace('Bearer ', '');

    const dump = await runInDurableObject(principalStub(w.principalId), (_i, state) => {
      const sql = state.storage.sql;
      const names = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").toArray().map((r) => String(r.name));
      return names.map((n) => `${n}: ${JSON.stringify(sql.exec(`SELECT * FROM "${n}"`).toArray())}`).join('\n');
    });
    for (const marker of ['SYNTH-MSG', 'SYNTH-FILE', 'SYNTH-QUERY-MARKER', 'SYNTH-SESSION-MARKER', 'SYNTHETIC-QR-TOKEN', 'Synthetic Sender', 'Synthetic Dialog']) {
      expect(dump, `table dump contains ${marker}`).not.toContain(marker);
    }
    expect(dump).not.toContain(capability.split('.')[1]!);
    const logged = calls.join('\n');
    for (const marker of ['SYNTH-', 'SYNTHETIC-QR-TOKEN', capability.split('.')[1]!, w.token]) {
      expect(logged, `console contains ${marker}`).not.toContain(marker);
    }
  });
});
