import { describe, expect, it } from 'vitest';
import { decodeSecret, toBase64Url } from '../src/encoding';

describe('decodeSecret', () => {
  const raw = new Uint8Array(32).map((_, i) => i * 7);
  it('accepts base64url and standard base64 with padding', () => {
    const url = toBase64Url(raw);
    expect(decodeSecret(url)).toEqual(raw);
    const std = btoa(String.fromCharCode(...raw));
    expect(std.endsWith('=')).toBe(true);
    expect(decodeSecret(` ${std}\n`)).toEqual(raw);
  });
  it('rejects oversized input quickly instead of scanning it', () => {
    const t0 = performance.now();
    expect(() => decodeSecret('='.repeat(200_000) + 'x')).toThrow();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
