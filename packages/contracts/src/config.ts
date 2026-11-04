import { PostunError } from './errors';

/** Reads required string config; missing or empty values fail closed. */
export function requireConfig<T extends Record<string, unknown>>(env: T, ...keys: (keyof T & string)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = env[k];
    if (typeof v !== 'string' || v.trim() === '') throw new PostunError('CONFIG_MISSING');
    out[k] = v;
  }
  return out;
}

/** Security headers applied to every HTML/JSON response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  // Not 'no-referrer': with it browsers send `Origin: null` on same-origin form POSTs (Fetch spec, "append a
  // request Origin header"), which breaks the exact-Origin CSRF check on server-rendered forms. 'same-origin'
  // still sends nothing to other origins.
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export function withSecurityHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return withSecurityHeaders(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
  );
}
