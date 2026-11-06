import { fromJsonSchema, McpServer, type JsonSchemaType, type jsonSchemaValidator } from '@modelcontextprotocol/server';
import { TOOLS, TOOL_SCOPE, mcpCallPoint, writeMetric, type GrantProps, type ToolName } from '@postun/contracts';
import type { Env } from './env';
import { toolErrorResult } from './pause';
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
    annotations: ANNOTATIONS,
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: [TOOL_SCOPE[tool]] }] }
  }
}));

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
 * All 8 tools are read-only; none writes to Telegram.
 */
export function createMcpServer(env: Env, props: GrantProps): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  const call = toolCaller(env, props);
  for (const { tool, config } of TOOL_DEFS) {
    server.registerTool(tool, config, (args: unknown) => call(tool, (args ?? {}) as Record<string, unknown>));
  }
  return server;
}
