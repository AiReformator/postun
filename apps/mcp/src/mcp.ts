import { McpServer } from '@modelcontextprotocol/server';
import { TOOLS, type GrantProps, type ToolName } from '@postun/contracts';
import type { z } from 'zod';
import type { Env } from './env';
import { TOOL_DESCRIPTION, TOOL_INPUT } from './schemas';

/** One stateless MCP server per request. All 8 tools are read-only; none writes to Telegram. */
export function createMcpServer(env: Env, props: GrantProps): McpServer {
  const server = new McpServer({ name: 'postun', version: '0.1.0-beta' });
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName(props.principalId));

  const call = async (tool: ToolName, args: Record<string, unknown>) => {
    const out = await stub.callTool({
      principalId: props.principalId,
      grantId: props.grantId,
      grantVersion: props.grantVersion,
      scopes: props.scopes,
      accounts: props.accounts,
      tool,
      args
    });
    if (out.ok) {
      return { content: [{ type: 'text' as const, text: out.json }], structuredContent: JSON.parse(out.json) as Record<string, unknown> };
    }
    const error = { code: out.code, message: out.message, ...(out.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: out.retryAfterSeconds }) };
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error }) }] };
  };

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
