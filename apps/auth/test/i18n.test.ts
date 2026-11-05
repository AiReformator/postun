import { toBase64Url, randomToken, sha256, utf8 } from '@postun/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES, LOCALES, htmlLang, langCookie, pickLocale, t } from '../src/i18n';
import type { Locale, MessageKey } from '../src/i18n';
import { FakeVault, MCP, acceptTerms, call, cookiesFrom, installFetchMock, linkAccount, login, makeEnv, newTelegram, resetDb } from './helpers';
import type { Telegram } from './helpers';

let tg: Telegram;
beforeEach(async () => {
  await resetDb();
  tg = await newTelegram();
  installFetchMock(tg);
});
afterEach(() => vi.restoreAllMocks());

const req = (path = '/', headers: Record<string, string> = {}): Request => new Request(`https://auth.postun.org${path}`, { headers });
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe('pickLocale', () => {
  it('defaults to en', () => {
    expect(pickLocale(req())).toBe('en');
    expect(pickLocale(req('/', { 'accept-language': 'ja, ko;q=0.5' }))).toBe('en');
  });

  it('?lang= beats cookie beats Accept-Language', () => {
    const headers = { cookie: '__Host-postun_lang=de', 'accept-language': 'ru' };
    expect(pickLocale(req('/?lang=es', headers))).toBe('es');
    expect(pickLocale(req('/', headers))).toBe('de');
    expect(pickLocale(req('/', { 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8' }))).toBe('ru');
  });

  it('Accept-Language matches by base language and weight', () => {
    expect(pickLocale(req('/', { 'accept-language': 'pt-BR,pt;q=0.9' }))).toBe('pt');
    expect(pickLocale(req('/', { 'accept-language': 'fr;q=1, de;q=0.8, ru;q=0.4' }))).toBe('de');
    expect(pickLocale(req('/', { 'accept-language': 'ru;q=0, es;q=0.1' }))).toBe('es');
  });

  it('invalid ?lang= and cookie values are ignored', () => {
    expect(pickLocale(req('/?lang=fr'))).toBe('en');
    expect(pickLocale(req('/?lang=%3Cscript%3E', { cookie: '__Host-postun_lang=xx' }))).toBe('en');
    expect(pickLocale(req('/?lang=fr', { cookie: '__Host-postun_lang=ru' }))).toBe('ru');
    expect(pickLocale(req('/?lang=EN'))).toBe('en');
    expect(pickLocale(req('/', { cookie: 'postun_lang=ru' }))).toBe('en'); // only the __Host- cookie is read
  });

  it('sets the cookie only for a valid ?lang=', () => {
    expect(langCookie(req('/?lang=ru'))).toBe('__Host-postun_lang=ru; Path=/; Secure; SameSite=Lax; Max-Age=31536000');
    expect(langCookie(req('/?lang=zz'))).toBeNull();
    expect(langCookie(req('/', { 'accept-language': 'ru' }))).toBeNull();
  });
});

describe('dictionaries', () => {
  const enKeys = Object.keys(DICTIONARIES.en).sort();
  it.each(LOCALES)('%s has exactly the en keys with identical placeholders', (l: Locale) => {
    expect(Object.keys(DICTIONARIES[l]).sort()).toEqual(enKeys);
    for (const k of enKeys as MessageKey[]) expect(placeholders(DICTIONARIES[l][k]), `${l}:${k}`).toEqual(placeholders(DICTIONARIES.en[k]));
  });

  it('maps pt to pt-BR for <html lang>', () => {
    expect(htmlLang('pt')).toBe('pt-BR');
    expect(htmlLang('ru')).toBe('ru');
  });

  it('escapes variables but not dictionary markup', () => {
    const out = t('en', 'oauth.intro', { client: '<img src=x onerror=1>"\'' });
    expect(out).toContain('<strong>&#60;img src=x onerror=1&#62;&#34;&#39;</strong>');
    expect(out).not.toContain('<img');
  });
});

describe('localized pages', () => {
  it('login failure page: en by default, ru via ?lang, cookie and Accept-Language', async () => {
    const e = makeEnv();
    const def = await call(e, '/callback');
    const defText = await def.text();
    expect(defText).toContain('<html lang="en">');
    expect(defText).toContain('Sign in again');
    expect(defText).not.toContain('Войти заново');

    const q = await call(e, '/callback?lang=ru');
    expect(await q.text()).toContain('<html lang="ru">');
    expect(cookiesFrom(q)['__Host-postun_lang']).toBe('ru');

    const c = await call(e, '/callback', {}, { '__Host-postun_lang': 'ru' });
    expect(await c.text()).toContain('Войти заново');

    const a = await call(e, '/callback', { headers: { 'accept-language': 'ru-RU,ru;q=0.9' } });
    expect(await a.text()).toContain('Войти заново');
    expect(cookiesFrom(a)['__Host-postun_lang']).toBeUndefined();
  });

  it('bad ?lang= is never reflected', async () => {
    const e = makeEnv();
    const r = await call(e, '/callback?lang=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
    const text = await r.text();
    expect(text).toContain('<html lang="en">');
    expect(text).not.toContain('script>alert');
    expect(cookiesFrom(r)['__Host-postun_lang']).toBeUndefined();
  });

  it('terms page and its error follow the locale; pt renders lang pt-BR', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    const en = await (await call(e, '/terms', {}, who.jar)).text();
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Beta terms');
    expect(en).toContain('action="/terms?lang=en"');
    const ru = await (await call(e, '/terms?lang=ru', {}, who.jar)).text();
    expect(ru).toContain('<html lang="ru">');
    expect(ru).toContain('Условия беты');
    expect(ru).toContain('action="/terms?lang=ru"');
    expect(await (await call(e, '/terms?lang=pt', {}, who.jar)).text()).toContain('<html lang="pt-BR">');

    const bad = await call(
      e,
      '/terms?lang=ru',
      { method: 'POST', headers: { origin: 'https://auth.postun.org', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': who.csrf }, body: new URLSearchParams({ _csrf: who.csrf }) },
      who.jar
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Нужно принять условия');
  });

  it('closed-beta and root pages are localized', async () => {
    const closed = makeEnv({ REGISTRATION_OPEN: 'false' });
    const blocked = await login(closed, tg);
    expect(await blocked.callback.text()).toContain('Beta is closed');
    expect(await (await call(makeEnv(), '/?lang=ru')).text()).toContain('Сервис входа Postun');
    expect(await (await call(makeEnv(), '/')).text()).toContain('Postun sign-in service');
  });

  it('consent page: en default, ru by ?lang/cookie/Accept-Language, escapes client name', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    await linkAccount(e, vault, who, '1001', 'A');
    const reg = await call(e, '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: '<b>Evil</b>', redirect_uris: ['https://client.example/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] })
    });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const challenge = toBase64Url(await sha256(utf8(randomToken(48))));
    const path = `/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://client.example/cb', scope: 'accounts:read messages:read', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: MCP })}`;

    const en = await (await call(e, path, {}, who.jar)).text();
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Connect an AI client');
    expect(en).toContain('Messages and search (messages:read)');
    expect(en).toContain('&#60;b&#62;Evil&#60;/b&#62;');
    expect(en).not.toContain('<b>Evil');
    expect(en).toContain('action="/authorize?lang=en"');

    const ru = await (await call(e, `${path}&lang=ru`, {}, who.jar)).text();
    expect(ru).toContain('<html lang="ru">');
    expect(ru).toContain('Подключение ИИ-клиента');
    expect(ru).toContain('Сообщения и поиск (messages:read)');
    expect(ru).toContain('Разрешить');

    const viaCookie = await (await call(e, path, {}, { ...who.jar, '__Host-postun_lang': 'ru' })).text();
    expect(viaCookie).toContain('Разрешить');

    const viaHeader = await (await call(e, path, { headers: { 'accept-language': 'ru' } }, who.jar)).text();
    expect(viaHeader).toContain('Разрешить');
  });
});
