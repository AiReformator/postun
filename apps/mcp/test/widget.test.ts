import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MCP_APP_MIME, MEDIA_WIDGET_URI } from '../src/widget';
import { callTool, fetchFile, mcpRequest, parseDownload, setupWorld } from './helpers';

const PEER = 'c:1000:7';
const BIG_OK = 10;

type ToolEntry = { name: string; _meta?: Record<string, unknown> };

describe('get_media card (MCP Apps / ChatGPT UI)', () => {
  it('only get_media names the card template, in both the standard and the ChatGPT key', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = ((await res.json()) as { result: { tools: ToolEntry[] } }).result.tools;
    for (const t of tools) {
      const meta = t._meta ?? {};
      if (t.name === 'get_media') {
        expect(meta.ui).toEqual({ resourceUri: MEDIA_WIDGET_URI });
        expect(meta['openai/outputTemplate']).toBe(MEDIA_WIDGET_URI);
        expect(meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['media:read'] }]);
      } else {
        expect(meta.ui).toBeUndefined();
        expect(meta['openai/outputTemplate']).toBeUndefined();
      }
    }
  });

  it('lists and serves the card as an MCP App whose only connect domain is this server', async () => {
    const w = await setupWorld();
    const list = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const resources = ((await list.json()) as { result: { resources: { uri: string; mimeType: string }[] } }).result.resources;
    expect(resources).toContainEqual(expect.objectContaining({ uri: MEDIA_WIDGET_URI, mimeType: MCP_APP_MIME }));

    const read = await mcpRequest(w.token, { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: MEDIA_WIDGET_URI } });
    const contents = ((await read.json()) as { result: { contents: { uri: string; mimeType: string; text: string; _meta: Record<string, unknown> }[] } }).result.contents;
    expect(contents).toHaveLength(1);
    const c = contents[0]!;
    expect(c.mimeType).toBe(MCP_APP_MIME);
    expect(c._meta.ui).toMatchObject({ csp: { connectDomains: ['https://mcp.test'], resourceDomains: [] } });
    expect(c._meta['openai/widgetCSP']).toEqual({ connect_domains: ['https://mcp.test'], resource_domains: [] });
    // The capability may only go to the pinned origin; the page loads nothing from elsewhere.
    expect(c.text).toContain('const ORIGIN = "https://mcp.test"');
    expect(c.text).not.toMatch(/\s(src|href)=["']?https?:/i);
    expect(c.text.match(/<\/script/gi)).toHaveLength(1);
  });

  it('resources/read of the card needs the same OAuth token as tools', async () => {
    const res = await mcpRequest(null, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: MEDIA_WIDGET_URI } });
    expect(res.status).toBe(401);
  });
});

describe('download endpoint CORS (for the card in a sandboxed iframe)', () => {
  it('answers the preflight for GET with Authorization and Range, without credentials', async () => {
    const res = await exports.default.fetch(
      new Request('https://mcp.test/files/AAAAAAAAAAAAAAAAAAAAAA', {
        method: 'OPTIONS',
        headers: { origin: 'https://card.sandbox.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization, range' }
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization, range');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('a download and a refused download are both readable cross-origin; the capability still decides', async () => {
    const w = await setupWorld();
    const d = parseDownload(await callTool(w.token, 'get_media', { account_id: w.accountIds[0], peer: PEER, message_id: BIG_OK }));
    const ok = await fetchFile(d.intentId, d.capability, 'bytes=0-9');
    expect(ok.status).toBe(206);
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    expect(ok.headers.get('access-control-expose-headers')).toContain('content-range');
    expect((await ok.arrayBuffer()).byteLength).toBe(10);

    const denied = await fetchFile(d.intentId, null);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('access-control-allow-origin')).toBe('*');
    await denied.arrayBuffer();
  });

  it('other methods are still refused', async () => {
    const res = await exports.default.fetch(new Request('https://mcp.test/files/AAAAAAAAAAAAAAAAAAAAAA', { method: 'POST' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('allow')).toBe('GET');
  });
});

describe('get_media in ChatGPT: the download capability goes only to the card', () => {
  type CallResult = { result: { content: { text: string }[]; structuredContent: { download: Record<string, unknown> }; _meta?: Record<string, { url: string; authorization: string }> } };
  const call = async (token: string, accountId: string, meta?: Record<string, unknown>) => {
    const res = await mcpRequest(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_media', arguments: { account_id: accountId, peer: PEER, message_id: BIG_OK }, ...(meta ? { _meta: meta } : {}) }
    });
    return ((await res.json()) as CallResult).result;
  };

  it('a call tagged with openai/* metadata keeps the bearer out of everything the model sees', async () => {
    const w = await setupWorld();
    const r = await call(w.token, w.accountIds[0]!, { 'openai/userAgent': 'synthetic', 'openai/locale': 'ru-RU' });
    expect(r.structuredContent.download.authorization).toBeUndefined();
    expect(r.structuredContent.download.url).toMatch(/^https:\/\/mcp\.test\/files\//);
    expect(r.content[0]!.text).not.toMatch(/Bearer/);
    const forCard = r._meta?.['postun/download'];
    expect(forCard?.authorization).toMatch(/^Bearer /);
    expect(forCard?.url).toBe(r.structuredContent.download.url);
    // The capability in _meta still works for the card.
    const intentId = new URL(forCard!.url).pathname.split('/').pop()!;
    const res = await fetchFile(intentId, forCard!.authorization.replace('Bearer ', ''), 'bytes=0-3');
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it('other clients (no openai/* metadata) still get the capability in the result', async () => {
    const w = await setupWorld();
    const r = await call(w.token, w.accountIds[0]!);
    expect(r.structuredContent.download.authorization).toMatch(/^Bearer /);
    expect(r._meta?.['postun/download']).toBeUndefined();
  });
});
