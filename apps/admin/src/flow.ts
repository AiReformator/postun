import { timingSafeEqual, utf8 } from '@postun/contracts';
import { open, seal } from './session';

/** Lifetime of the pre-login flow cookie; also the validity window enforced INSIDE the ciphertext. */
export const FLOW_TTL_MS = 10 * 60_000;
/** Distinct AAD: a flow blob can never be decrypted as a refresh token (AAD = session id hash) or vice versa. */
const FLOW_AAD = 'admin-login-flow-v1';

export interface FlowParams {
  state: string;
  nonce: string;
  verifier: string;
}

/** Encrypts state/nonce/verifier with an issued-at and expiry into one AES-GCM blob (integrity-protected by the tag). */
export const sealFlow = (key: CryptoKey, p: FlowParams, now: number): Promise<string> =>
  seal(key, JSON.stringify({ v: 1, s: p.state, n: p.nonce, c: p.verifier, iat: now, exp: now + FLOW_TTL_MS }), FLOW_AAD);

/** Returns the flow parameters, or null when the blob is malformed, tampered, expired or from the future. */
export async function openFlow(key: CryptoKey, blob: string, now: number): Promise<FlowParams | null> {
  if (blob.length > 1024) return null;
  try {
    const v: unknown = JSON.parse(await open(key, blob, FLOW_AAD));
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.v !== 1 || typeof o.s !== 'string' || typeof o.n !== 'string' || typeof o.c !== 'string' || typeof o.iat !== 'number' || typeof o.exp !== 'number') return null;
    if (o.exp <= now || o.iat > now + 60_000 || o.exp - o.iat > FLOW_TTL_MS) return null;
    return { state: o.s, nonce: o.n, verifier: o.c };
  } catch {
    return null;
  }
}

/** Constant-time state comparison (the lengths of both are public: fixed-size random values). */
export const stateMatches = (a: string, b: string): boolean => timingSafeEqual(utf8(a), utf8(b));
