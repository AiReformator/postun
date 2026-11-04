import { PostunError, requireConfig } from '@postun/contracts';
import type { VaultControlRpc } from '@postun/contracts';

export interface Env {
  OAUTH_KV: KVNamespace;
  CONTROL_DB: D1Database;
  VAULT: VaultControlRpc;
  APP_ENV: string;
  AUTH_ISSUER: string;
  APP_ORIGIN: string;
  PUBLIC_SITE_URL: string;
  MCP_RESOURCE: string;
  REGISTRATION_OPEN: string;
  TELEGRAM_OIDC_REQUIRE_NONCE: string;
  BETA_TERMS_VERSION: string;
  SESSION_IDLE_SECONDS?: string;
  SESSION_ABSOLUTE_SECONDS?: string;
  // secrets
  TELEGRAM_OIDC_CLIENT_ID: string;
  TELEGRAM_OIDC_CLIENT_SECRET: string;
  IDENTITY_INDEX_HMAC_KEY: string;
  IDENTITY_ENCRYPTION_KEY: string;
  WEB_SESSION_KEY: string;
}

export interface Config {
  authIssuer: string;
  appOrigin: string;
  publicSiteUrl: string;
  mcpResource: string;
  registrationOpen: boolean;
  requireNonce: boolean;
  termsVersion: string;
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
  clientId: string;
  clientSecret: string;
  identityHmacKey: string;
  identityEncKey: string;
  webSessionKey: string;
}

const DAY = 86_400;

function origin(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) {
    throw new PostunError('CONFIG_MISSING');
  }
  return u.origin;
}

function seconds(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 60) throw new PostunError('CONFIG_MISSING');
  return n;
}

/** Fails closed with CONFIG_MISSING (503): every required var and secret must be present; there are no defaults. */
export function loadConfig(env: Env): Config {
  const c = requireConfig(
    env as unknown as Record<string, unknown>,
    'AUTH_ISSUER',
    'APP_ORIGIN',
    'PUBLIC_SITE_URL',
    'MCP_RESOURCE',
    'REGISTRATION_OPEN',
    'TELEGRAM_OIDC_REQUIRE_NONCE',
    'BETA_TERMS_VERSION',
    'TELEGRAM_OIDC_CLIENT_ID',
    'TELEGRAM_OIDC_CLIENT_SECRET',
    'IDENTITY_INDEX_HMAC_KEY',
    'IDENTITY_ENCRYPTION_KEY',
    'WEB_SESSION_KEY'
  ) as Record<string, string>;
  const g = (k: string): string => c[k] as string;
  try {
    return {
      authIssuer: origin(g('AUTH_ISSUER')),
      appOrigin: origin(g('APP_ORIGIN')),
      publicSiteUrl: origin(g('PUBLIC_SITE_URL')),
      mcpResource: g('MCP_RESOURCE'),
      registrationOpen: g('REGISTRATION_OPEN') === 'true',
      requireNonce: g('TELEGRAM_OIDC_REQUIRE_NONCE') !== 'false',
      termsVersion: g('BETA_TERMS_VERSION'),
      sessionIdleSeconds: seconds(env.SESSION_IDLE_SECONDS, 7 * DAY),
      sessionAbsoluteSeconds: seconds(env.SESSION_ABSOLUTE_SECONDS, 30 * DAY),
      clientId: g('TELEGRAM_OIDC_CLIENT_ID'),
      clientSecret: g('TELEGRAM_OIDC_CLIENT_SECRET'),
      identityHmacKey: g('IDENTITY_INDEX_HMAC_KEY'),
      identityEncKey: g('IDENTITY_ENCRYPTION_KEY'),
      webSessionKey: g('WEB_SESSION_KEY')
    };
  } catch (err) {
    if (err instanceof PostunError) throw err;
    throw new PostunError('CONFIG_MISSING');
  }
}

export const now = (): number => Math.floor(Date.now() / 1000);
