/**
 * Session envelope encryption (docs/03 §3).
 * - Random 256-bit DEK per linked account.
 * - Session payload: AES-256-GCM under the DEK, 96-bit random nonce.
 * - DEK wrapped by the KEK with AES-256-GCM, its own nonce and a "dek-wrap" purpose in AAD.
 * - AAD binds principal_id, account_id, envelope_version, key_version and payload type.
 * The KEK exists only in the MCP Worker / Durable Object.
 */
import { concat, decodeSecret, fromBase64Url, randomBytes, toBase64Url, utf8 } from './encoding';

export const ENVELOPE_VERSION = 1 as const;
const NONCE_BYTES = 12;

export type PayloadType = 'telegram-session';

export interface SessionEnvelope {
  v: typeof ENVELOPE_VERSION;
  kv: string; // KEK version
  t: PayloadType;
  wn: string; // wrap nonce (b64url)
  wd: string; // wrapped DEK (b64url)
  n: string; // payload nonce
  c: string; // payload ciphertext
}

export interface EnvelopeContext {
  principalId: string;
  accountId: string;
}

export async function importAesKey(secret: string | Uint8Array<ArrayBuffer>, usage: 'kek' | 'dek'): Promise<CryptoKey> {
  const raw = typeof secret === 'string' ? decodeSecret(secret) : secret;
  if (raw.length !== 32) throw new TypeError(`${usage} must be 32 bytes`);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function aad(purpose: 'dek-wrap' | 'payload', ctx: EnvelopeContext, kv: string, t: PayloadType): Uint8Array<ArrayBuffer> {
  // Length-prefixed fields avoid ambiguity between concatenated values.
  const fields = ['postun', purpose, String(ENVELOPE_VERSION), kv, t, ctx.principalId, ctx.accountId];
  return utf8(fields.map((f) => `${f.length}:${f}`).join('|'));
}

export async function sealSession(
  plaintext: Uint8Array<ArrayBuffer>,
  ctx: EnvelopeContext,
  kek: CryptoKey,
  kekVersion: string
): Promise<SessionEnvelope> {
  const t: PayloadType = 'telegram-session';
  const dekRaw = randomBytes(32);
  const dek = await importAesKey(dekRaw, 'dek');
  const n = randomBytes(NONCE_BYTES);
  const c = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: aad('payload', ctx, kekVersion, t) }, dek, plaintext)
  );
  const wn = randomBytes(NONCE_BYTES);
  const wd = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wn, additionalData: aad('dek-wrap', ctx, kekVersion, t) }, kek, dekRaw)
  );
  dekRaw.fill(0);
  return { v: ENVELOPE_VERSION, kv: kekVersion, t, wn: toBase64Url(wn), wd: toBase64Url(wd), n: toBase64Url(n), c: toBase64Url(c) };
}

/** Decrypts an envelope; `keks` maps key version -> KEK so a bounded rotation window works. */
export async function openSession(
  env: SessionEnvelope,
  ctx: EnvelopeContext,
  keks: ReadonlyMap<string, CryptoKey>
): Promise<Uint8Array<ArrayBuffer>> {
  if (env.v !== ENVELOPE_VERSION || env.t !== 'telegram-session') throw new Error('unsupported envelope');
  const kek = keks.get(env.kv);
  if (!kek) throw new Error('unknown key version');
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(env.wn), additionalData: aad('dek-wrap', ctx, env.kv, env.t) },
      kek,
      fromBase64Url(env.wd)
    )
  );
  const dek = await importAesKey(dekRaw, 'dek');
  dekRaw.fill(0);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(env.n), additionalData: aad('payload', ctx, env.kv, env.t) },
      dek,
      fromBase64Url(env.c)
    )
  );
}

/** Re-wraps the DEK under a new KEK without touching the payload ciphertext. */
export async function rewrapSession(
  env: SessionEnvelope,
  ctx: EnvelopeContext,
  keks: ReadonlyMap<string, CryptoKey>,
  newKek: CryptoKey,
  newVersion: string
): Promise<SessionEnvelope> {
  const plaintext = await openSession(env, ctx, keks);
  try {
    return await sealSession(plaintext, ctx, newKek, newVersion);
  } finally {
    plaintext.fill(0);
  }
}

// ---------- HMAC helpers (identity index, cursors) ----------

export async function importHmacKey(secret: string): Promise<CryptoKey> {
  const raw = decodeSecret(secret);
  if (raw.length < 32) throw new TypeError('HMAC key must be at least 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmac(key: CryptoKey, ...parts: string[]): Promise<Uint8Array<ArrayBuffer>> {
  const msg = utf8(parts.map((p) => `${p.length}:${p}`).join('|'));
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
}

export async function hmacVerify(key: CryptoKey, mac: Uint8Array<ArrayBuffer>, ...parts: string[]): Promise<boolean> {
  const msg = utf8(parts.map((p) => `${p.length}:${p}`).join('|'));
  return crypto.subtle.verify('HMAC', key, mac, msg);
}

/** Index value for a Telegram user ID: HMAC with a dedicated key, never plain SHA-256. */
export async function telegramIdIndex(key: CryptoKey, telegramId: string): Promise<string> {
  return toBase64Url(await hmac(key, 'telegram-id-v1', telegramId));
}

export { concat };
