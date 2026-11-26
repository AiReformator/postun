import { fromJsonSchema, McpServer, type JsonSchemaType, type jsonSchemaValidator } from '@modelcontextprotocol/server';
import { ERROR_CODES, TOOLS, TOOL_SCOPE, mcpCallPoint, writeMetric, type ErrorCode, type GrantProps, type ToolName } from '@postun/contracts';
import { loadConfig } from './config';
import { INLINE_FILE_MAX_BYTES, safeContentType } from './files';
import { handleFileGet } from './files-route';
import type { Env } from './env';
import { toolErrorResult } from './pause';
import { DOWNLOAD_META_KEY, MCP_APP_MIME, MEDIA_TOOL_UI_META, MEDIA_WIDGET_URI, mediaWidgetHtml, mediaWidgetResourceMeta } from './widget';
import { TOOL_OUTPUT } from './output';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTION, TOOL_INPUT, TOOL_TITLE } from './schemas';

/**
 * The tools/call handler for one grant. Every call also writes one aggregate metric point (tool, outcome code,
 * duration, first-use flags; no identifiers or arguments, docs/03 "Service metrics").
 */
/** Number of items in a tool result (messages, dialogs, channels or accounts); counts only, never content. */
function itemCount(json: string): number {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    for (const k of ['messages', 'dialogs', 'channels', 'accounts']) if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
  } catch {
    /* not an object result */
  }
  return 0;
}

export function toolCaller(env: Env, props: GrantProps) {
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName(props.principalId));
  return async (tool: ToolName, args: Record<string, unknown>) => {
    const started = Date.now();
    const out = await stub.callTool({
      principalId: props.principalId,
      grantId: props.grantId,
      grantVersion: props.grantVersion,
      scopes: props.scopes,
      accounts: props.accounts,
      tool,
      args
    });
    writeMetric(
      env.METRICS,
      mcpCallPoint({
        tool,
        outcome: out.ok ? 'ok' : out.code,
        durationMs: Date.now() - started,
        firstOfDay: out.ok && out.usage?.firstOfDay === true,
        firstOfMonth: out.ok && out.usage?.firstOfMonth === true,
        reason: out.ok ? '' : out.reason ?? '',
        items: out.ok ? itemCount(out.json) : 0,
        retryAfterSeconds: out.ok ? 0 : out.retryAfterSeconds ?? 0
      })
    );
    if (out.ok) {
      return { content: [{ type: 'text' as const, text: out.json }], structuredContent: JSON.parse(out.json) as Record<string, unknown> };
    }
    return toolErrorResult(out);
  };
}

/**
 * Tool definitions built once per isolate (module scope, outside any request's CPU). `tools/list` advertises the full
 * JSON Schema of each tool, computed here once from the Zod schemas instead of on every request. The Worker does not
 * validate arguments a second time: the Durable Object is the authority and parses them against the same Zod schema
 * (parseToolArgs) before authorising, reserving quota or touching Telegram; an invalid call costs no quota.
 */
const passThrough: jsonSchemaValidator = {
  getValidator: () => (input: unknown) => ({ valid: true as const, data: input as never, errorMessage: undefined })
};

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
/** get_help only returns Postun's own static text: read-only and closed-world (it never reaches Telegram or the web). */
const HELP_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** report_problem stores one report with the operator, never anything in Telegram: it writes, but destroys nothing. */
const REPORT_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const annotationsFor = (tool: ToolName) => (tool === 'get_help' ? HELP_ANNOTATIONS : tool === 'report_problem' ? REPORT_ANNOTATIONS : ANNOTATIONS);

/**
 * Each tool also carries:
 * - outputSchema: the shape of its structuredContent (output.ts). It goes through the same pass-through validator, so
 *   the SDK never turns a successful Telegram read into an error over a schema detail; a test pins the schemas instead.
 * - _meta.securitySchemes: the OAuth scope the tool needs (OpenAI Apps SDK convention; MCP itself has no per-tool auth
 *   field). Advisory only: the Durable Object enforces TOOL_SCOPE on every call.
 */
const TOOL_DEFS = TOOLS.map((tool) => ({
  tool,
  config: {
    title: TOOL_TITLE[tool],
    description: TOOL_DESCRIPTION[tool],
    inputSchema: fromJsonSchema(TOOL_INPUT[tool]['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as JsonSchemaType, passThrough),
    outputSchema: fromJsonSchema(TOOL_OUTPUT[tool]['~standard'].jsonSchema.output({ target: 'draft-2020-12' }) as JsonSchemaType, passThrough),
    annotations: annotationsFor(tool),
    // get_media also names the card that renders its result in MCP Apps / ChatGPT (widget.ts).
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: [TOOL_SCOPE[tool]] }], ...(tool === 'get_media' ? MEDIA_TOOL_UI_META : {}) }
  }
}));

/**
 * ChatGPT tags every tool call with `openai/*` request metadata (Apps SDK: openai/locale, openai/userAgent, ...). It is a
 * hint, so it is used only to show the model LESS, never to grant anything: a client that omits it gets today's result.
 */
export function isChatGptCall(meta: unknown): boolean {
  return typeof meta === 'object' && meta !== null && Object.keys(meta).some((k) => k.startsWith('openai/'));
}

