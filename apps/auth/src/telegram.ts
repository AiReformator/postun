import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PostunError, sha256, toBase64Url, utf8 } from '@postun/contracts';
import type { Config } from './env';

/** Verified against https://core.telegram.org/bots/telegram-login and the live discovery document. */
export const TELEGRAM_OIDC = {
  issuer: 'https://oauth.telegram.org',
  authorize: 'https://oauth.telegram.org/auth',
  token: 'https://oauth.telegram.org/token',
  jwks: 'https://oauth.telegram.org/.well-known/jwks.json',
  scope: 'openid profile'
} as const;

const ALGS = ['RS256', 'ES256', 'EdDSA'];

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(utf8(verifier)));
}

export async function authorizeUrl(cfg: Config, p: { state: string; nonce: string; verifier: string }): Promise<string> {
  const u = new URL(TELEGRAM_OIDC.authorize);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', `${cfg.authIssuer}/callback`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', TELEGRAM_OIDC.scope); // never the phone scope
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', await pkceChallenge(p.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface TelegramIdentity {
  issuer: string;
  /** OIDC subject: the principal identity together with the issuer. Never assumed to equal `telegramId`. */
  subject: string;
  /** Numeric Telegram user id from the `id` claim, decimal string, only after Number.isSafeInteger. */
  telegramId: string;
}

export async function exchangeCode(cfg: Config, code: string, verifier: string): Promise<string> {
  const basic = btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`);
  let res: Response;
  try {
    res = await fetch(TELEGRAM_OIDC.token, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${cfg.authIssuer}/callback`, code_verifier: verifier })
    });
  } catch {
    throw new PostunError('UPSTREAM_UNAVAILABLE');
  }
  if (res.status >= 500) throw new PostunError('UPSTREAM_UNAVAILABLE');
  if (res.status !== 200) throw new PostunError('UNAUTHENTICATED');
  try {
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string' || body.id_token.length > 8192) throw new Error('shape');
    return body.id_token;
  } catch {
    throw new PostunError('UNAUTHENTICATED');
  }
}

function parseTelegramId(raw: unknown): string {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^[1-9][0-9]{0,15}$/.test(raw)) n = Number(raw);
  else throw new PostunError('UNAUTHENTICATED');
  if (!Number.isSafeInteger(n) || n <= 0) throw new PostunError('UNAUTHENTICATED');
  return String(n);
}

/**
 * Verifies signature (JWKS at the exact URL), exact issuer, exact audience = bot client_id, allowed algs
 * (so alg=none is rejected), exp/iat, and the nonce. Any failure -> UNAUTHENTICATED, nothing is created.
 */
export async function verifyIdToken(cfg: Config, idToken: string, expectedNonce: string): Promise<TelegramIdentity> {
  let payload;
  try {
    const jwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC.jwks), { timeoutDuration: 5000 });
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: TELEGRAM_OIDC.issuer,
      audience: cfg.clientId,
      algorithms: ALGS,
      requiredClaims: ['sub', 'iat', 'exp'],
      clockTolerance: 30,
      maxTokenAge: '15m' // also rejects an iat in the future
    }));
  } catch {
    throw new PostunError('UNAUTHENTICATED');
  }
  const nonce = payload['nonce'];
  if (nonce === undefined) {
    if (cfg.requireNonce) throw new PostunError('UNAUTHENTICATED');
  } else if (nonce !== expectedNonce) {
    throw new PostunError('UNAUTHENTICATED');
  }
  const sub = payload.sub;
  if (typeof sub !== 'string' || sub === '' || sub.length > 128) throw new PostunError('UNAUTHENTICATED');
  return { issuer: TELEGRAM_OIDC.issuer, subject: sub, telegramId: parseTelegramId(payload['id']) };
}
