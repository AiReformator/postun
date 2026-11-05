import { HTTP_STATUS, jsonResponse, PostunError, toSafeError, withSecurityHeaders } from '@postun/contracts';
import type { ErrorCode } from '@postun/contracts';
import { hasKey, htmlLang, t } from './i18n';
import type { Locale } from './i18n';

/** Strict CSP for server-rendered pages: no scripts at all; inline style only (single <style> block). */
export function csp(formActions: string[] = []): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action ${["'self'", ...formActions].join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join('; ');
}

export function html(body: string, status = 200, headers: Record<string, string> = {}, formActions: string[] = []): Response {
  return withSecurityHeaders(
    new Response(body, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp(formActions), ...headers }
    })
  );
}

export function redirect(location: string, setCookies: string[] = [], status = 302): Response {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of setCookies) h.append('set-cookie', c);
  return withSecurityHeaders(new Response(null, { status, headers: h }));
}

export function apiError(code: ErrorCode, extra: Record<string, unknown> = {}): Response {
  const safe = toSafeError(new PostunError(code));
  return jsonResponse({ error: { code: safe.code, message: safe.message, ...extra } }, HTTP_STATUS[code]);
}

/** Only these codes and fixed messages leave the server. Raw errors are never logged or echoed. */
export function errorToResponse(err: unknown, wantsHtml: boolean, locale: Locale): Response {
  const safe = toSafeError(err);
  if (safe.code === 'INTERNAL') console.error('internal_error');
  if (wantsHtml) return html(errorPage(locale, safe.code), HTTP_STATUS[safe.code]);
  return jsonResponse({ error: { code: safe.code, message: safe.message } }, HTTP_STATUS[safe.code]);
}

export async function readJson(req: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new PostunError('INVALID_INPUT');
  const text = await req.text();
  if (text.length > maxBytes) throw new PostunError('INVALID_INPUT');
  try {
    const v: unknown = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
    return v as Record<string, unknown>;
  } catch {
    throw new PostunError('INVALID_INPUT');
  }
}

/** Escapes all dynamic text placed into HTML (element and quoted attribute contexts). */
export function esc(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}
h1{font-size:1.4rem}.beta{display:inline-block;background:#fde68a;color:#7c2d12;border-radius:.4rem;padding:.05rem .5rem;font-size:.8rem;font-weight:600;vertical-align:middle}
button{font:inherit;padding:.5rem 1rem;border-radius:.4rem;border:1px solid #444;background:#111;color:#fff;cursor:pointer}button.sec{background:#fff;color:#111}
label{display:block;margin:.4rem 0}.box{border:1px solid #ccc;border-radius:.5rem;padding:.75rem 1rem;margin:1rem 0}.warn{color:#9a3412}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.box{border-color:#444}button{background:#eee;color:#111}button.sec{background:#111;color:#eee}}`;

export function page(locale: Locale, title: string, inner: string): string {
  return `<!doctype html><html lang="${htmlLang(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Postun Beta</title><style>${STYLE}</style></head><body><h1>Postun <span class="beta">Beta</span></h1>${inner}</body></html>`;
}

export function errorPage(locale: Locale, code: ErrorCode, message?: string): string {
  const key = `err.${code}`;
  const text = message ?? (hasKey(key) ? t(locale, key) : t(locale, 'err.generic'));
  return page(locale, t(locale, 'err.title'), `<p class="warn">${esc(text)}</p><p>${t(locale, 'err.code', { code })}</p>`);
}
