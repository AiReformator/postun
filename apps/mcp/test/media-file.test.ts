import { describe, expect, it } from 'vitest';
import { INLINE_FILE_MAX_BYTES } from '../src/files';
import { mcpRequest, principalStub, setupWorld, withVars } from './helpers';

const PEER = 'c:1000:7';
const expectedByte = (i: number) => (i * 31 + 7) & 0xff;

type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } };
type Call = { status: number; isError: boolean; content: Block[]; structured: Record<string, unknown>; raw: string };

async function getFile(token: string, accountId: string, messageId: number, meta?: Record<string, unknown>): Promise<Call> {
  const res = await mcpRequest(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_media_file', arguments: { account_id: accountId, peer: PEER, message_id: messageId }, ...(meta ? { _meta: meta } : {}) }
  });
  const raw = await res.text();
  const msg = JSON.parse(raw) as { result: { isError?: boolean; content: Block[]; structuredContent?: Record<string, unknown> } };
  return { status: res.status, isError: msg.result.isError === true, content: msg.result.content, structured: msg.result.structuredContent ?? {}, raw };
}

function decode(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('get_media_file: small files as an embedded resource', () => {
  it('returns the original bytes as a resource with name, type, size and SHA-256, and no link or capability', async () => {
    const w = await setupWorld();
    const r = await getFile(w.token, w.accountIds[0]!, 10, { 'openai/locale': 'ru' });
    expect(r.isError, r.raw.slice(0, 300)).toBe(false);
    const res = r.content.find((c) => c.type === 'resource')!;
    expect(res.resource!.mimeType).toBe('application/octet-stream');
    const bytes = decode(res.resource!.blob);
    expect(bytes.length).toBe(2_500_000);
    expect(bytes[0]).toBe(expectedByte(0));
    expect(bytes[2_499_999]).toBe(expectedByte(2_499_999));
    const file = r.structured.file as Record<string, unknown>;
    expect(file).toMatchObject({ name: 'SYNTH-FILE-10.bin', mimeType: 'application/octet-stream', size: 2_500_000, uri: res.resource!.uri });
    expect(file.sha256).toBe(await hex(bytes));
    // The capability never leaves the server: no link, no bearer, no files URL in what the model sees.
    expect(r.structured.download).toBeUndefined();
    const visible = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('') + JSON.stringify(r.structured);
    expect(visible).not.toMatch(/Bearer|\/files\/|authorization/i);
    // One operation, bytes accounted exactly once, transfer closed.
    const usage = await principalStub(w.principalId).getUsage(w.principalId);
    expect(usage.successCount).toBe(1);
    expect(usage.outBytes).toBe(2_500_000);
    // The transfer slot is released: more calls than MAX_TRANSFERS_PER_PRINCIPAL in a row still succeed.
    for (let i = 0; i < 3; i++) expect((await getFile(w.token, w.accountIds[0]!, 30)).isError).toBe(false);
  });

  it('a file above the inline bound is refused before any byte, with a hint to use get_media', async () => {
    const w = await setupWorld();
    expect(11_000_000).toBeGreaterThan(INLINE_FILE_MAX_BYTES);
    const r = await withVars(w, { MAX_FILE_BYTES: '20000000' }, () => getFile(w.token, w.accountIds[0]!, 40));
    expect(r.isError).toBe(true);
    expect(r.raw).toContain('FILE_TOO_LARGE');
    expect(r.raw).toContain('get_media');
    const usage = await principalStub(w.principalId).getUsage(w.principalId);
    expect(usage.outBytes).toBe(0);
  });

  it('a file above the server maximum is refused as for get_media', async () => {
    const w = await setupWorld();
    const r = await getFile(w.token, w.accountIds[0]!, 20);
    expect(r.isError).toBe(true);
    expect(r.raw).toContain('FILE_TOO_LARGE');
  });

  it('a message without an attachment returns NOT_FOUND', async () => {
    const w = await setupWorld();
    const r = await getFile(w.token, w.accountIds[0]!, 11);
    expect(r.isError).toBe(true);
    expect(r.raw).toContain('NOT_FOUND');
  });
});

describe('get_media_file is listed for the model', () => {
  it('needs media:read and has no card template', async () => {
    const w = await setupWorld();
    const res = await mcpRequest(w.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = ((await res.json()) as { result: { tools: { name: string; _meta?: Record<string, unknown>; description: string }[] } }).result.tools;
    const t = tools.find((x) => x.name === 'get_media_file')!;
    expect(t._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['media:read'] }]);
    expect(t._meta?.['openai/outputTemplate']).toBeUndefined();
    expect(t.description).toContain('10 MB');
  });
});

