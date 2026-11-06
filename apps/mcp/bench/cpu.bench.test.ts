/**
 * In-process CPU benchmark of the Worker's MCP request path (docs/02_ARCHITECTURE.md, "Cloudflare Free fit").
 * Runs under Node (not workerd): it measures the JavaScript CPU of handleMcp (grant parse, MCP server, schema
 * validation, response) per request with a stubbed Durable Object, so absolute numbers are a proxy; compare before/after.
 * Run: npm run bench:cpu -w @postun/mcp
 */
import { describe, it } from 'vitest';
import type { Env } from '../src/env';
import { handleMcp } from '../src/mcp-handler';

const GRANT = {
  principalId: '11111111-1111-4111-8111-111111111111',
  grantId: '22222222-2222-4222-8222-222222222222',
  grantVersion: 1,
  scopes: ['accounts:read', 'dialogs:read', 'messages:read', 'channels:read', 'media:read'],
  accounts: ['33333333-3333-4333-8333-333333333333']
};

const env = {
  SESSIONS: {
    idFromName: () => ({}),
    get: () => ({ callTool: async () => ({ ok: true, json: JSON.stringify({ dialogs: [], nextCursor: null }) }) })
  }
} as unknown as Env;

function post(body: unknown): Request {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  });
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const CALL = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'list_dialogs', arguments: { account_id: GRANT.accounts[0], limit: 100 } }
};

const cpuMs = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

async function measure(body: unknown, n: number): Promise<number> {
  const t0 = cpuMs();
  for (let i = 0; i < n; i++) {
    const res = await handleMcp(post(body), env, GRANT);
    if (res.status !== 200) throw new Error(`unexpected status ${res.status}`);
    await res.text();
  }
  return (cpuMs() - t0) / n;
}

describe('worker CPU per MCP request (Node, in-process)', () => {
  it('reports CPU ms per request', async () => {
    const N = Number(process.env.BENCH_N ?? 400);
    // The very first request in a Node process pays module and lazy-loading start-up that workerd does not bill the same
    // way, so it is discarded. The next 20 of each kind approximate a young isolate (code not yet optimised).
    await handleMcp(post(LIST), env, GRANT).then((r) => r.text());
    const earlyList = await measure(LIST, 20);
    const earlyCall = await measure(CALL, 20);
    await measure(LIST, 100);
    await measure(CALL, 100);
    const list = await measure(LIST, N);
    const call = await measure(CALL, N);
    process.stdout.write(
      `\nBENCH early (requests 2-21) tools/list: ${earlyList.toFixed(3)} ms, tools/call: ${earlyCall.toFixed(3)} ms\n` +
        `BENCH tools/list  warm mean over ${N}: ${list.toFixed(3)} ms/request\n` +
        `BENCH tools/call  warm mean over ${N}: ${call.toFixed(3)} ms/request\n`
    );
  }, 120_000);
});
