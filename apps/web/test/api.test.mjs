import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api.mjs';
import { LOCALES } from '../i18n/index.mjs';

const { Response } = globalThis;

const make = (locale, fetchImpl) => {
  const S = LOCALES.find((l) => l.code === locale).dict.app;
  return { S, api: createApi({ base: 'https://auth.example.org', locale, t: (k) => S[k], linkErrors: S.linkErrors, csrf: () => 'tok', fetchImpl }) };
};
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('cabinet API client', () => {
  it('replaces the browser network error with the localized message in every locale', async () => {
    for (const l of LOCALES) {
      const { S, api } = make(l.code, async () => {
        throw new TypeError('Failed to fetch');
      });
      const err = await api('/api/session').catch((e) => e);
      expect(err.message, l.code).toBe(S.networkError);
      expect(err.message).not.toMatch(/fetch/i);
      expect(err.network).toBe(true);
      // No code, so the QR-link poller keeps treating it as transient.
      expect(err.code).toBeUndefined();
    }
  });

  it('shows Russian server messages only in Russian and localized known codes elsewhere', async () => {
    const body = { error: { code: 'EXPIRED', message: 'Серверный текст', reason: 'x' } };
    const ru = await make('ru', reply(400, body)).api('/a').catch((e) => e);
    expect(ru.message).toBe('Серверный текст');
    const en = make('en', reply(400, body));
    const e = await en.api('/a').catch((x) => x);
    expect(e.message).toBe(en.S.linkErrors.EXPIRED);
    expect(e.code).toBe('EXPIRED');
    expect(e.reason).toBe('x');
  });

  it('falls back to the generic request error for unknown codes and non-JSON bodies', async () => {
    const de = make('de', async () => new Response('<html>', { status: 502 }));
    const err = await de.api('/a').catch((e) => e);
    expect(err.message).toBe(de.S.requestError);
    expect(err.network).toBeUndefined();
  });

  it('sends JSON with the CSRF token on writes and credentials on every call', async () => {
    const calls = [];
    const { api } = make('en', async (url, init) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    });
    expect(await api('/api/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: true });
    await api('/api/y');
    expect(calls[0].url).toBe('https://auth.example.org/api/x');
    expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'include', body: '{"a":1}' });
    expect(calls[0].init.headers).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 'tok' });
    expect(calls[1].init.headers).toEqual({});
    expect(calls[1].init.credentials).toBe('include');
  });
});
