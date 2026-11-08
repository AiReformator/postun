import { OAuthResourceServer } from '@cloudflare/workers-oauth-provider';
import { HTTP_STATUS, jsonResponse, PostunError, toSafeError, withSecurityHeaders, type ErrorCode, type GrantProps } from '@postun/contracts';
import { FILE_CAP_RE, verifyFileCapabilityMac } from './capability';
import { loadConfig, loadKeys, type Config } from './config';
import type { Env } from './env';
import { handleMcp } from './mcp-handler';

export { SessionAndQuotaDO } from './do/session-do';
export { VaultControl } from './vault';

function errorResponse(code: ErrorCode, extra: Record<string, string> = {}): Response {
  const s = toSafeError(new PostunError(code));
  return jsonResponse({ error: { code: s.code, message: s.message } }, HTTP_STATUS[code], extra);
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

/**
 * CORS for the download endpoint, so the get_media card (widget.ts), which runs in the AI client's sandboxed iframe
 * on another origin, can read the file. Any origin is allowed because the endpoint is authorised only by the bearer
 * capability in the Authorization header: no cookies or ambient credentials exist (credentials are never allowed),
 * so a page without the capability gets nothing, and a holder of the capability could fetch it from anywhere anyway.
 */
const FILE_CORS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length, content-range, content-type, content-disposition, accept-ranges, retry-after'
};

function withFileCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(FILE_CORS)) r.headers.set(k, v);
  return r;
}

/** Preflight for GET with Authorization and Range. Answers before any key or Durable Object is touched. */
function filePreflight(): Response {
  return withSecurityHeaders(
    new Response(null, {
      status: 204,
      headers: {
        ...FILE_CORS,
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'authorization, range',
        'access-control-max-age': '600',
        'cache-control': 'no-store'
      }
    })
  );
}

/** GET /files/:intentId with `Authorization: Bearer <principalId>.<secret>.<mac>`; never a query-string token. */
async function handleFile(request: Request, env: Env, intentId: string): Promise<Response> {
  if (request.method === 'OPTIONS') return filePreflight();
  return withFileCors(await handleFileGet(request, env, intentId));
}

async function handleFileGet(request: Request, env: Env, intentId: string): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('INVALID_INPUT', { allow: 'GET' });
  const m = FILE_CAP_RE.exec(request.headers.get('authorization') ?? '');
  if (!m) return errorResponse('UNAUTHENTICATED', { 'www-authenticate': 'Bearer' });
  const principalId = m[1] as string;
  // Stateless proof before any Durable Object is addressed: a forged bearer must not instantiate an object per principal.
  let valid: boolean;
  try {
    valid = await verifyFileCapabilityMac((await loadKeys(env)).cursor, principalId, intentId, m[2] as string, m[3] as string);
  } catch {
    return errorResponse('CONFIG_MISSING');
  }
  if (!valid) return errorResponse('UNAUTHENTICATED', { 'www-authenticate': 'Bearer' });
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
