import { OAuthResourceServer } from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { GrantPropsSchema, HTTP_STATUS, jsonResponse, PostunError, toSafeError, withSecurityHeaders, type ErrorCode, type GrantProps } from '@postun/contracts';
import { loadConfig, type Config } from './config';
import type { Env } from './env';
import { createMcpServer } from './mcp';

export { SessionAndQuotaDO } from './do/session-do';
export { VaultControl } from './vault';

function errorResponse(code: ErrorCode, extra: Record<string, string> = {}): Response {
  const s = toSafeError(new PostunError(code));
  return jsonResponse({ error: { code: s.code, message: s.message } }, HTTP_STATUS[code], extra);
}

async function handleMcp(request: Request, env: Env, props: unknown): Promise<Response> {
  // Anything that is not a well-formed grant is refused before any DO or Telegram call (AU-01).
  const parsed = GrantPropsSchema.safeParse(props);
  if (!parsed.success) return errorResponse('FORBIDDEN');
  const grant: GrantProps = parsed.data;
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

const resourceServers = new Map<string, OAuthResourceServer<Env, GrantProps>>();

function resourceServer(cfg: Config): OAuthResourceServer<Env, GrantProps> {
  const key = `${cfg.resource}|${cfg.issuer}`;
  let s = resourceServers.get(key);
  if (!s) {
    s = new OAuthResourceServer<Env, GrantProps>({
      resourceMetadata: { resource: cfg.resource, authorization_servers: [cfg.issuer] },
      validateToken: (env) => async (resource, token) => {
        const t = await env.AUTH.validateToken(resource, token);
        if (!t) return null;
        // The host enforces audience === this resource; an array that does not contain it never matches.
        const audience = typeof t.audience === 'string' ? t.audience : t.audience.includes(resource) ? resource : (t.audience[0] ?? '');
        return { ...t, audience };
      },
      handler: { fetch: (request, env, ctx) => handleMcp(request, env, ctx.props) }
    });
    resourceServers.set(key, s);
  }
  return s;
}

/** GET /files/:intentId with `Authorization: Bearer <principalId>.<secret>`; never a query-string token. */
async function handleFile(request: Request, env: Env, intentId: string): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('INVALID_INPUT', { allow: 'GET' });
  const m = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,64})$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return errorResponse('UNAUTHENTICATED', { 'www-authenticate': 'Bearer' });
  const principalId = m[1] as string;
  const res = await env.SESSIONS.get(env.SESSIONS.idFromName(principalId)).openFile(principalId, intentId, m[2] as string, request.headers.get('range'));
  return withSecurityHeaders(res);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let cfg: Config;
    try {
      cfg = loadConfig(env);
    } catch {
      return errorResponse('CONFIG_MISSING');
    }
    const url = new URL(request.url);
    const file = /^\/files\/([A-Za-z0-9_-]{16,64})$/.exec(url.pathname);
    if (file) return handleFile(request, env, file[1] as string);
    return resourceServer(cfg).fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
