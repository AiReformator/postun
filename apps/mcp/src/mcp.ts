import { McpServer } from '@modelcontextprotocol/server';
import { TOOLS, mcpCallPoint, writeMetric, type GrantProps, type ToolName } from '@postun/contracts';
import type { z } from 'zod';
import type { Env } from './env';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTION, TOOL_INPUT } from './schemas';

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
    const error = {
      code: out.code,
      message: out.message,
      ...(out.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: out.retryAfterSeconds }),
      ...(out.reason === undefined ? {} : { reason: out.reason }),
      ...(out.hint === undefined ? {} : { hint: out.hint })
    };
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error }) }] };
  };
}

/** One stateless MCP server per request. All 8 tools are read-only; none writes to Telegram. */
export function createMcpServer(env: Env, props: GrantProps): McpServer {
  const server = new McpServer({ name: 'postun', version: '0.1.0-beta' }, { instructions: SERVER_INSTRUCTIONS });
  const call = toolCaller(env, props);

  for (const tool of TOOLS) {
    server.registerTool(
      tool,
      {
        title: tool,
        description: TOOL_DESCRIPTION[tool],
        inputSchema: TOOL_INPUT[tool] as unknown as z.ZodObject<z.ZodRawShape>,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
      },
      // Arguments were validated against the same schema by the SDK; the DO validates them again.
      (args: unknown) => call(tool, args as Record<string, unknown>)
    );
  }
  return server;
}
