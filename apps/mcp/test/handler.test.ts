import { GrantPropsSchema } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { readGrantProps } from '../src/mcp-handler';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, mcpRequest, principalStub, setupWorld } from './helpers';

const U = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const GOOD = { principalId: U(1), grantId: U(2), accounts: [U(3)], scopes: ['accounts:read', 'dialogs:read'], grantVersion: 0 };

describe('readGrantProps (Worker fast path) is equivalent to GrantPropsSchema', () => {
  const cases: [string, unknown][] = [
    ['valid', GOOD],
    ['valid with extra keys (stripped)', { ...GOOD, extra: 'x', __proto__: { a: 1 } }],
    ['empty accounts and scopes', { ...GOOD, accounts: [], scopes: [] }],
    ['10 accounts', { ...GOOD, accounts: Array.from({ length: 10 }, (_, i) => U(i + 10)) }],
    ['11 accounts', { ...GOOD, accounts: Array.from({ length: 11 }, (_, i) => U(i + 10)) }],
    ['nil uuid', { ...GOOD, grantId: '00000000-0000-0000-0000-000000000000' }],
    ['uppercase uuid', { ...GOOD, principalId: U(1).toUpperCase() }],
    ['bad uuid version', { ...GOOD, principalId: '11111111-1111-9111-8111-111111111111' }],
    ['bad uuid variant', { ...GOOD, principalId: '11111111-1111-4111-c111-111111111111' }],
    ['not a uuid', { ...GOOD, grantId: 'nope' }],
    ['uuid with trailing newline', { ...GOOD, grantId: `${U(2)}\n` }],
    ['account not a uuid', { ...GOOD, accounts: ['x'] }],
    ['unknown scope', { ...GOOD, scopes: ['accounts:read', 'messages:write'] }],
    ['all scopes', { ...GOOD, scopes: ['accounts:read', 'dialogs:read', 'messages:read', 'channels:read', 'media:read'] }],
    ['scopes not an array', { ...GOOD, scopes: 'accounts:read' }],
    ['grantVersion negative', { ...GOOD, grantVersion: -1 }],
    ['grantVersion fractional', { ...GOOD, grantVersion: 1.5 }],
    ['grantVersion string', { ...GOOD, grantVersion: '1' }],
    ['grantVersion NaN', { ...GOOD, grantVersion: Number.NaN }],
    ['grantVersion huge', { ...GOOD, grantVersion: 2 ** 60 }],
    ['missing field', { principalId: U(1), grantId: U(2), accounts: [], scopes: [] }],
    ['null', null],
    ['undefined', undefined],
    ['string', 'x'],
    ['array', [GOOD]]
  ];
  it.each(cases)('%s', (_name, input) => {
    const a = GrantPropsSchema.safeParse(input);
    const b = readGrantProps(input);
    expect(b !== null).toBe(a.success);
    if (a.success) expect(b).toEqual(a.data);
  });
});

describe('Worker keeps the tool surface; the Durable Object is the authority on arguments', () => {
  it('tools/list still advertises full JSON Schemas with page size max 100', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = ((await res.json()) as { result: { tools: { name: string; inputSchema: { required?: string[]; properties: Record<string, { maximum?: number; default?: number }> } }[] } }).result.tools;
    const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    for (const t of ['list_dialogs', 'get_history', 'search_messages', 'get_channel_posts']) expect(by[t]?.properties.limit?.maximum, t).toBe(100);
    expect(by.list_dialogs?.required).toContain('account_id');
    expect(by.search_messages?.required).toEqual(expect.arrayContaining(['account_id', 'query']));
  });

  it('invalid arguments are refused by the Durable Object before quota, pacing or Telegram', async () => {
    const w = await setupWorld();
    syntheticControl.opens = 0;
    for (const args of [{ account_id: w.accountIds[0], limit: 101 }, { account_id: w.accountIds[0], limit: 0 }, { limit: 5 }, { account_id: 'not-a-uuid' }]) {
      expect(errCode(await callTool(w.token, 'list_dialogs', args))).toBe('INVALID_INPUT');
    }
    expect(errCode(await callTool(w.token, 'get_history', { account_id: w.accountIds[0], peer: 'bad' }))).toBe('INVALID_INPUT');
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
    expect(syntheticControl.opens).toBe(0);
  });

  it('defaults are applied by the Durable Object (list_dialogs default limit 50) and a call without arguments works for list_accounts', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect((r.data.dialogs as unknown[]).length).toBe(50);
    const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_accounts' } });
    const body = (await res.json()) as { result: { isError?: boolean; structuredContent?: { accounts: unknown[] } } };
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent?.accounts).toHaveLength(1);
  });

  it('concurrent requests of different principals never share a grant', async () => {
    const a = await setupWorld({ accounts: 1 });
    const b = await setupWorld({ accounts: 2 });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => callTool((i % 2 === 0 ? a : b).token, 'list_accounts', {}))
    );
    results.forEach((r, i) => {
      const ids = (r.data.accounts as { accountId: string }[]).map((x) => x.accountId).sort();
      expect(ids).toEqual([...(i % 2 === 0 ? a : b).accountIds].sort());
    });
  });
});