type ResourceBlock = { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } };
type ToolResult = { content: ({ type: 'text'; text: string } | ResourceBlock)[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown>; isError?: boolean };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function failure(code: ErrorCode): ToolResult {
  return toolErrorResult({ code, message: ERROR_CODES[code] });
}

/**
 * get_media_file: the Durable Object authorised the call and issued a capability exactly as for get_media (tools.ts);
 * here the Worker fetches the bytes through the same /files path (capability check, per-account lock, byte accounting)
 * and returns them as an MCP embedded resource with their SHA-256. The capability never leaves the server: the result
 * has no link and no bearer. Bounded by INLINE_FILE_MAX_BYTES before (tools.ts) and while reading.
 */
export async function inlineFile(env: Env, r: ToolResult): Promise<ToolResult> {
  const sc = r.structuredContent;
  const d = sc?.download as Record<string, unknown> | undefined;
  const media = (sc?.media ?? {}) as Record<string, unknown>;
  if (r.isError || !sc || !d || typeof d.url !== 'string' || typeof d.authorization !== 'string') return r;
  const intentId = new URL(d.url).pathname.split('/').pop() ?? '';
  const res = await handleFileGet(new Request(d.url, { headers: { authorization: d.authorization } }), env, intentId);
  if (!res.ok || !res.body) {
    let code: ErrorCode = 'UPSTREAM_UNAVAILABLE';
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body.error?.code && body.error.code in ERROR_CODES) code = body.error.code as ErrorCode;
    } catch {
      /* keep the generic code */
    }
    return failure(code);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INLINE_FILE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return failure('FILE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const expected = typeof media.size === 'number' ? media.size : null;
  if (size === 0 || (expected !== null && size !== expected)) return failure('UPSTREAM_UNAVAILABLE');
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
  const kind = typeof media.kind === 'string' ? media.kind : 'file';
  const name = typeof media.fileName === 'string' && media.fileName ? media.fileName.slice(0, 200) : `telegram-${kind}`;
  const mimeType = safeContentType(typeof media.mimeType === 'string' ? media.mimeType : null);
  const uri = `postun://file/${intentId}/${encodeURIComponent(name)}`;
  const { download: _d, ...rest } = sc;
  const structuredContent = {
    ...rest,
    file: { name, mimeType, size, sha256, uri },
    note: 'The original file is embedded in this result as a resource (same uri). Pass it on as a file, for example to save it to Google Drive; check a saved copy against sha256.'
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }, { type: 'resource', resource: { uri, mimeType, blob: base64(bytes) } }],
    structuredContent
  };
}

/**
 * In ChatGPT the get_media card fetches the file, so the download capability goes only to the card (result `_meta`,
 * which ChatGPT hands to the component and hides from the model). The model keeps the file metadata and the URL but
 * not the bearer, so it cannot pass the capability on to another tool or plugin.
 */
export function cardOnlyCapability(r: ToolResult): ToolResult {
  const sc = r.structuredContent;
  const d = sc?.download as Record<string, unknown> | undefined;
  if (r.isError || !sc || !d || typeof d.authorization !== 'string') return r;
  const { authorization, ...rest } = d;
  const download = {
    ...rest,
    note: 'In this chat only the Postun card holds the download capability and fetches the file for the user (Attach to chat / Save to ChatGPT files / Download). Do not try to download the URL yourself or with another tool.'
  };
  const structuredContent = { ...sc, download };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    _meta: { [DOWNLOAD_META_KEY]: { url: d.url, authorization, expiresAt: d.expiresAt } }
  };
}

/** Origin of this MCP server: the only place the card may send a capability to. */
function serverOrigin(env: Env): string | null {
  try {
    return new URL(loadConfig(env).resource).origin;
  } catch {
    return null;
  }
}

/**
 * What clients show for the server itself (MCP Implementation: title, description, website, icons). A client that
 * supports server icons can show the Postun logo even when the user left the icon field of the connector empty.
 */
export const SERVER_INFO = {
  name: 'postun',
  title: 'Postun Telegram',
  version: '0.1.0-beta',
  description: 'Read-only access to your own Telegram chats, channels and messages for AI assistants.',
  websiteUrl: 'https://postun.org',
  icons: [
    { src: 'https://postun.org/assets/postun-icon-256.png', mimeType: 'image/png', sizes: ['256x256'] },
    { src: 'https://postun.org/assets/favicon.svg', mimeType: 'image/svg+xml', sizes: ['any'] }
  ]
};

/**
 * One MCP server per request. The SDK binds a server instance to a single transport (a per-request transport in
 * stateless mode) and its factory contract is one instance per request, so an instance is not shared between concurrent
 * requests; instead everything expensive (schemas, JSON Schema, descriptions) is cached above and registration is cheap.
 * No tool writes to Telegram: eight read it, get_help answers from static text and report_problem stores one support report.
 */
export function createMcpServer(env: Env, props: GrantProps): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  const call = toolCaller(env, props);
  for (const { tool, config } of TOOL_DEFS) {
    server.registerTool(tool, config, async (args: unknown, ctx?: { mcpReq?: { _meta?: unknown } }) => {
      const r = (await call(tool, (args ?? {}) as Record<string, unknown>)) as ToolResult;
      if (tool === 'get_media_file') return inlineFile(env, r);
      return tool === 'get_media' && isChatGptCall(ctx?.mcpReq?._meta) ? cardOnlyCapability(r) : r;
    });
  }
  const origin = serverOrigin(env);
  // Without a valid resource URL the card has no origin to pin and is not offered (fail closed; tools still work).
  if (origin) {
    const meta = mediaWidgetResourceMeta(origin);
    server.registerResource(
      'postun-media-card',
      MEDIA_WIDGET_URI,
      { title: 'Postun file card', description: 'Attach or download one Telegram file', mimeType: MCP_APP_MIME, _meta: meta },
      (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: mediaWidgetHtml(origin), _meta: meta }] })
    );
  }
  return server;
}
