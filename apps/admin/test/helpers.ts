import { env as rawEnv } from 'cloudflare:workers';
import { sha256, toBase64Url, utf8 } from '@postun/contracts';
import { vi } from 'vitest';
import worker from '../src/index';
import { resetDiscoveryCache } from '../src/oidc';
import type { Env } from '../src/env';

export const ISSUER = 'https://idp.test.example';
export const ORIGIN = 'https://admin.test.example';
export const PROJECT = 'proj-111';
export const ORG = 'org-222';
export const CLIENT = 'client-333@postun';
export const SECRET = 'synthetic-client-secret';
export const SESSION_KEY = toBase64Url(new Uint8Array(32).fill(7));
export const SUBJECT = 'user-synthetic-1';

export const baseEnv = rawEnv as unknown as Env;
export const db = baseEnv.ADMIN_DB;

export interface Control {
  suspend: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}
export function makeEnv(over: Partial<Record<keyof Env, unknown>> = {}, control?: Control): Env & { CONTROL: Control } {
  const c = control ?? { suspend: vi.fn(async () => ({ ok: true })), resume: vi.fn(async () => ({ ok: true })) };
  const e = {
    ADMIN_DB: db,
    CONTROL: c,
    APP_ENV: 'test',
    ADMIN_ORIGIN: ORIGIN,
    IDP_ISSUER: ISSUER,
    IDP_PROJECT_ID: PROJECT,
    IDP_ORG_ID: ORG,
    IDP_CLIENT_ID: CLIENT,
    IDP_CLIENT_SECRET: SECRET,
    ADMIN_SESSION_KEY: SESSION_KEY,
    ...over
  };
  for (const k of Object.keys(e)) if ((e as Record<string, unknown>)[k] === undefined) delete (e as Record<string, unknown>)[k];
  return e as unknown as Env & { CONTROL: Control };
}

// ---------- clock ----------
export const clock = { t: 0 };
export function startClock(): void {
  clock.t = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock.t);
}
export const advance = (ms: number): void => {
  clock.t += ms;
};

// ---------- fake IDP ----------
type Roles = Record<string, Record<string, string>> | undefined;
export interface IdP {
  keys: CryptoKeyPair;
  /** Roles currently assigned at the IdP (returned by userinfo and by refreshed ID tokens). */
  roles: Roles;
  /** Overrides for the ID token issued on the code exchange. */
  idOverrides: Record<string, unknown>;
  rolesInIdToken: boolean;
  refresh: 'ok' | 'invalid_grant' | 'down';
  issueRefreshToken: boolean;
  /** Sign ID tokens with a key that is NOT in the published JWKS. */
  rogueSignature: boolean;
  discoveryDown: boolean;
  codes: Map<string, { nonce: string; challenge: string }>;
  calls: { token: number; refresh: number; userinfo: number };
}
export const ownerRoles = (...r: string[]): Roles => Object.fromEntries(r.map((x) => [x, { [ORG]: 'org.test' }]));

async function sign(keys: CryptoKeyPair, payload: Record<string, unknown>): Promise<string> {
  const h = toBase64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })));
  const b = toBase64Url(utf8(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, utf8(`${h}.${b}`)));
  return `${h}.${b}.${toBase64Url(sig)}`;
}
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

