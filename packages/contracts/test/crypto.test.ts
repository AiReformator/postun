import { describe, expect, it } from 'vitest';
import { importAesKey, importHmacKey, openSession, rewrapSession, sealSession, telegramIdIndex, randomBytes, toBase64Url, utf8, fromUtf8 } from '../src';

const kekSecret = () => toBase64Url(randomBytes(32));
const ctx = { principalId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222' };

describe('session envelope', () => {
  it('round-trips and never contains plaintext', async () => {
    const kek = await importAesKey(kekSecret(), 'kek');
    const marker = 'SYNTHETIC_SESSION_MARKER_7f3a';
    const env = await sealSession(utf8(marker), ctx, kek, 'k1');
    expect(JSON.stringify(env)).not.toContain(marker);
    const out = await openSession(env, ctx, new Map([['k1', kek]]));
    expect(fromUtf8(out)).toBe(marker);
  });

  it('rejects envelope moved to another account or principal (AAD binding)', async () => {
    const kek = await importAesKey(kekSecret(), 'kek');
    const env = await sealSession(utf8('s'), ctx, kek, 'k1');
    const keks = new Map([['k1', kek]]);
    await expect(openSession(env, { ...ctx, accountId: '33333333-3333-4333-8333-333333333333' }, keks)).rejects.toThrow();
    await expect(openSession(env, { ...ctx, principalId: '44444444-4444-4444-8444-444444444444' }, keks)).rejects.toThrow();
  });

  it('rejects tampered key version and unknown KEK', async () => {
    const kek = await importAesKey(kekSecret(), 'kek');
    const other = await importAesKey(kekSecret(), 'kek');
    const env = await sealSession(utf8('s'), ctx, kek, 'k1');
    await expect(openSession({ ...env, kv: 'k2' }, ctx, new Map([['k2', kek]]))).rejects.toThrow();
    await expect(openSession(env, ctx, new Map([['k1', other]]))).rejects.toThrow();
    await expect(openSession(env, ctx, new Map())).rejects.toThrow('unknown key version');
  });

  it('uses fresh nonces for every seal', async () => {
    const kek = await importAesKey(kekSecret(), 'kek');
    const a = await sealSession(utf8('s'), ctx, kek, 'k1');
    const b = await sealSession(utf8('s'), ctx, kek, 'k1');
    expect(a.n).not.toBe(b.n);
    expect(a.wn).not.toBe(b.wn);
    expect(a.c).not.toBe(b.c);
  });

  it('rewraps under a new KEK version', async () => {
    const k1 = await importAesKey(kekSecret(), 'kek');
    const k2 = await importAesKey(kekSecret(), 'kek');
    const env = await sealSession(utf8('payload'), ctx, k1, 'k1');
    const re = await rewrapSession(env, ctx, new Map([['k1', k1]]), k2, 'k2');
    expect(re.kv).toBe('k2');
    expect(fromUtf8(await openSession(re, ctx, new Map([['k2', k2]])))).toBe('payload');
  });

  it('rejects short keys', async () => {
    await expect(importAesKey(toBase64Url(randomBytes(16)), 'kek')).rejects.toThrow();
    await expect(importHmacKey(toBase64Url(randomBytes(8)))).rejects.toThrow();
  });
});

describe('telegram id index', () => {
  it('is keyed and stable', async () => {
    const k1 = await importHmacKey(toBase64Url(randomBytes(32)));
    const k2 = await importHmacKey(toBase64Url(randomBytes(32)));
    const a = await telegramIdIndex(k1, '123456789012');
    expect(a).toBe(await telegramIdIndex(k1, '123456789012'));
    expect(a).not.toBe(await telegramIdIndex(k2, '123456789012'));
    expect(a).not.toContain('123456789012');
  });
});
