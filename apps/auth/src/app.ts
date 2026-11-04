import { jsonResponse, withSecurityHeaders } from '@postun/contracts';
import { handleApi, handleLogout } from './api';
import { loadConfig } from './env';
import type { Config, Env } from './env';
import { errorToResponse, html, page } from './http';
import { loadKeys } from './keys';
import { handleCallback, handleLogin, handleTermsGet, handleTermsPost } from './login';
import { handleAuthorize, oauthServer } from './oauth';

/** Credentialed CORS for the exact cabinet origin only; never a wildcard. */
function cors(cfg: Config, req: Request, res: Response): Response {
  if (req.headers.get('origin') !== cfg.appOrigin) return res;
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', cfg.appOrigin);
  r.headers.set('access-control-allow-credentials', 'true');
  r.headers.append('vary', 'Origin');
  return r;
}

function preflight(cfg: Config, req: Request): Response {
  if (req.headers.get('origin') !== cfg.appOrigin) return withSecurityHeaders(new Response(null, { status: 403 }));
  return withSecurityHeaders(
    new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': cfg.appOrigin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-csrf-token',
        'access-control-max-age': '600',
        vary: 'Origin'
      }
    })
  );
}

const HTML_PATHS = new Set(['/login', '/callback', '/terms', '/authorize']);

export async function handleRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === '/healthz') return jsonResponse({ ok: true, service: 'postun-auth' });
  const wantsHtml = HTML_PATHS.has(path);
  let cfg: Config | undefined;
  try {
    cfg = loadConfig(env);
    await loadKeys(cfg); // malformed key material is a configuration error too (503)
    const c = cfg;
    if (path.startsWith('/api/') || path === '/logout') {
      if (req.method === 'OPTIONS') return preflight(c, req);
      const res = path === '/logout' ? (req.method === 'POST' ? await handleLogout(env, c, req) : new Response(null, { status: 405 })) : await handleApi(env, c, req, url);
      return cors(c, req, res);
    }
    if (path === '/login' && req.method === 'GET') return await handleLogin(env, c, url);
    if (path === '/callback' && req.method === 'GET') return await handleCallback(env, c, req, url);
    if (path === '/terms') {
      if (req.method === 'GET') return await handleTermsGet(env, c, req, url);
      if (req.method === 'POST') return await handleTermsPost(env, c, req);
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    }
    if (path === '/authorize') return await handleAuthorize(env, c, req, url);
    if (path === '/' && req.method === 'GET') {
      return html(page('Вход', `<p>Сервис входа Postun (бета). Перейдите в <a href="${c.appOrigin}">кабинет</a>.</p>`));
    }
    // Everything else (metadata, /oauth/register, /oauth/token) belongs to the OAuth library.
    return await oauthServer(c).fetch(req, env, ctx);
  } catch (err) {
    const res = errorToResponse(err, wantsHtml);
    return cfg && (path.startsWith('/api/') || path === '/logout') ? cors(cfg, req, res) : res;
  }
}
