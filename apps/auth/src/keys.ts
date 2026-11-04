import { fromBase64Url, importAesKey, importHmacKey, PostunError, randomBytes, toBase64Url, utf8 } from '@postun/contracts';
import type { Config } from './env';

export interface Keys {
  identityHmac: CryptoKey;
  identityEnc: CryptoKey;
  session: CryptoKey;
}

/** Any malformed key material is a configuration error (503), never a default. */
export async function loadKeys(cfg: Config): Promise<Keys> {
  try {
    return {
      identityHmac: await importHmacKey(cfg.identityHmacKey),
      identityEnc: await importAesKey(cfg.identityEncKey, 'kek'),
      session: await importHmacKey(cfg.webSessionKey)
    };
  } catch {
    throw new PostunError('CONFIG_MISSING');
  }
}

/** AES-256-GCM, random 96-bit nonce, AAD binds the principal. Output: v1.<nonce>.<ciphertext> (base64url). */
export async function encryptTelegramId(key: CryptoKey, principalId: string, telegramId: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`postun|telegram-id|${principalId}`) }, key, utf8(telegramId))
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

export async function decryptTelegramId(key: CryptoKey, principalId: string, blob: string): Promise<string> {
  const [v, n, c] = blob.split('.');
  if (v !== 'v1' || !n || !c) throw new PostunError('INVALID_INPUT');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(n), additionalData: utf8(`postun|telegram-id|${principalId}`) },
    key,
    fromBase64Url(c)
  );
  return new TextDecoder().decode(pt);
}