export async function installIdP(): Promise<IdP> {
  resetDiscoveryCache();
  const keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const z: IdP = { keys, roles: ownerRoles('postun.operator'), idOverrides: {}, rolesInIdToken: true, refresh: 'ok', issueRefreshToken: true, rogueSignature: false, discoveryDown: false, codes: new Map(), calls: { token: 0, refresh: 0, userinfo: 0 } };
  const rolesClaim = (): Record<string, unknown> => (z.roles ? { [`urn:idp:iam:org:project:${PROJECT}:roles`]: z.roles } : {});
  const now = (): number => Math.floor(clock.t / 1000);
  const rogue = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const idToken = (extra: Record<string, unknown>): Promise<string> =>
    sign(z.rogueSignature ? rogue : keys, { iss: ISSUER, sub: SUBJECT, aud: [CLIENT, PROJECT], azp: CLIENT, iat: now(), exp: now() + 600, amr: ['pwd', 'mfa', 'otp'], ...(z.rolesInIdToken ? rolesClaim() : {}), ...extra });

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== ISSUER) return new Response('unexpected egress', { status: 599 });
    if (url.pathname === '/.well-known/openid-configuration') {
      if (z.discoveryDown) return new Response('down', { status: 503 });
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/v2/authorize`,
        token_endpoint: `${ISSUER}/oauth/v2/token`,
        userinfo_endpoint: `${ISSUER}/oidc/v1/userinfo`,
        end_session_endpoint: `${ISSUER}/oidc/v1/end_session`,
        jwks_uri: `${ISSUER}/oauth/v2/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256']
      });
    }
    if (url.pathname === '/oauth/v2/keys') return json({ keys: [jwk] });
    if (url.pathname === '/oidc/v1/userinfo') {
      z.calls.userinfo++;
      return json({ sub: SUBJECT, ...rolesClaim() });
    }
    if (url.pathname === '/oauth/v2/token' && method === 'POST') {
      const body = new URLSearchParams(String(init?.body ?? ''));
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      if (!auth.startsWith('Basic ')) return json({ error: 'invalid_client' }, 401);
      if (body.get('grant_type') === 'authorization_code') {
        z.calls.token++;
        const c = z.codes.get(body.get('code') ?? '');
        const verifierOk = c && toBase64Url(await sha256(body.get('code_verifier') ?? '')) === c.challenge;
        if (!c || !verifierOk || body.get('redirect_uri') !== `${ORIGIN}/oidc/callback`) return json({ error: 'invalid_grant' }, 400);
        z.codes.delete(body.get('code') ?? '');
        return json({ access_token: 'at-synthetic', token_type: 'Bearer', expires_in: 600, ...(z.issueRefreshToken ? { refresh_token: 'rt-synthetic-1' } : {}), id_token: await idToken({ nonce: c.nonce, ...z.idOverrides }) });
      }
      if (body.get('grant_type') === 'refresh_token') {
        z.calls.refresh++;
        if (z.refresh === 'down') return new Response('down', { status: 503 });
        if (z.refresh === 'invalid_grant' || body.get('refresh_token') !== 'rt-synthetic-1') return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'at-synthetic-2', token_type: 'Bearer', expires_in: 600, refresh_token: 'rt-synthetic-1', id_token: await idToken({}) });
      }
    }
    return new Response('not found', { status: 404 });
  });
  return z;
}

// ---------- request driver ----------
export async function call(env: Env, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  const req = new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' });
  return worker.fetch(req, env);
}
const cookieOf = (res: Response, name: string): string | undefined => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`)) return c.split(';')[0];
  return undefined;
};

export interface LoginFlow {
  state: string;
  nonce: string;
  challenge: string;
  url: URL;
  flowCookie: string;
}
export async function startLogin(env: Env, z: IdP, code = 'code-1'): Promise<LoginFlow> {
  const res = await call(env, '/login');
  if (res.status !== 303) throw new Error(`login status ${res.status}`);
  const url = new URL(res.headers.get('location') ?? '');
  const flow = { state: url.searchParams.get('state') ?? '', nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '', url, flowCookie: cookieOf(res, '__Host-postun_admin_flow') ?? '' };
  z.codes.set(code, { nonce: flow.nonce, challenge: flow.challenge });
  return flow;
}
export const callback = (env: Env, f: LoginFlow, code = 'code-1', opts: { state?: string; cookie?: string } = {}): Promise<Response> =>
  call(env, `/oidc/callback?code=${code}&state=${opts.state ?? f.state}`, { cookie: opts.cookie ?? f.flowCookie });

/** Full successful login; returns the admin session cookie. */
export async function login(env: Env, z: IdP): Promise<string> {
  const f = await startLogin(env, z);
  const res = await callback(env, f);
  const c = cookieOf(res, '__Host-postun_admin');
  if (res.status !== 303 || !c) throw new Error(`login failed ${res.status}`);
  return c;
}

export const form = (data: Record<string, string>): { method: string; body: string; headers: Record<string, string> } => ({
  method: 'POST',
  body: new URLSearchParams(data).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }
});

export async function csrfOf(cookie: string): Promise<string> {
  const id = cookie.split('=')[1] ?? '';
  const h = toBase64Url(await sha256(id));
  return (await db.prepare('SELECT csrf_secret FROM admin_sessions WHERE id_hash = ?').bind(h).first<{ csrf_secret: string }>())?.csrf_secret ?? '';
}
export const sessionCount = async (): Promise<number> => (await db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<{ n: number }>())?.n ?? 0;

export async function seedProjection(ref: string, over: Partial<{ status: string; month: string; success: number; bytes: number; accounts: number }> = {}): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO projections (principal_ref, revision, linked_accounts, status, plan, month, success_count, out_bytes, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)')
    .bind(ref, over.accounts ?? 2, over.status ?? 'active', 'beta_free', over.month ?? new Date(clock.t).toISOString().slice(0, 7), over.success ?? 10, over.bytes ?? 2048, clock.t)
    .run();
}
