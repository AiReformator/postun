/**
 * GET /files/:intentId: the capability check and the hand-over to the Durable Object that streams the file from Telegram.
 * Used by the public endpoint (index.ts) and, in-process, by get_media_file (mcp.ts), so both share one path for
 * authorisation, locking, byte accounting and limits.
 */
import { HTTP_STATUS, jsonResponse, PostunError, toSafeError, withSecurityHeaders, type ErrorCode } from '@postun/contracts';
import { FILE_CAP_RE, verifyFileCapabilityMac } from './capability';
import { loadKeys } from './config';
import type { Env } from './env';

export function errorResponse(code: ErrorCode, extra: Record<string, string> = {}): Response {
  const s = toSafeError(new PostunError(code));
  return jsonResponse({ error: { code: s.code, message: s.message } }, HTTP_STATUS[code], extra);
}

/** GET /files/:intentId with `Authorization: Bearer <principalId>.<secret>.<mac>`; never a query-string token. */
export async function handleFileGet(request: Request, env: Env, intentId: string): Promise<Response> {
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
