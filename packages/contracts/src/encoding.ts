const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => enc.encode(s) as Uint8Array<ArrayBuffer>;
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new TypeError('invalid base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Reject non-canonical encodings (non-zero padding bits) so one value has exactly one string form.
  if (toBase64Url(out) !== s) throw new TypeError('non-canonical base64url');
  return out;
}

/** Accepts standard base64 or base64url secrets. */
export function decodeSecret(s: string): Uint8Array<ArrayBuffer> {
  const t = s.trim();
  if (t.length > 1024) throw new TypeError('secret too long');
  // Strip trailing '=' padding with a linear scan (a /=+$/ regex is polynomial on long '=' runs).
  let end = t.length;
  while (end > 0 && t.charCodeAt(end - 1) === 61) end--;
  return fromBase64Url(t.slice(0, end).replace(/\+/g, '-').replace(/\//g, '_'));
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Constant-time comparison for equal-length secrets. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function sha256(data: Uint8Array<ArrayBuffer> | string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
