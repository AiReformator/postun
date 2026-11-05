/** Pure helpers for the file download endpoint. */

export const CHUNK_BYTES = 1024 * 1024;
export const CAPABILITY_TTL_MS = 10 * 60 * 1000;
export const MAX_TRANSFERS_PER_PRINCIPAL = 2;

export type RangeResult = { ok: true; start: number; end: number; partial: boolean } | { ok: false };

/** Single `bytes=` range only. Anything else that is not a valid satisfiable range is rejected. */
export function parseRange(header: string | null, size: number): RangeResult {
  if (size <= 0) return { ok: false };
  if (header === null || header === '') return { ok: true, start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { ok: false };
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { ok: false };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return { ok: false };
  return { ok: true, start, end, partial: true };
}

const UNSAFE_TYPES = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;

export function safeContentType(mime: string | null): string {
  if (!mime || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mime) || UNSAFE_TYPES.test(mime)) return 'application/octet-stream';
  return mime.toLowerCase();
}

/** Content-Disposition that cannot inject headers or path segments. */
export function safeDisposition(name: string | null): string {
  const base = (name ?? 'file').split(/[\\/]/).pop() ?? 'file';
  const cleaned = Array.from(base)
    .filter((c) => c.codePointAt(0)! >= 0x20 && c.codePointAt(0)! !== 0x7f)
    .slice(0, 120) // by code points, never in the middle of a surrogate pair
    .join('');
  const ascii = cleaned.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'file';
  let utf: string;
  try {
    utf = encodeURIComponent(cleaned || 'file').replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    utf = 'file'; // lone surrogate in the source name: never fail the download over a file name
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf}`;
}

export function fileHeaders(opts: { contentType: string; disposition: string; length: number; range?: { start: number; end: number; size: number } }): Headers {
  const h = new Headers({
    'content-type': opts.contentType,
    'content-disposition': opts.disposition,
    'content-length': String(opts.length),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin'
  });
  if (opts.range) h.set('content-range', `bytes ${opts.range.start}-${opts.range.end}/${opts.range.size}`);
  return h;
}
