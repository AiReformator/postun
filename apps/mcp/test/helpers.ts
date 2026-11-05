import { env, exports } from 'cloudflare:workers';
import { toBase64Url, utf8, type GrantProps, type LinkState, type Scope } from '@postun/contracts';
import { syntheticControl } from '../src/telegram/synthetic';

export const ALL_SCOPES: Scope[] = ['accounts:read', 'dialogs:read', 'messages:read', 'channels:read', 'media:read'];
export const RESOURCE = 'https://mcp.test/mcp';

export function principalStub(principalId: string) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(principalId));
}

export function makeToken(props: unknown, audience?: string): string {
  return `tok.${toBase64Url(utf8(JSON.stringify({ props, audience })))}`;
}

export interface World {
  principalId: string;
  grantId: string;
  accountIds: string[];
  props: GrantProps;
  token: string;
}

/** Links N synthetic accounts through the real QR flow, activates them and registers one grant. */
export async function setupWorld(opts: { accounts?: number; scopes?: Scope[] } = {}): Promise<World> {
  syntheticControl.reset();
  const principalId = crypto.randomUUID();
  const stub = principalStub(principalId);
  const accountIds: string[] = [];
  for (let i = 0; i < (opts.accounts ?? 1); i++) {
    const accountId = crypto.randomUUID();
    const first = await stub.startLink(principalId, accountId);
    if (first.state !== 'waiting_scan') throw new Error(`unexpected link state ${first.state}`);
    let st: LinkState = first;
    for (let n = 0; n < 100 && st.state !== 'authorized'; n++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(principalId, accountId);
    }
    if (st.state !== 'authorized') throw new Error('link did not finish');
    await stub.activateAccount(principalId, accountId);
    accountIds.push(accountId);
  }
  const grantId = crypto.randomUUID();
  const scopes = opts.scopes ?? ALL_SCOPES;
  await stub.putGrant(principalId, { grantId, accounts: accountIds, scopes, version: 1 });
  const props: GrantProps = { principalId, grantId, accounts: accountIds, scopes, grantVersion: 1 };
  syntheticControl.opens = 0;
  syntheticControl.ops = 0;
  return { principalId, grantId, accountIds, props, token: makeToken(props) };
}

export function mcpRequest(token: string | null, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  return exports.default.fetch(new Request(RESOURCE, { method: 'POST', headers, body: JSON.stringify(body) }));
}

let rpcId = 1;
export interface ToolResult {
  isError: boolean;
  data: Record<string, unknown>;
  raw: string;
}

export async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await mcpRequest(token, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const raw = await res.text();
  if (res.status !== 200) return { isError: true, data: { httpStatus: res.status }, raw };
  const msg = JSON.parse(raw) as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
  if (!msg.result) return { isError: true, data: { rpcError: msg.error?.message ?? 'unknown' }, raw };
  const text = msg.result.content[0]?.text ?? '{}';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { text }; // SDK-level validation errors are plain text
  }
  return { isError: msg.result.isError === true, data, raw };
}

export function errCode(r: ToolResult): string | undefined {
  return (r.data.error as { code?: string } | undefined)?.code;
}

export async function fetchFile(intentId: string, capability: string | null, range?: string, query = ''): Promise<Response> {
  const headers: Record<string, string> = {};
  if (capability) headers.authorization = `Bearer ${capability}`;
  if (range) headers.range = range;
  return exports.default.fetch(new Request(`https://mcp.test/files/${intentId}${query}`, { headers }));
}

export function parseDownload(r: ToolResult): { intentId: string; capability: string; url: string } {
  const d = r.data.download as { url: string; authorization: string };
  return { intentId: new URL(d.url).pathname.split('/').pop() as string, capability: d.authorization.replace('Bearer ', ''), url: d.url };
}
