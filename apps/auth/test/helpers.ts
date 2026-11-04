import { env } from 'cloudflare:workers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWK } from 'jose';
import { vi } from 'vitest';
import type { GrantRecord, LinkState, UsageView, VaultControlRpc } from '@postun/contracts';
import { handleRequest } from '../src/app';
import type { Env } from '../src/env';

export const ISSUER = 'https://auth.postun.org';
export const APP = 'https://app.postun.org';
export const TG_ISSUER = 'https://oauth.telegram.org';
export const BOT_ID = 'test-bot-id';
export const MCP = 'https://mcp.postun.org/mcp';

export class FakeVault implements VaultControlRpc {
  calls: string[] = [];
  hooks: Record<string, () => Promise<void> | void> = {};
  failOn = new Set<string>();
  grants = new Map<string, GrantRecord>();
  link: LinkState = { state: 'waiting_scan', qrUrl: 'tg://login?token=abc', expiresAt: '2030-01-01T00:00:00.000Z' };
  usage: UsageView = { month: '2026-11', successCount: 3, outBytes: 10, monthlySuccessLimit: 100 };

  private async rec(name: string, detail = ''): Promise<void> {
    this.calls.push(detail ? `${name}:${detail}` : name);
    if (this.failOn.has(name)) throw new Error('vault down');
    await this.hooks[name]?.();
  }
  async startLink(_p: string, a: string): Promise<LinkState> {
    await this.rec('startLink', a);
    return this.link;
  }
  async linkStatus(_p: string, a: string): Promise<LinkState> {
    await this.rec('linkStatus', a);
    return this.link;
  }
  async submitPassword(_p: string, a: string, pw: string): Promise<LinkState> {
    await this.rec('submitPassword', a);
    void pw;
    return this.link;
  }
  async activateAccount(_p: string, a: string): Promise<{ ok: true }> {
    await this.rec('activateAccount', a);
    return { ok: true };
  }
  async disconnectAccount(_p: string, a: string): Promise<{ telegramLoggedOut: boolean }> {
    await this.rec('disconnectAccount', a);
    return { telegramLoggedOut: true };
  }
  async putGrant(_p: string, g: GrantRecord): Promise<{ ok: true }> {
    await this.rec('putGrant', `${g.grantId}@${g.version}`);
    this.grants.set(g.grantId, g);
    return { ok: true };
  }
  async denyGrant(_p: string, g: string): Promise<{ ok: true }> {
    await this.rec('denyGrant', g);
    return { ok: true };
  }
  async setSuspended(_p: string, s: boolean): Promise<{ ok: true }> {
    await this.rec('setSuspended', String(s));
    return { ok: true };
  }
  async deletePrincipal(_p: string): Promise<{ ok: true }> {
    await this.rec('deletePrincipal');
    return { ok: true };
  }
  async getUsage(_p: string): Promise<UsageView> {
    await this.rec('getUsage');
    return this.usage;
  }
}

export function makeEnv(over: Partial<Env> = {}, vault: VaultControlRpc = new FakeVault()): Env {
  return { ...(env as unknown as Env), VAULT: vault, ...over };
}

export function db(): D1Database {
  return (env as unknown as Env).CONTROL_DB;
}

export async function count(table: string): Promise<number> {
  const r = await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function resetDb(): Promise<void> {
  for (const t of ['web_sessions', 'login_states', 'admin_audit', 'grant_reference', 'linked_accounts', 'entitlements', 'principals']) {
    await db().prepare(`DELETE FROM ${t}`).run();
  }
  const kv = (env as unknown as Env).OAUTH_KV;
  let cursor: string | undefined;
  do {
    const l = await kv.list(cursor ? { cursor } : {});
    for (const k of l.keys) await kv.delete(k.name);
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
}

// ---------- Telegram OIDC mock (locally generated RSA key; never real secrets) ----------

export interface Telegram {
  kid: string;
  sign(claims: Record<string, unknown>, opts?: { alg?: string; key?: CryptoKey; kid?: string }): Promise<string>;
  jwks: { keys: JWK[] };
  otherKey: CryptoKey;
}

export async function newTelegram(): Promise<Telegram> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  return {
    kid: 'k1',
    jwks: { keys: [jwk] },
    otherKey: other.privateKey,
    sign: (claims, opts = {}) =>
      new SignJWT(claims as never).setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' }).sign(opts.key ?? privateKey)
  };
}

export const mock = { idToken: 'unset', tokenStatus: 200, tokenCalls: [] as { auth: string | null; body: string }[] };

export function installFetchMock(tg: Telegram): void {
  mock.tokenCalls = [];
  mock.tokenStatus = 200;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://oauth.telegram.org/.well-known/jwks.json') return Response.json(tg.jwks);
    if (url === 'https://oauth.telegram.org/token') {
      mock.tokenCalls.push({ auth: new Headers(init?.headers).get('authorization'), body: String(init?.body) });
      return mock.tokenStatus === 200 ? Response.json({ id_token: mock.idToken, token_type: 'Bearer' }) : new Response('{}', { status: mock.tokenStatus });
    }
    return new Response('unexpected outbound request', { status: 599 });
  });
}

