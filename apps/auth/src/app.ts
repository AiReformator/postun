import { jsonResponse, oauthStepPoint, withSecurityHeaders, writeMetric } from '@postun/contracts';
import type { OauthStep } from '@postun/contracts';
import { handleApi, handleLogout } from './api';
import { loadConfig } from './env';
import type { Config, Env } from './env';
import { errorToResponse, html, page } from './http';
import { langCookie, pickLocale, t } from './i18n';
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

/** Which oauth_step a POST to the library's endpoints is. Reads only grant_type from a clone; nothing is kept. */
async function oauthEndpointStep(path: string, req: Request): Promise<OauthStep | null> {
  if (path === '/oauth/register') return 'register';
  if (path !== '/oauth/token') return null;
  // Only small form bodies are looked at; anything else is counted as token_other without reading it.
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  const length = Number(req.headers.get('content-length') ?? '0');
  if (!type.startsWith('application/x-www-form-urlencoded') || !(length <= 8192)) return 'token_other';
  try {
    const grantType = new URLSearchParams(await req.clone().text()).get('grant_type');
    return grantType === 'authorization_code' ? 'token_code' : grantType === 'refresh_token' ? 'token_refresh' : 'token_other';
  } catch {
    return 'token_other';
  }
}

/** 'ok' for a 2xx, otherwise the RFC 6749 error code of the JSON body (oauthStepPoint drops anything unexpected). */
async function oauthOutcome(res: Response): Promise<string> {
  if (res.ok) return 'ok';
  if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('json')) return `http_${res.status}`;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

export async function handleRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === '/healthz') return jsonResponse({ ok: true, service: 'postun-auth' });
  const wantsHtml = HTML_PATHS.has(path);
  const locale = pickLocale(req);
  const remember = langCookie(req);
  const tagged = (r: Response): Response => {
    if (remember) r.headers.append('set-cookie', remember);
    return r;
  };
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
    if (path === '/login' && req.method === 'GET') return tagged(await handleLogin(env, c, url));
    if (path === '/callback' && req.method === 'GET') return tagged(await handleCallback(env, c, req, url, locale));
    if (path === '/terms') {
      if (req.method === 'GET') return tagged(await handleTermsGet(env, c, req, url, locale));
      if (req.method === 'POST') return tagged(await handleTermsPost(env, c, req, locale));
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    }
    if (path === '/authorize') return tagged(await handleAuthorize(env, c, req, url, locale));
    if (path === '/' && req.method === 'GET') {
      return tagged(html(page(locale, t(locale, 'login.title'), `<p>${t(locale, 'root.text', { url: c.appOrigin })}</p>`)));
    }
    // Everything else (metadata, /oauth/register, /oauth/token) belongs to the OAuth library.
    const step = req.method === 'POST' ? await oauthEndpointStep(path, req) : null;
    const res = await oauthServer(c).fetch(req, env, ctx);
    if (step) writeMetric(env.METRICS, oauthStepPoint(step, await oauthOutcome(res)));
    return res;
  } catch (err) {
    const res = errorToResponse(err, wantsHtml, locale);
    if (wantsHtml) tagged(res);
    return cfg && (path.startsWith('/api/') || path === '/logout') ? cors(cfg, req, res) : res;
  }
}
