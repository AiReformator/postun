import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { HTTP_STATUS, jsonResponse, PostunError, SCOPES, toSafeError, withSecurityHeaders, type ErrorCode, type GrantProps } from '@postun/contracts';
import type { Env } from './env';
import { createMcpServer } from './mcp';

function errorResponse(code: ErrorCode): Response {
  const s = toSafeError(new PostunError(code));
  return jsonResponse({ error: { code: s.code, message: s.message } }, HTTP_STATUS[code]);
}

// Same grammar as z.uuid() (RFC 9562 versions 1-8, plus the nil and max UUIDs).
const UUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const SCOPE_SET: ReadonlySet<unknown> = new Set(SCOPES);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/**
 * Structural check equivalent to GrantPropsSchema (kept in step by a parity test) without building Zod issue objects on
 * every request. Returns a fresh object holding only the known fields, like the schema's strip behaviour, or null.
 * Anything that is not a well-formed grant is refused before any DO or Telegram call (AU-01); the Durable Object remains
 * the authority and checks the grant against its own records on every call.
 */
export function readGrantProps(props: unknown): GrantProps | null {
  if (typeof props !== 'object' || props === null) return null;
  const p = props as Record<string, unknown>;
  const { principalId, grantId, accounts, scopes, grantVersion } = p;
  if (!isUuid(principalId) || !isUuid(grantId)) return null;
  if (!Array.isArray(accounts) || accounts.length > 10 || !accounts.every(isUuid)) return null;
  if (!Array.isArray(scopes) || !scopes.every((s) => SCOPE_SET.has(s))) return null;
  if (typeof grantVersion !== 'number' || !Number.isSafeInteger(grantVersion) || grantVersion < 0) return null;
  return { principalId, grantId, accounts: [...accounts] as string[], scopes: [...scopes] as GrantProps['scopes'], grantVersion };
}

export async function handleMcp(request: Request, env: Env, props: unknown): Promise<Response> {
  const grant = readGrantProps(props);
  if (!grant) return errorResponse('FORBIDDEN');
  const server = createMcpServer(env, grant);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withSecurityHeaders(await transport.handleRequest(request), { 'cache-control': 'no-store' });
  } finally {
    ctxClose(server);
  }
}

function ctxClose(server: { close(): Promise<void> }): void {
  void server.close().catch(() => undefined);
}