export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Math.floor(Date.now() / 1000);
  return { iss: TG_ISSUER, aud: BOT_ID, sub: 'sub-1001', id: 424242, iat: t, exp: t + 600, ...over };
}

// ---------- HTTP helpers ----------

export function cookiesFrom(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = (pair ?? '').indexOf('=');
    if (i > 0) out[(pair as string).slice(0, i)] = (pair as string).slice(i + 1);
  }
  return out;
}

export const cookieHeader = (jar: Record<string, string>): string =>
  Object.entries(jar)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

export function call(e: Env, path: string, init: RequestInit = {}, jar: Record<string, string> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const c = cookieHeader(jar);
  if (c) headers.set('cookie', c);
  return handleRequest(new Request(`${ISSUER}${path}`, { ...init, headers, redirect: 'manual' }), e, {} as ExecutionContext);
}

export interface LoggedIn {
  jar: Record<string, string>;
  csrf: string;
  callback: Response;
}

/** Runs /login -> (mocked Telegram) -> /callback and returns the cookie jar. */
export async function login(
  e: Env,
  tg: Telegram,
  opts: { claims?: Record<string, unknown>; nonce?: boolean; returnTo?: string; token?: string } = {}
): Promise<LoggedIn> {
  const start = await call(e, `/login${opts.returnTo ? `?return=${encodeURIComponent(opts.returnTo)}` : ''}`);
  const loc = new URL(start.headers.get('location') as string);
  const state = loc.searchParams.get('state') as string;
  const nonce = loc.searchParams.get('nonce') as string;
  const jar = cookiesFrom(start);
  mock.idToken = opts.token ?? (await tg.sign(claims({ ...(opts.nonce === false ? {} : { nonce }), ...opts.claims })));
  const callback = await call(e, `/callback?code=abc&state=${encodeURIComponent(state)}`, {}, jar);
  const session = cookiesFrom(callback);
  const all = { ...jar, ...session };
  let csrf = '';
  if (all['__Host-postun_session']) {
    const s = await call(e, '/api/session', {}, all);
    csrf = ((await s.json()) as { csrfToken?: string }).csrfToken ?? '';
  }
  return { jar: all, csrf, callback };
}

export function post(e: Env, path: string, body: unknown, who: LoggedIn, headers: Record<string, string> = {}): Promise<Response> {
  return call(
    e,
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP, 'x-csrf-token': who.csrf, ...headers },
      body: JSON.stringify(body)
    },
    who.jar
  );
}

export function get(e: Env, path: string, who: LoggedIn): Promise<Response> {
  return call(e, path, { headers: { origin: APP } }, who.jar);
}

export async function acceptTerms(e: Env, who: LoggedIn): Promise<void> {
  const r = await call(
    e,
    '/terms',
    { method: 'POST', headers: { origin: ISSUER, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: who.csrf, accept: 'yes' }) },
    who.jar
  );
  if (r.status !== 302) throw new Error(`terms failed ${r.status}`);
}

/** Fully links one account through the API with the fake vault. */
export async function linkAccount(e: Env, vault: FakeVault, who: LoggedIn, telegramId: string, label = 'main'): Promise<string> {
  vault.link = { state: 'waiting_scan', qrUrl: 'tg://login?token=x', expiresAt: '2030-01-01T00:00:00.000Z' };
  const r = await post(e, '/api/accounts/link', { label }, who);
  const { accountId } = (await r.json()) as { accountId: string };
  vault.link = { state: 'authorized', telegramId, label: 'Masked' };
  await get(e, `/api/accounts/${accountId}/link-status`, who);
  return accountId;
}
