import { toBase64Url, randomToken, sha256, utf8 } from '@postun/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/env';
import type { Env } from '../src/env';
import { formActionFor, oauthServer } from '../src/oauth';
import { APP, ISSUER, MCP, FakeVault, acceptTerms, call, cookiesFrom, count, db, get, installFetchMock, linkAccount, login, makeEnv, newTelegram, post, resetDb } from './helpers';
import type { LoggedIn, Telegram } from './helpers';

let tg: Telegram;
beforeEach(async () => {
  await resetDb();
  tg = await newTelegram();
  installFetchMock(tg);
});
afterEach(() => vi.restoreAllMocks());

const REDIRECT = 'https://client.example/cb';

async function register(e: Env, name = 'Test Client'): Promise<string> {
  const r = await call(e, '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  return { verifier, challenge: toBase64Url(await sha256(utf8(verifier))) };
}

function authorizePath(clientId: string, challenge: string, scope = 'accounts:read messages:read offline_access'): string {
  return `/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 'st-1', code_challenge: challenge, code_challenge_method: 'S256', resource: MCP })}`;
}

function field(htmlText: string, name: string): string {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(htmlText);
  return m?.[1] ?? '';
}

interface Consent {
  res: Response;
  text: string;
  jar: Record<string, string>;
  handle: string;
  csrf: string;
  offered: string;
  offeredSig: string;
}

async function openConsent(e: Env, who: LoggedIn, path: string): Promise<Consent> {
  const res = await call(e, path, {}, who.jar);
  const text = await res.text();
  return { res, text, jar: { ...who.jar, ...cookiesFrom(res) }, handle: field(text, 'handle'), csrf: field(text, '_csrf'), offered: field(text, 'offered'), offeredSig: field(text, 'offered_sig') };
}

function submit(e: Env, c: Consent, accounts: string[], scopes: string[], decision = 'approve'): Promise<Response> {
  const body = new URLSearchParams({ handle: c.handle, _csrf: c.csrf, decision, offered: c.offered, offered_sig: c.offeredSig });
  for (const a of accounts) body.append('account', a);
  for (const s of scopes) body.append('scope', s);
  return call(e, '/authorize', { method: 'POST', headers: { origin: ISSUER, 'content-type': 'application/x-www-form-urlencoded' }, body }, c.jar);
}

async function exchange(e: Env, clientId: string, code: string, verifier: string): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
  const r = await call(e, '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: MCP })
  });
  expect(r.status).toBe(200);
  return (await r.json()) as { access_token: string; refresh_token?: string; scope?: string };
}

/** Complete MCP OAuth flow: returns the access token and the grant id. */
async function connectClient(e: Env, who: LoggedIn, accounts: string[], scopes = ['accounts:read', 'messages:read'], name = 'Test Client') {
  const clientId = await register(e, name);
  const { verifier, challenge } = await pkce();
  const consent = await openConsent(e, who, authorizePath(clientId, challenge));
  expect(consent.res.status).toBe(200);
  const done = await submit(e, consent, accounts, scopes);
  expect(done.status).toBe(302);
  const loc = new URL(done.headers.get('location') as string);
  expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
  expect(loc.searchParams.get('state')).toBe('st-1');
  const tokens = await exchange(e, clientId, loc.searchParams.get('code') as string, verifier);
  const row = await db().prepare("SELECT grant_id FROM grant_reference WHERE client_id = ?1 AND status = 'active'").bind(clientId).first<{ grant_id: string }>();
  return { clientId, tokens, grantId: row?.grant_id as string };
}

const validate = (e: Env, token: string): ReturnType<ReturnType<typeof oauthServer>['validateToken']> => oauthServer(loadConfig(e)).validateToken(MCP, token, e);

type Point = { indexes?: string[]; blobs?: (string | null)[]; doubles?: number[] };
const stepsOf = (points: Point[]): string[] => points.filter((p) => p.indexes?.[0] === 'oauth_step').map((p) => `${p.blobs?.[1]}:${p.blobs?.[2]}`);

async function setup(vault = new FakeVault(), points?: Point[]): Promise<{ e: Env; vault: FakeVault; who: LoggedIn; accA: string }> {
  const e = makeEnv(points ? { METRICS: { writeDataPoint: (p) => void points.push(p) } } : {}, vault);
  const who = await login(e, tg);
  await acceptTerms(e, who);
  const accA = await linkAccount(e, vault, who, '1001', 'A');
  return { e, vault, who, accA };
}

