import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTINUE_KEY, CONTINUE_TTL_MS, continueFromHash, continueStore, continueUrl, safeContinue } from '../src/continue.mjs';

const vectors = JSON.parse(readFileSync(new URL('../../../packages/contracts/test-vectors/return-targets.json', import.meta.url), 'utf8'));

class MemStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

describe('continue target (AI client sign-in handed to the cabinet)', () => {
  it('safeContinue agrees with the shared vectors used by the auth Worker', () => {
    for (const v of vectors.accept) expect(safeContinue(v), v).toBe(v);
    for (const v of vectors.reject) expect(safeContinue(v), JSON.stringify(v)).toBeNull();
    expect(safeContinue(`/authorize?${'a'.repeat(vectors.rejectLong - 11)}`)).toBeNull();
    expect(safeContinue(undefined)).toBeNull();
    expect(safeContinue(42)).toBeNull();
  });

  it('reads only #continue=, decodes exactly once, and rejects anything else', () => {
    const path = vectors.accept[1];
    expect(continueFromHash(`#continue=${encodeURIComponent(path)}`)).toBe(path);
    expect(continueFromHash(`#continue=${encodeURIComponent(encodeURIComponent('//evil.example'))}`)).toBeNull();
    expect(continueFromHash(`#continue=${encodeURIComponent('https://evil.example/authorize')}`)).toBeNull();
    expect(continueFromHash('#continue=%E0%A4%A')).toBeNull();
    expect(continueFromHash('#other=x')).toBeNull();
    expect(continueFromHash('')).toBeNull();
  });

  it('stores per tab with a 30-minute lifetime and validates again on every read', () => {
    let t = 1_000_000;
    const st = new MemStorage();
    const c = continueStore(st, () => t);
    c.save('/authorize?a=1');
    expect(c.load()).toBe('/authorize?a=1');
    t += CONTINUE_TTL_MS + 1;
    expect(c.load()).toBeNull();
    expect(st.getItem(CONTINUE_KEY)).toBeNull();
    c.save('//evil.example');
    expect(st.getItem(CONTINUE_KEY)).toBeNull();
    st.setItem(CONTINUE_KEY, JSON.stringify({ t: 'https://evil.example/', at: t }));
    expect(c.load()).toBeNull();
    st.setItem(CONTINUE_KEY, '{not json');
    expect(c.load()).toBeNull();
    c.save('/authorize');
    c.clear();
    expect(c.load()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const c = continueStore(throwing);
    expect(() => c.save('/authorize')).not.toThrow();
    expect(c.load()).toBeNull();
    expect(() => c.clear()).not.toThrow();
  });

  it('builds the resume URL from the page auth origin only', () => {
    expect(continueUrl('https://auth.postun.org', '/authorize?a=1')).toBe('https://auth.postun.org/authorize?a=1');
    expect(continueUrl('https://auth.postun.org/some/path', '/authorize')).toBe('https://auth.postun.org/authorize');
    expect(continueUrl('https://auth.postun.org', '//evil.example/authorize')).toBeNull();
    expect(continueUrl('not a url', '/authorize')).toBeNull();
    expect(continueUrl('https://auth.postun.org', null)).toBeNull();
  });
});
