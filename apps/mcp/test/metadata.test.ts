import { TOOLS, TOOL_SCOPE } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { SERVER_INFO } from '../src/mcp';
import { TOOL_OUTPUT } from '../src/output';
import { SERVER_INSTRUCTIONS, TOOL_TITLE } from '../src/schemas';
import { callTool, mcpRequest, setupWorld } from './helpers';

interface ListedTool {
  name: string;
  title: string;
  description: string;
  outputSchema?: { type: string; properties: Record<string, unknown> };
  _meta?: { securitySchemes?: { type: string; scopes: string[] }[] };
}

async function listTools(): Promise<ListedTool[]> {
  const w = await setupWorld();
  const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return ((await res.json()) as { result: { tools: ListedTool[] } }).result.tools;
}

describe('ChatGPT plugin metadata', () => {
  it('every tool has a human-readable title, an object outputSchema and its OAuth scope', async () => {
    for (const t of await listTools()) {
      const name = t.name as keyof typeof TOOL_TITLE;
      expect(t.title).toBe(TOOL_TITLE[name]);
      expect(t.title).not.toContain('_');
      expect(t.outputSchema?.type).toBe('object');
      expect(t._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: [TOOL_SCOPE[name]] }]);
      expect(t.description.length).toBeGreaterThan(80);
    }
  });

  it('initialize advertises the server title, website and icons', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    const body = await res.text();
    const msg = JSON.parse(body.startsWith('{') ? body : (body.split('\n').find((l) => l.startsWith('data:')) ?? 'data: {}').slice(5)) as {
      result: { serverInfo: typeof SERVER_INFO };
    };
    expect(msg.result.serverInfo).toMatchObject({ name: 'postun', title: 'Postun Telegram', websiteUrl: 'https://postun.org' });
    expect(msg.result.serverInfo.icons[0]).toEqual({ src: 'https://postun.org/assets/postun-icon-256.png', mimeType: 'image/png', sizes: ['256x256'] });
  });

  it('the key rules sit in the first 512 characters of the instructions', () => {
    const head = SERVER_INSTRUCTIONS.slice(0, 512);
    for (const rule of ['read-only', 'list_accounts', 'nextCursor', 'status "paused"', 'never a refusal', 'untrusted data']) expect(head).toContain(rule);
  });

  it('every successful result matches its declared output schema', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const peer = ((await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 1 })).data.dialogs as { peerId: string }[])[0]!.peerId;
    const channel = ((await callTool(w.token, 'search_channels', { account_id: acc, query: 'news' })).data.channels as { peerId: string }[])[0]!.peerId;
    const calls: Record<(typeof TOOLS)[number], Record<string, unknown>> = {
      list_accounts: {},
      list_dialogs: { account_id: acc, limit: 3 },
      get_history: { account_id: acc, peer, limit: 3 },
      search_messages: { account_id: acc, query: 'synth-msg', peer, limit: 3 },
      search_channels: { account_id: acc, query: 'news' },
      get_channel_posts: { account_id: acc, channel, limit: 3 },
      get_media_info: { account_id: acc, peer: 'c:1000:7', message_id: 10 },
      get_media: { account_id: acc, peer: 'c:1000:7', message_id: 10 }
    };
    for (const tool of TOOLS) {
      const r = await callTool(w.token, tool, calls[tool]);
      expect(r.isError, `${tool}: ${r.raw}`).toBe(false);
      const parsed = TOOL_OUTPUT[tool].safeParse(r.data);
      expect(parsed.success, `${tool}: ${parsed.error?.message}`).toBe(true);
      if (tool !== 'list_accounts') expect(r.data.limits, tool).toBeDefined();
    }
  });
});