describe('MCP OAuth', () => {
  it('publishes issuer metadata with offline_access and our scopes', async () => {
    const e = makeEnv();
    const meta = (await (await call(e, '/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(meta['issuer']).toBe(ISSUER);
    expect(meta['registration_endpoint']).toBe(`${ISSUER}/oauth/register`);
    expect(meta['token_endpoint']).toBe(`${ISSUER}/oauth/token`);
    expect(meta['scopes_supported']).toEqual(expect.arrayContaining(['accounts:read', 'media:read', 'offline_access']));
  });

  it('requires login: unauthenticated /authorize redirects to /login with a return target', async () => {
    const e = makeEnv();
    const clientId = await register(e);
    const { challenge } = await pkce();
    const r = await call(e, authorizePath(clientId, challenge));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^https:\/\/auth\.postun\.org\/login\?return=%2Fauthorize/);
  });

  it('runs the full flow and stores opaque grant props (accounts, scopes, version)', async () => {
    const { e, vault, who, accA } = await setup();
    const { tokens, grantId } = await connectClient(e, who, [accA]);
    const v = await validate(e, tokens.access_token);
    expect(v?.props).toEqual({ principalId: expect.any(String), grantId, accounts: [accA], scopes: ['accounts:read', 'messages:read'], grantVersion: 1 });
    expect(v?.scope).toEqual(expect.arrayContaining(['accounts:read', 'messages:read']));
    expect(vault.grants.get(grantId)).toEqual({ grantId, accounts: [accA], scopes: ['accounts:read', 'messages:read'], version: 1 });
    expect(tokens.refresh_token).toBeTruthy();
    // wrong resource -> not valid for this token
    expect(await oauthServer(loadConfig(e)).validateToken(MCP, 'garbage', e)).toBeNull();
  });

  it('exposes validateToken through the default WorkerEntrypoint (RPC used by postun-mcp)', async () => {
    const { e, who, accA } = await setup();
    const { tokens } = await connectClient(e, who, [accA]);
    const { default: AuthServer } = await import('../src/index');
    const inst = new AuthServer({} as ExecutionContext, e);
    const v = await inst.validateToken(MCP, tokens.access_token);
    expect(v?.props.accounts).toEqual([accA]);
    expect(await inst.validateToken(MCP, 'nope')).toBeNull();
  });

  it('AU-03: an account linked after the grant is never added to the old grant', async () => {
    const { e, vault, who, accA } = await setup();
    const { tokens, grantId } = await connectClient(e, who, [accA]);
    const accB = await linkAccount(e, vault, who, '2002', 'B');
    const v = await validate(e, tokens.access_token);
    const props = v?.props as { accounts: string[] };
    expect(props.accounts).toEqual([accA]);
    expect(props.accounts).not.toContain(accB);
    const row = await db().prepare('SELECT accounts_json, version FROM grant_reference WHERE grant_id = ?1').bind(grantId).first<{ accounts_json: string; version: number }>();
    expect(JSON.parse(row?.accounts_json as string)).toEqual([accA]);
    expect(row?.version).toBe(1);
    expect(vault.grants.get(grantId)?.accounts).toEqual([accA]);
  });

  it('AU-04: revoke writes the vault deny state BEFORE the library revokes tokens', async () => {
    const { e, vault, who, accA } = await setup();
    const { tokens, grantId } = await connectClient(e, who, [accA]);
    let tokenValidAtDeny: boolean | undefined;
    vault.hooks['denyGrant'] = async () => {
      tokenValidAtDeny = (await validate(e, tokens.access_token)) !== null;
    };
    const r = await post(e, `/api/grants/${grantId}/revoke`, {}, who);
    expect(r.status).toBe(200);
    expect(vault.calls.filter((c) => c.startsWith('denyGrant'))).toEqual([`denyGrant:${grantId}`]);
    expect(tokenValidAtDeny).toBe(true); // library still held the grant when deny was recorded
    expect(await validate(e, tokens.access_token)).toBeNull(); // and revoked afterwards
    const row = await db().prepare('SELECT status FROM grant_reference WHERE grant_id = ?1').bind(grantId).first<{ status: string }>();
    expect(row?.status).toBe('revoked');
    const list = (await (await get(e, '/api/grants', who)).json()) as { grants: unknown[] };
    expect(list.grants).toEqual([]);
  });

  it('AU-04: if the deny write fails nothing else is revoked', async () => {
    const { e, vault, who, accA } = await setup();
    const { tokens, grantId } = await connectClient(e, who, [accA]);
    vault.failOn.add('denyGrant');
    const r = await post(e, `/api/grants/${grantId}/revoke`, {}, who);
    expect(r.status).toBe(503);
    expect(await validate(e, tokens.access_token)).not.toBeNull();
    const row = await db().prepare('SELECT status FROM grant_reference WHERE grant_id = ?1').bind(grantId).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });

  it('lists grants for the cabinet and does not let another principal revoke them', async () => {
    const { e, who, accA } = await setup();
    const { grantId } = await connectClient(e, who, [accA], ['accounts:read'], 'Мой клиент');
    const list = (await (await get(e, '/api/grants', who)).json()) as { grants: { grantId: string; clientName: string; accounts: string[]; scopes: string[] }[] };
    expect(list.grants).toEqual([expect.objectContaining({ grantId, clientName: 'Мой клиент', accounts: [accA], scopes: ['accounts:read'] })]);
    const other = await login(e, tg, { claims: { sub: 'other', id: 9 } });
    expect((await post(e, `/api/grants/${grantId}/revoke`, {}, other)).status).toBe(404);
  });

  it('does not expire a fresh grant_reference whose library grant is not written yet (grace window)', async () => {
    const { e, who, accA } = await setup();
    const pid = (await db().prepare('SELECT principal_id FROM principals').first<{ principal_id: string }>())?.principal_id as string;
    const t = Math.floor(Date.now() / 1000);
    const ins = (id: string, created: number) =>
      db().prepare("INSERT INTO grant_reference (grant_id, principal_id, client_id, accounts_json, scopes_json, version, status, created_at, updated_at) VALUES (?1, ?2, 'cX', ?3, '[\"accounts:read\"]', 1, 'active', ?4, ?4)").bind(id, pid, JSON.stringify([accA]), created).run();
    await ins('fresh-grant', t);
    await ins('old-grant', t - 3600);
    const list = (await (await get(e, '/api/grants', who)).json()) as { grants: unknown[] };
    expect(list.grants).toEqual([]); // neither has a library grant, so neither is shown
    const st = async (id: string) => (await db().prepare('SELECT status FROM grant_reference WHERE grant_id = ?1').bind(id).first<{ status: string }>())?.status;
    expect(await st('fresh-grant')).toBe('active'); // still revocable / replaceable
    expect(await st('old-grant')).toBe('expired');
  });

  it('expired rows are still shrunk on disconnect, denied on client replacement, and re-activated when the library grant exists', async () => {
    const { e, vault, who, accA } = await setup();
    const { grantId, clientId } = await connectClient(e, who, [accA]);
    const pid = (await db().prepare('SELECT principal_id FROM principals').first<{ principal_id: string }>())?.principal_id as string;
    const setStatus = (status: string) => db().prepare('UPDATE grant_reference SET status = ?2 WHERE grant_id = ?1').bind(grantId, status).run();
    const status = async () => (await db().prepare('SELECT status FROM grant_reference WHERE grant_id = ?1').bind(grantId).first<{ status: string }>())?.status;

    // library grant exists -> an erroneously expired row comes back
    await setStatus('expired');
    const list = (await (await get(e, '/api/grants', who)).json()) as { grants: { grantId: string }[] };
    expect(list.grants.map((g) => g.grantId)).toEqual([grantId]);
    expect(await status()).toBe('active');

    // expired row is still found for per-client replacement and for disconnect
    await setStatus('expired');
    const { activeGrantIdsForClient } = await import('../src/grants');
    expect(await activeGrantIdsForClient(e, pid, clientId)).toEqual([grantId]);
    vault.calls.length = 0;
    expect((await post(e, `/api/accounts/${accA}/disconnect`, {}, who)).status).toBe(200);
    expect(vault.calls).toContain(`putGrant:${grantId}@2`); // the expired row was still shrunk before the vault disconnect
  });

  it('rejects an authorization POST without CSRF or with a foreign Origin, and a handle is single use', async () => {
    const points: Point[] = [];
    const { e, who, accA } = await setup(new FakeVault(), points);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const consent = await openConsent(e, who, authorizePath(clientId, challenge));
    const noCsrf = await call(e, '/authorize', { method: 'POST', headers: { origin: ISSUER, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle: consent.handle, decision: 'approve', account: accA, scope: 'accounts:read' }) }, consent.jar);
    expect(noCsrf.status).toBe(403);
    const foreign = await call(e, '/authorize', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle: consent.handle, _csrf: consent.csrf, decision: 'approve', account: accA, scope: 'accounts:read' }) }, consent.jar);
    expect(foreign.status).toBe(403);
    expect(await count('grant_reference')).toBe(0);
    expect((await submit(e, consent, [accA], ['accounts:read'])).status).toBe(302);
    // A replay of the consent handle never issues a second code; after an approval it explains instead of failing.
    const again = await submit(e, consent, [accA], ['accounts:read']);
    expect(again.status).toBe(200);
    expect(again.headers.get('location')).toBeNull();
    expect(await again.text()).toContain('already allowed this connection');
    expect(await count('grant_reference')).toBe(1);
    expect(stepsOf(points)).toEqual(['register:ok', 'consent_shown:ok', 'consent_approved:ok', 'consent_repeat:ok']);
    // Deny after Allow does not pretend the deny worked: it gets the generic page, not the repeat page.
    const deny = await submit(e, consent, [accA], ['accounts:read'], 'deny');
    expect(deny.status).toBe(400);
    expect(await deny.text()).not.toContain('already allowed this connection');
  });

  it('records each connection step as an anonymous oauth_step metric', async () => {
    const points: Point[] = [];
    const vault = new FakeVault();
    const e = makeEnv({ METRICS: { writeDataPoint: (p) => void points.push(p) } }, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const accA = await linkAccount(e, vault, who, '1001', 'A');
    const { clientId, tokens } = await connectClient(e, who, [accA]);
    const bad = await call(e, '/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'nope', client_id: clientId })
    });
    expect(bad.status).toBe(400);
    expect(stepsOf(points)).toEqual(['register:ok', 'consent_shown:ok', 'consent_approved:ok', 'token_code:ok', 'token_refresh:invalid_grant']);
    const serialized = JSON.stringify(points);
    for (const secret of [clientId, tokens.access_token, accA, 'client.example', 'Test Client']) expect(serialized).not.toContain(secret);
  });

  it('a consent handle that was never approved shows the stale page, not the repeat page', async () => {
    const points: Point[] = [];
    const { e, who, accA } = await setup(new FakeVault(), points);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const consent = await openConsent(e, who, authorizePath(clientId, challenge));
    expect((await submit(e, consent, [accA], ['accounts:read'], 'deny')).status).toBe(302); // consumes the handle
    const r = await submit(e, consent, [accA], ['accounts:read']);
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).toContain('expired or was already used');
    expect(text).not.toContain('already allowed this connection');
    expect(await count('grant_reference')).toBe(0);
    expect(stepsOf(points)).toEqual(['register:ok', 'consent_shown:ok', 'consent_denied:ok', 'consent_stale:ok']);
  });

  it('an approval that fails after the handle is spent withdraws the repeat mark and leaves no grant', async () => {
    const vault = new FakeVault();
    const points: Point[] = [];
    const { e, who, accA } = await setup(vault, points);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const consent = await openConsent(e, who, authorizePath(clientId, challenge));
    vault.failOn.add('putGrant');
    const first = await submit(e, consent, [accA], ['accounts:read']);
    expect(first.status).toBeGreaterThanOrEqual(500);
    const again = await submit(e, consent, [accA], ['accounts:read']);
    expect(again.status).toBe(400);
    expect(await again.text()).not.toContain('already allowed this connection');
    expect(await count("grant_reference WHERE status = 'active'")).toBe(0);
    expect(stepsOf(points)).not.toContain('consent_approved:ok');
  });

  it('a refused form is counted as consent_rejected with a fixed reason', async () => {
    const points: Point[] = [];
    const { e, who } = await setup(new FakeVault(), points);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const consent = await openConsent(e, who, authorizePath(clientId, challenge));
    expect((await submit(e, consent, [], ['accounts:read'])).status).toBe(400);
    expect(stepsOf(points)).toContain('consent_rejected:pick_required');
  });

  it('form-action lets the redirect after Allow pass through a client relay (Gemini) and keeps loopback and custom schemes', () => {
    expect(formActionFor('https://oauth-redirect.googleusercontent.com/r/x')).toEqual(['https:']);
    expect(formActionFor('HTTPS://client.example:8443/cb')).toEqual(['https:']);
    expect(formActionFor('http://127.0.0.1:7777/cb')).toEqual(['https:', 'http://127.0.0.1:7777']);
    expect(formActionFor('cursor://anysphere/cb')).toEqual(['https:', 'cursor:']);
    expect(formActionFor('not a url')).toEqual([]);
  });

  it('rejects accounts that are not the principal\'s active accounts, and scopes the client did not request', async () => {
    const { e, vault, who, accA } = await setup();
    const clientId = await register(e);
    const { challenge } = await pkce();
    const consent = await openConsent(e, who, authorizePath(clientId, challenge, 'accounts:read'));
    const foreignAccount = crypto.randomUUID();
    expect((await submit(e, consent, [accA, foreignAccount], ['accounts:read'])).status).toBe(400);
    const c2 = await openConsent(e, who, authorizePath(clientId, challenge, 'accounts:read'));
    expect((await submit(e, c2, [accA], ['accounts:read', 'media:read'])).status).toBe(400);
    expect((await submit(e, c2, [accA], [])).status).toBe(400);
    expect(await count('grant_reference')).toBe(0);
    expect(vault.calls.some((c) => c.startsWith('putGrant'))).toBe(false);
  });

  it('consent page escapes client text, preselects no account, offers only requested scopes and uses a strict CSP', async () => {
    const { e, who } = await setup();
    const clientId = await register(e, '<img src=x onerror=alert(1)>"Evil"');
    const { challenge } = await pkce();
    const c = await openConsent(e, who, authorizePath(clientId, challenge, 'messages:read'));
    expect(c.text).not.toContain('<img src=x');
    expect(c.text).toContain('&#60;img src=x onerror=alert(1)&#62;');
    expect(c.text).toContain('client.example');
    expect(c.text).toMatch(/name="account" value="[0-9a-f-]{36}">/);
    expect(c.text).not.toMatch(/name="account"[^>]*checked/);
    expect(c.text).toContain('value="messages:read" checked');
    expect(c.text).not.toContain('value="media:read"');
    const csp = c.res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https:;");
    expect(csp).not.toContain('script-src');
    expect(c.text).toContain('Beta');
    expect(c.text.toLowerCase()).not.toContain('<script');
  });

  it('a forged offered-scopes field is rejected', async () => {
    const { e, who, accA } = await setup();
    const clientId = await register(e);
    const { challenge } = await pkce();
    const c = await openConsent(e, who, authorizePath(clientId, challenge, 'accounts:read'));
    c.offered = 'accounts:read media:read';
    expect((await submit(e, c, [accA], ['accounts:read', 'media:read'])).status).toBe(400);
    expect(await count('grant_reference')).toBe(0);
  });

  it('deny redirects to the client with access_denied and creates nothing', async () => {
    const { e, who, accA } = await setup();
    const clientId = await register(e);
    const { challenge } = await pkce();
    const c = await openConsent(e, who, authorizePath(clientId, challenge));
    const r = await submit(e, c, [accA], ['accounts:read'], 'deny');
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get('location') as string).searchParams.get('error')).toBe('access_denied');
    expect(await count('grant_reference')).toBe(0);
  });

  it('reconnecting the same client replaces the earlier grant (deny first, then revoke)', async () => {
    const { e, vault, who, accA } = await setup();
    const clientId = await register(e);
    const run = async (): Promise<string> => {
      const { verifier, challenge } = await pkce();
      const c = await openConsent(e, who, authorizePath(clientId, challenge));
      const done = await submit(e, c, [accA], ['accounts:read']);
      const code = new URL(done.headers.get('location') as string).searchParams.get('code') as string;
      return (await exchange(e, clientId, code, verifier)).access_token;
    };
    const t1 = await run();
    const t2 = await run();
    expect(await validate(e, t1)).toBeNull();
    expect(await validate(e, t2)).not.toBeNull();
    expect(vault.calls.filter((c) => c.startsWith('denyGrant'))).toHaveLength(1);
    expect(await count('grant_reference')).toBe(2);
  });

  it('no active account: sends the user to the cabinet to link one, carrying the exact request in the fragment', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const path = authorizePath(clientId, challenge);
    const c = await openConsent(e, who, path);
    expect(c.res.status).toBe(302);
    expect(c.text).not.toContain('name="handle"');
    const loc = new URL(c.res.headers.get('location') as string);
    expect(loc.origin).toBe(APP);
    expect(loc.pathname).toBe('/app/');
    expect(loc.search).toBe('');
    expect(loc.hash.startsWith('#continue=')).toBe(true);
    expect(decodeURIComponent(loc.hash.slice('#continue='.length))).toBe(path);
    // No consent handle or library state cookie is minted before the user comes back.
    expect(Object.keys(cookiesFrom(c.res))).toEqual([]);
  });

  it('no active account: the cabinet link keeps the user language', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const clientId = await register(e);
    const { challenge } = await pkce();
    const c = await openConsent(e, who, `${authorizePath(clientId, challenge)}&lang=ru`);
    expect(new URL(c.res.headers.get('location') as string).pathname).toBe('/ru/app/');
  });

  it('no active account: an invalid client never reaches the cabinet', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const { challenge } = await pkce();
    const c = await openConsent(e, who, authorizePath('no-such-client', challenge));
    expect(c.res.headers.get('location') ?? '').not.toContain(APP);
  });

  it('no active account: a suspended profile gets 403, not the cabinet', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const clientId = await register(e);
    const { challenge } = await pkce();
    await db().prepare("UPDATE principals SET status = 'suspended'").run();
    const c = await openConsent(e, who, authorizePath(clientId, challenge));
    expect(c.res.status).toBe(403);
    expect(c.res.headers.get('location')).toBeNull();
  });
});

