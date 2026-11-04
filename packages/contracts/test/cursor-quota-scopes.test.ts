import { describe, expect, it } from 'vitest';
import {
  decodeCursor, encodeCursor, hasScope, importHmacKey, maxFileBytesFromEnv, normalizeScopes, quotaPolicyFromEnv,
  randomBytes, retainedMonths, toBase64Url, toSafeError, PostunError, utcMonth, isTelegramId, hostCookie
} from '../src';

const binding = { principalId: 'p1', accountId: 'a1', tool: 'get_history', scope: 'peer:42' };

describe('cursor', () => {
  it('round-trips for the same binding', async () => {
    const key = await importHmacKey(toBase64Url(randomBytes(32)));
    const c = await encodeCursor(key, binding, 'offset-100');
    expect(await decodeCursor(key, binding, c)).toBe('offset-100');
  });
  it('rejects replay against another account, principal or dialog (AU-02)', async () => {
    const key = await importHmacKey(toBase64Url(randomBytes(32)));
    const c = await encodeCursor(key, binding, 'o');
    await expect(decodeCursor(key, { ...binding, accountId: 'a2' }, c)).rejects.toBeInstanceOf(PostunError);
    await expect(decodeCursor(key, { ...binding, principalId: 'p2' }, c)).rejects.toBeInstanceOf(PostunError);
    await expect(decodeCursor(key, { ...binding, scope: 'peer:43' }, c)).rejects.toBeInstanceOf(PostunError);
  });
  it('rejects tampered and expired cursors', async () => {
    const key = await importHmacKey(toBase64Url(randomBytes(32)));
    const c = await encodeCursor(key, binding, 'o', 0);
    await expect(decodeCursor(key, binding, c)).rejects.toBeInstanceOf(PostunError);
    const fresh = await encodeCursor(key, binding, 'o');
    await expect(decodeCursor(key, binding, fresh.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')))).rejects.toBeInstanceOf(PostunError);
    await expect(decodeCursor(key, binding, 'garbage')).rejects.toBeInstanceOf(PostunError);
  });
});

describe('scopes', () => {
  it('drops unknown scopes and never adds write scopes', () => {
    expect(normalizeScopes(['messages:read', 'messages:write', 'admin', 'accounts:read', 'messages:read'])).toEqual(['accounts:read', 'messages:read']);
  });
  it('maps tools to scopes', () => {
    expect(hasScope(['messages:read'], 'get_history')).toBe(true);
    expect(hasScope(['messages:read'], 'get_media')).toBe(false);
  });
});

describe('quota config', () => {
  it('fails closed when the success limit is missing', () => {
    expect(() => quotaPolicyFromEnv({})).toThrow();
    expect(quotaPolicyFromEnv({ BETA_MONTHLY_SUCCESS_LIMIT: '100' }).monthlySuccessLimit).toBe(100);
  });
  it('caps file size at the product ceiling and disables when unset', () => {
    expect(maxFileBytesFromEnv({})).toBe(0);
    expect(maxFileBytesFromEnv({ MAX_FILE_BYTES: '999999999999' })).toBe(512_000_000);
  });
  it('computes UTC months', () => {
    expect(utcMonth(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01');
    expect(retainedMonths(new Date('2026-01-15T00:00:00Z'))).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});

describe('misc', () => {
  it('maps unknown errors to INTERNAL without leaking details', () => {
    const safe = toSafeError(new Error('AUTH_KEY_UNREGISTERED secret-token-xyz'));
    expect(safe).toEqual({ code: 'INTERNAL', message: 'Internal error' });
  });
  it('validates telegram ids as decimal strings', () => {
    expect(isTelegramId('9007199254740993')).toBe(true);
    expect(isTelegramId(Number('9007199254740993'))).toBe(false);
    expect(isTelegramId('01')).toBe(false);
  });
  it('enforces __Host- cookies', () => {
    expect(() => hostCookie('sid', 'x', { maxAge: 1 })).toThrow();
    expect(hostCookie('__Host-sid', 'x', { maxAge: 60 })).toBe('__Host-sid=x; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60');
  });
});
