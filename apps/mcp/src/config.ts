import {
  importAesKey, importHmacKey, maxFileBytesFromEnv, PostunError, quotaPolicyFromEnv, requireConfig, type QuotaPolicy
} from '@postun/contracts';
import type { Env } from './env';

export interface Config {
  appEnv: string;
  resource: string;
  issuer: string;
  quota: QuotaPolicy;
  maxFileBytes: number;
  channelsEnabled: boolean;
}

/** Non-secret configuration. Missing or invalid values fail closed with CONFIG_MISSING. */
export function loadConfig(env: Env): Config {
  try {
    const c = requireConfig(env as unknown as Record<string, unknown>, 'APP_ENV', 'MCP_RESOURCE', 'AUTH_ISSUER');
    const resource = new URL(c.MCP_RESOURCE as string);
    const issuer = new URL(c.AUTH_ISSUER as string);
    const local = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if ((resource.protocol !== 'https:' && !local(resource)) || (issuer.protocol !== 'https:' && !local(issuer))) {
      throw new Error('insecure url');
    }
    return {
      appEnv: c.APP_ENV as string,
      resource: resource.toString(),
      issuer: issuer.toString().replace(/\/$/, ''),
      quota: quotaPolicyFromEnv(env),
      maxFileBytes: maxFileBytesFromEnv(env),
      channelsEnabled: env.FEATURE_CHANNELS === 'on'
    };
  } catch {
    throw new PostunError('CONFIG_MISSING');
  }
}

export interface Keys {
  kek: CryptoKey;
  kekVersion: string;
  keks: Map<string, CryptoKey>;
  cursor: CryptoKey;
}

let cached: { sig: string; keys: Keys } | null = null;

/** Secrets: KEK(s) for session envelopes and the cursor HMAC key. No defaults. */
export async function loadKeys(env: Env): Promise<Keys> {
  const sig = [env.SESSION_KEK, env.SESSION_KEK_VERSION, env.SESSION_KEK_PREVIOUS, env.SESSION_KEK_PREVIOUS_VERSION, env.CURSOR_HMAC_KEY].join('\u0000');
  if (cached?.sig === sig) return cached.keys;
  try {
    const s = requireConfig(env as unknown as Record<string, unknown>, 'SESSION_KEK', 'SESSION_KEK_VERSION', 'CURSOR_HMAC_KEY');
    const kek = await importAesKey(s.SESSION_KEK as string, 'kek');
    const keks = new Map<string, CryptoKey>([[s.SESSION_KEK_VERSION as string, kek]]);
    if (env.SESSION_KEK_PREVIOUS && env.SESSION_KEK_PREVIOUS_VERSION) {
      keks.set(env.SESSION_KEK_PREVIOUS_VERSION, await importAesKey(env.SESSION_KEK_PREVIOUS, 'kek'));
    }
    const keys: Keys = { kek, kekVersion: s.SESSION_KEK_VERSION as string, keks, cursor: await importHmacKey(s.CURSOR_HMAC_KEY as string) };
    cached = { sig, keys };
    return keys;
  } catch {
    throw new PostunError('CONFIG_MISSING');
  }
}