describe('account disconnect and profile deletion', () => {
  it('disconnect removes the account from grants (new version) before the vault disconnect', async () => {
    const { e, vault, who, accA } = await setup();
    const accB = await linkAccount(e, vault, who, '3003', 'B');
    const { tokens, grantId } = await connectClient(e, who, [accA, accB]);
    vault.calls.length = 0;
    const r = await post(e, `/api/accounts/${accB}/disconnect`, {}, who);
    expect(r.status).toBe(200);
    expect(vault.calls).toEqual([`putGrant:${grantId}@2`, `disconnectAccount:${accB}`]);
    const row = await db().prepare('SELECT accounts_json, version FROM grant_reference WHERE grant_id = ?1').bind(grantId).first<{ accounts_json: string; version: number }>();
    expect(JSON.parse(row?.accounts_json as string)).toEqual([accA]);
    expect(row?.version).toBe(2);
    const acc = await db().prepare('SELECT status, telegram_id_hmac FROM linked_accounts WHERE account_id = ?1').bind(accB).first<{ status: string; telegram_id_hmac: string | null }>();
    expect(acc).toEqual({ status: 'disconnected', telegram_id_hmac: null });
    expect(tokens.access_token).toBeTruthy();
    // the freed telegram account can be linked again
    await linkAccount(e, vault, who, '3003', 'B again');
  });

  it('a failing vault leaves the account revocation_pending and retry succeeds', async () => {
    const { e, vault, who, accA } = await setup();
    vault.failOn.add('disconnectAccount');
    expect((await post(e, `/api/accounts/${accA}/disconnect`, {}, who)).status).toBe(503);
    const row = await db().prepare('SELECT status FROM linked_accounts').first<{ status: string }>();
    expect(row?.status).toBe('revocation_pending');
    vault.failOn.clear();
    expect((await post(e, `/api/accounts/${accA}/disconnect`, {}, who)).status).toBe(200);
  });

  it('profile deletion needs the confirm phrase, denies+revokes grants, wipes the vault and leaves a tombstone', async () => {
    const { e, vault, who, accA } = await setup();
    const { tokens, grantId } = await connectClient(e, who, [accA]);
    expect((await post(e, '/api/profile/delete', { confirm: 'delete' }, who)).status).toBe(400);
    vault.calls.length = 0;
    const r = await post(e, '/api/profile/delete', { confirm: 'УДАЛИТЬ ПРОФИЛЬ' }, who);
    expect(r.status).toBe(200);
    expect(vault.calls).toEqual([`denyGrant:${grantId}`, 'deletePrincipal']);
    expect(await validate(e, tokens.access_token)).toBeNull();
    const p = await db().prepare('SELECT * FROM principals').first<Record<string, unknown>>();
    expect(p).toMatchObject({ status: 'deleted', oidc_issuer: null, oidc_subject: null, primary_telegram_id_hmac: null, telegram_id_enc: null });
    expect(p?.['deleted_at']).toBeTruthy();
    expect(await count('linked_accounts')).toBe(0);
    expect(await count('grant_reference')).toBe(0);
    expect(await count('web_sessions')).toBe(0);
    expect((await get(e, '/api/accounts', who)).status).toBe(401);
    // the same Telegram identity can register again as a fresh principal
    await login(e, tg);
    expect(await count('principals')).toBe(2);
  });

  it('suspended profiles cannot create new access', async () => {
    const { e, who } = await setup();
    await db().prepare("UPDATE principals SET status = 'suspended'").run();
    const r = await post(e, '/api/accounts/link', {}, who);
    expect(r.status).toBe(403);
    expect(APP).toBeTruthy();
  });
});
