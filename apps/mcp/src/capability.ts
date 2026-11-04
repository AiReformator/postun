/**
 * Self-authenticating download capability: `<principalId>.<secret>.<mac>`.
 * mac = HMAC(CURSOR_HMAC_KEY, 'file-cap-v1', principalId, intentId, secret). The Worker verifies it statelessly
 * at the edge, so a request with a forged or random bearer is refused before any Durable Object is addressed
 * (no per-attacker-principal object or storage can be created). The DO still checks the secret against its
 * stored hash, expiry and the live grant on every chunk.
 */
import { fromBase64Url, hmac, timingSafeEqual, toBase64Url } from '@postun/contracts';

export const FILE_CAP_RE = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{32,64})\.([A-Za-z0-9_-]{43})$/i;

export async function signFileCapability(key: CryptoKey, principalId: string, intentId: string, secret: string): Promise<string> {
  return `${principalId}.${secret}.${toBase64Url(await hmac(key, 'file-cap-v1', principalId, intentId, secret))}`;
}

/** Returns true only when `mac` is the valid tag for exactly this principal, intent and secret. */
export async function verifyFileCapabilityMac(key: CryptoKey, principalId: string, intentId: string, secret: string, mac: string): Promise<boolean> {
  let given: Uint8Array;
  try {
    given = fromBase64Url(mac);
  } catch {
    return false;
  }
  const expected = await hmac(key, 'file-cap-v1', principalId, intentId, secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
