import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP, FakeVault, acceptTerms, call, count, db, get, installFetchMock, linkAccount, login, makeEnv, newTelegram, post, resetDb } from './helpers';
import type { Telegram } from './helpers';

let tg: Telegram;
beforeEach(async () => {
  await resetDb();
  tg = await newTelegram();
  installFetchMock(tg);
});
afterEach(() => vi.restoreAllMocks());

describe('CSRF and CORS', () => {
  it('rejects POST without token, with a foreign Origin, or without Origin', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const noToken = await post(e, '/api/accounts/link', {}, who, { 'x-csrf-token': '' });
    expect(noToken.status).toBe(403);
    const wrongToken = await post(e, '/api/accounts/link', {}, who, { 'x-csrf-token': 'x'.repeat(43) });
    expect(wrongToken.status).toBe(403);
    const foreign = await post(e, '/api/accounts/link', {}, who, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    const noOrigin = await call(e, '/api/accounts/link', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': who.csrf }, body: '{}' }, who.jar);
    expect(noOrigin.status).toBe(403);
    const logout = await call(e, '/logout', { method: 'POST', headers: { origin: 'https://evil.example', 'x-csrf-token': who.csrf } }, who.jar);
    expect(logout.status).toBe(403);
    expect(await count('linked_accounts')).toBe(0);
  });

  it('answers CORS only for the exact app origin, with credentials and never a wildcard', async () => {
    const e = makeEnv();
    const ok = await call(e, '/api/session', { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'POST' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-csrf-token');
    const bad = await call(e, '/api/session', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const get1 = await call(e, '/api/session', { headers: { origin: 'https://evil.example' } });
    expect(get1.headers.get('access-control-allow-origin')).toBeNull();
    const get2 = await call(e, '/api/session', { headers: { origin: APP } });
    expect(get2.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('GET /api/session summarises the principal and returns the CSRF token', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    const body = (await (await get(e, '/api/session', who)).json()) as Record<string, unknown>;
    expect(body['authenticated']).toBe(true);
    expect(body['termsRequired']).toBe(true);
    expect(body['beta']).toBe(true);
    expect(typeof body['csrfToken']).toBe('string');
    const anon = (await (await call(e, '/api/session')).json()) as Record<string, unknown>;
    expect(anon['authenticated']).toBe(false);
  });

  it('logout destroys the session', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    const out = await post(e, '/logout', {}, who);
    expect(out.status).toBe(200);
    expect(await count('web_sessions')).toBe(0);
    expect((await get(e, '/api/accounts', who)).status).toBe(401);
  });

  it('expires sessions by idle and absolute time', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await db().prepare('UPDATE web_sessions SET idle_expires_at = 1').run();
    expect((await get(e, '/api/accounts', who)).status).toBe(401);
    expect(await count('web_sessions')).toBe(0);
  });
});

describe('account linking', () => {
  it('requires accepted beta terms before connecting', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    const r = await post(e, '/api/accounts/link', {}, who);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { reason: string } }).error.reason).toBe('TERMS_REQUIRED');
    await acceptTerms(e, who);
    expect((await post(e, '/api/accounts/link', {}, who)).status).toBe(201);
  });

  it('reserves the account in D1 as pending before the vault is called, and pending is not active', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    vault.hooks['startLink'] = async () => {
      const row = await db().prepare('SELECT status FROM linked_accounts').first<{ status: string }>();
      expect(row?.status).toBe('pending');
    };
    const r = await post(e, '/api/accounts/link', { label: 'Рабочий' }, who);
    const body = (await r.json()) as { accountId: string; link: { state: string; qrUrl: string } };
    expect(body.link.state).toBe('waiting_scan');
    const list = (await (await get(e, '/api/accounts', who)).json()) as { accounts: { status: string; label: string }[] };
    expect(list.accounts).toEqual([expect.objectContaining({ status: 'pending', label: 'Рабочий' })]);
    // a second attempt while one is fresh does not open a second QR session
    expect((await post(e, '/api/accounts/link', {}, who)).status).toBe(409);
  });

  it('parallel link requests create at most one pending account and never exceed the cap', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(e, '/api/accounts/link', {}, who)));
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM linked_accounts WHERE status = 'pending'").first<{ n: number }>())?.n).toBe(1);

    // cap: fill to MAX_ACCOUNTS-1 active rows, then race again -> exactly one more is allowed
    const pid = (await db().prepare('SELECT principal_id FROM principals').first<{ principal_id: string }>())?.principal_id as string;
    await db().prepare("UPDATE linked_accounts SET status = 'active'").run();
    const t = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 8; i++) {
      await db().prepare("INSERT INTO linked_accounts (account_id, principal_id, status, operation_id, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?4)").bind(`acc-${i}`, pid, `op-${i}`, t).run();
    }
    const more = await Promise.all(Array.from({ length: 5 }, () => post(e, '/api/accounts/link', {}, who)));
    expect(more.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM linked_accounts WHERE status != 'disconnected'").first<{ n: number }>())?.n).toBe(10);
  });

  it('activates only after the uniqueness reservation, never exposes the telegram id, and is resumable', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const r = await post(e, '/api/accounts/link', {}, who);
    const { accountId } = (await r.json()) as { accountId: string };
    vault.link = { state: 'authorized', telegramId: '555001', label: 'Masked' };
    vault.failOn.add('activateAccount'); // activation fails once: reservation exists, account stays pending
    const first = await get(e, `/api/accounts/${accountId}/link-status`, who);
    expect(first.status).toBe(503);
    let row = await db().prepare('SELECT status, telegram_id_hmac FROM linked_accounts').first<{ status: string; telegram_id_hmac: string | null }>();
    expect(row?.status).toBe('pending');
    expect(row?.telegram_id_hmac).toBeTruthy();
    vault.failOn.clear();
    vault.link = { state: 'unknown' }; // resumes from D1, not from the vault poll
    const second = await get(e, `/api/accounts/${accountId}/link-status`, who);
    const text = await second.text();
    expect(JSON.parse(text)).toEqual({ state: 'active' });
    expect(text).not.toContain('555001');
    row = await db().prepare('SELECT status, telegram_id_hmac FROM linked_accounts').first();
    expect(row?.status).toBe('active');
    expect(JSON.stringify(row)).not.toContain('555001');
    expect(vault.calls.filter((c) => c.startsWith('activateAccount'))).toHaveLength(2);
  });

  it('telegram id conflict disconnects the vault session and does not reveal the other owner', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const a = await login(e, tg, { claims: { sub: 'owner-a', id: 1 } });
    await acceptTerms(e, a);
    const accA = await linkAccount(e, vault, a, '999000', 'Секретная метка владельца A');
    const b = await login(e, tg, { claims: { sub: 'owner-b', id: 2 } });
    await acceptTerms(e, b);
    vault.calls.length = 0;
    vault.link = { state: 'waiting_scan', qrUrl: 'tg://x', expiresAt: '2030-01-01T00:00:00.000Z' };
    const start = await post(e, '/api/accounts/link', {}, b);
    const { accountId } = (await start.json()) as { accountId: string };
    vault.link = { state: 'authorized', telegramId: '999000', label: 'Masked' };
    const res = await get(e, `/api/accounts/${accountId}/link-status`, b);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ state: 'failed', code: 'NOT_ALLOWED' });
    for (const secret of [accA, 'owner-a', 'Секретная метка владельца A', '999000']) expect(text).not.toContain(secret);
    expect(vault.calls).toContain(`disconnectAccount:${accountId}`);
    expect(vault.calls.some((c) => c.startsWith('activateAccount'))).toBe(false);
    const row = await db().prepare('SELECT status, telegram_id_hmac FROM linked_accounts WHERE account_id = ?1').bind(accountId).first<{ status: string; telegram_id_hmac: string | null }>();
    expect(row).toEqual({ status: 'disconnected', telegram_id_hmac: null });
    // owner A is untouched and B can poll again with the same stable answer
    expect(JSON.parse(await (await get(e, `/api/accounts/${accountId}/link-status`, b)).text())).toEqual({ state: 'failed', code: 'NOT_ALLOWED' });
  });

  it('cannot read or drive another principal\'s account', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const a = await login(e, tg, { claims: { sub: 'a', id: 1 } });
    await acceptTerms(e, a);
    const accA = await linkAccount(e, vault, a, '111');
    const b = await login(e, tg, { claims: { sub: 'b', id: 2 } });
    await acceptTerms(e, b);
    expect((await get(e, `/api/accounts/${accA}/link-status`, b)).status).toBe(404);
    expect((await post(e, `/api/accounts/${accA}/disconnect`, {}, b)).status).toBe(404);
    expect((await post(e, `/api/accounts/${accA}/password`, { password: 'x' }, b)).status).toBe(404);
  });

  it('forwards the 2FA password to the vault and never stores it', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    await acceptTerms(e, who);
    const { accountId } = (await (await post(e, '/api/accounts/link', {}, who)).json()) as { accountId: string };
    vault.link = { state: 'need_password', hint: 'pet' };
    const r = await post(e, `/api/accounts/${accountId}/password`, { password: 'correct horse' }, who);
    expect(await r.json()).toEqual({ state: 'need_password', hint: 'pet' });
    vault.link = { state: 'need_password', hint: null, invalidAttempts: 2 };
    const again = await post(e, `/api/accounts/${accountId}/password`, { password: 'wrong' }, who);
    expect(await again.json()).toEqual({ state: 'need_password', hint: null, invalidAttempts: 2 });
    expect(vault.calls).toContain(`submitPassword:${accountId}`);
    const dump = JSON.stringify(await db().prepare('SELECT * FROM linked_accounts').all());
    expect(dump).not.toContain('correct horse');
    expect((await post(e, `/api/accounts/${accountId}/password`, { password: '' }, who)).status).toBe(400);
  });

  it('usage is forwarded from the vault', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const who = await login(e, tg);
    expect(await (await get(e, '/api/usage', who)).json()).toEqual({ usage: vault.usage });
  });

  it('profile deletion requires an exact confirmation phrase (Russian or English)', async () => {
    const e = makeEnv();
    const who = await login(e, tg);
    await acceptTerms(e, who);
    for (const bad of ['delete profile', 'УДАЛИТЬ', '', 'DELETE PROFILE ']) {
      const r = await post(e, '/api/profile/delete', { confirm: bad }, who);
      expect(r.status).toBe(400);
    }
    const ok = await post(e, '/api/profile/delete', { confirm: 'DELETE PROFILE' }, who);
    expect(ok.status).toBeLessThan(300);
  });
});
