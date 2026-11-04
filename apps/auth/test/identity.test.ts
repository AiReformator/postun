import { telegramIdIndex, importHmacKey } from '@postun/contracts';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { decryptTelegramId } from '../src/keys';
import { importAesKey } from '@postun/contracts';
import { BOT_ID, TG_ISSUER, call, claims, cookiesFrom, count, db, installFetchMock, login, makeEnv, mock, newTelegram, resetDb } from './helpers';
import type { Telegram } from './helpers';

let tg: Telegram;
beforeEach(async () => {
  await resetDb();
  tg = await newTelegram();
  installFetchMock(tg);
});
afterEach(() => vi.restoreAllMocks());

describe('ID-01 Telegram OIDC verification', () => {
  const bad: [string, () => Promise<Record<string, unknown>>][] = [
    ['wrong issuer', async () => ({ iss: 'https://evil.example' })],
    ['wrong audience', async () => ({ aud: 'other-bot' })],
    ['wrong nonce', async () => ({ nonce: 'not-the-nonce' })],
    ['expired', async () => ({ iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['iat in the future', async () => ({ iat: Math.floor(Date.now() / 1000) + 3600, exp: Math.floor(Date.now() / 1000) + 7200 })],
    ['non-safe-integer id', async () => ({ id: 2 ** 60 })],
    ['missing id', async () => ({ id: undefined })]
  ];
  for (const [name, c] of bad) {
    it(`rejects ${name} and creates no principal`, async () => {
      const e = makeEnv();
      const r = await login(e, tg, { claims: await c() });
      expect(r.callback.status).toBe(401);
      expect(cookiesFrom(r.callback)['__Host-postun_session']).toBeUndefined();
      expect(await count('principals')).toBe(0);
      expect(await count('web_sessions')).toBe(0);
    });
  }

  it('rejects an unsigned token (alg none)', async () => {
    const b64 = (o: unknown): string => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims())}.`;
    const r = await login(makeEnv(), tg, { token });
    expect(r.callback.status).toBe(401);
    expect(await count('principals')).toBe(0);
  });

  it('rejects a token signed by a different key', async () => {
    const token = await tg.sign(claims(), { key: tg.otherKey });
    const r = await login(makeEnv(), tg, { token });
    expect(r.callback.status).toBe(401);
    expect(await count('principals')).toBe(0);
  });

  it('fails closed when nonce is absent and required, accepts it only when explicitly relaxed', async () => {
    const strict = await login(makeEnv(), tg, { nonce: false });
    expect(strict.callback.status).toBe(401);
    expect(await count('principals')).toBe(0);
    const relaxed = await login(makeEnv({ TELEGRAM_OIDC_REQUIRE_NONCE: 'false' }), tg, { nonce: false });
    expect(relaxed.callback.status).toBe(302);
    expect(await count('principals')).toBe(1);
  });

  it('uses client_secret_basic, PKCE S256 and requests only openid profile', async () => {
    const start = await call(makeEnv(), '/login');
    const loc = new URL(start.headers.get('location') as string);
    expect(loc.origin + loc.pathname).toBe('https://oauth.telegram.org/auth');
    expect(loc.searchParams.get('scope')).toBe('openid profile');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('client_id')).toBe(BOT_ID);
    expect(loc.searchParams.get('redirect_uri')).toBe('https://auth.postun.org/callback');
    await login(makeEnv(), tg);
    expect(mock.tokenCalls[0]?.auth).toBe(`Basic ${btoa('test-bot-id:test-bot-secret')}`);
    expect(mock.tokenCalls[0]?.body).toContain('code_verifier=');
  });
});

describe('ID-02 identity separation', () => {
  it('keeps issuer+sub as identity and the numeric id as an HMAC index plus encrypted copy', async () => {
    const e = makeEnv();
    const r = await login(e, tg, { claims: { sub: 'opaque-sub-9', id: 777000111 } });
    expect(r.callback.status).toBe(302);
    const row = await db().prepare('SELECT * FROM principals').first<Record<string, string | number | null>>();
    expect(row?.['oidc_issuer']).toBe(TG_ISSUER);
    expect(row?.['oidc_subject']).toBe('opaque-sub-9');
    const hmacKey = await importHmacKey((env as unknown as Env).IDENTITY_INDEX_HMAC_KEY);
    expect(row?.['primary_telegram_id_hmac']).toBe(await telegramIdIndex(hmacKey, '777000111'));
    expect(JSON.stringify(row)).not.toContain('777000111');
    const aes = await importAesKey((env as unknown as Env).IDENTITY_ENCRYPTION_KEY, 'kek');
    expect(await decryptTelegramId(aes, row?.['principal_id'] as string, row?.['telegram_id_enc'] as string)).toBe('777000111');
  });

  it('logs the same sub in as the same principal even if the id claim differs', async () => {
    const e = makeEnv();
    await login(e, tg, { claims: { sub: 's1', id: 1111 } });
    await login(e, tg, { claims: { sub: 's1', id: 2222 } });
    expect(await count('principals')).toBe(1);
    await login(e, tg, { claims: { sub: 's2', id: 1111 } });
    expect(await count('principals')).toBe(2);
  });
});

describe('ID-03 login state', () => {
  async function start(e: Env): Promise<{ state: string; nonce: string; jar: Record<string, string> }> {
    const s = await call(e, '/login');
    const loc = new URL(s.headers.get('location') as string);
    return { state: loc.searchParams.get('state') as string, nonce: loc.searchParams.get('nonce') as string, jar: cookiesFrom(s) };
  }

  it('rejects a replayed callback', async () => {
    const e = makeEnv();
    const s = await start(e);
    mock.idToken = await tg.sign(claims({ nonce: s.nonce }));
    const first = await call(e, `/callback?code=c&state=${s.state}`, {}, s.jar);
    expect(first.status).toBe(302);
    const replay = await call(e, `/callback?code=c&state=${s.state}`, {}, s.jar);
    expect(replay.status).toBe(400);
    expect(cookiesFrom(replay)['__Host-postun_session']).toBeUndefined();
  });

  it('rejects an expired state', async () => {
    const e = makeEnv();
    const s = await start(e);
    await db().prepare('UPDATE login_states SET expires_at = 1').run();
    mock.idToken = await tg.sign(claims({ nonce: s.nonce }));
    const r = await call(e, `/callback?code=c&state=${s.state}`, {}, s.jar);
    expect(r.status).toBe(400);
    expect(await count('principals')).toBe(0);
  });

  it('rejects an unknown state and a state used from another browser', async () => {
    const e = makeEnv();
    const s = await start(e);
    mock.idToken = await tg.sign(claims({ nonce: s.nonce }));
    expect((await call(e, '/callback?code=c&state=nope', {}, s.jar)).status).toBe(400);
    const other = await start(e);
    // state of browser A presented with the binder cookie of browser B
    expect((await call(e, `/callback?code=c&state=${s.state}`, {}, other.jar)).status).toBe(400);
    expect(await count('principals')).toBe(0);
  });
});

describe('sessions, registration gate, config', () => {
  it('sets a hardened __Host- session cookie and stores only a hash', async () => {
    const r = await login(makeEnv(), tg);
    const header = r.callback.headers.getSetCookie().find((c) => c.startsWith('__Host-postun_session='));
    expect(header).toBeDefined();
    expect(header).toMatch(/; Path=\//);
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toMatch(/Domain=/i);
    const token = (header as string).split(';')[0]?.split('=')[1] as string;
    const rows = await db().prepare('SELECT session_hash FROM web_sessions').all<{ session_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.session_hash).not.toBe(token);
    expect(JSON.stringify(rows.results)).not.toContain(token);
    const row = await db().prepare('SELECT idle_expires_at - created_at AS idle, absolute_expires_at - created_at AS abs FROM web_sessions').first<{ idle: number; abs: number }>();
    expect(row).toEqual({ idle: 7 * 86400, abs: 30 * 86400 });
  });

  it('REGISTRATION_OPEN=false blocks new principals but not existing ones', async () => {
    const closed = makeEnv({ REGISTRATION_OPEN: 'false' });
    const blocked = await login(closed, tg);
    expect(blocked.callback.status).toBe(403);
    expect(await count('principals')).toBe(0);
    expect(await blocked.callback.text()).toContain('Beta');
    await login(makeEnv(), tg); // created while open
    const again = await login(closed, tg);
    expect(again.callback.status).toBe(302);
    expect(await count('principals')).toBe(1);
  });

  it('missing configuration returns 503 CONFIG_MISSING without defaults', async () => {
    const r = await call(makeEnv({ TELEGRAM_OIDC_CLIENT_SECRET: '' }), '/login');
    expect(r.status).toBe(503);
    const api = await call(makeEnv({ WEB_SESSION_KEY: 'short' }), '/api/session');
    expect(api.status).toBe(503);
    expect(await api.text()).toContain('CONFIG_MISSING');
  });

  it('redirects to terms before first connect and only allows in-app return targets', async () => {
    const r = await login(makeEnv(), tg, { returnTo: '/authorize?x=1' });
    expect(r.callback.headers.get('location')).toContain('/terms?return=');
    const evil = await login(makeEnv(), tg, { returnTo: 'https://evil.example/' });
    expect(evil.callback.headers.get('location')).toBe('https://auth.postun.org/terms');
  });

  it('applies a strict CSP and security headers to HTML', async () => {
    const r = await call(makeEnv({ REGISTRATION_OPEN: 'false' }), '/terms');
    expect(r.status).toBe(302);
    const page = await call(makeEnv(), '/callback');
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
  });
});
