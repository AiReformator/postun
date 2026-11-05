import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { tl } from '@mtcute/core';
import { importAesKey, openSession, randomToken, sealSession, type SessionEnvelope } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { signFileCapability } from '../src/capability';
import { loadKeys } from '../src/config';
import { safeDisposition } from '../src/files';
import { mapTelegramError } from '../src/telegram/errors';
import { MtcuteSession } from '../src/telegram/mtcute';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, fetchFile, parseDownload, principalStub, setupWorld, type World } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

const sql = <T>(w: World, fn: (s: SqlStorage) => T): Promise<T> => runInDurableObject(principalStub(w.principalId), (_i, st) => fn(st.storage.sql));
const one = <T extends Record<string, SqlStorageValue>>(w: World, q: string, ...b: SqlStorageValue[]) => sql(w, (s) => s.exec<T>(q, ...b).one());
const successCount = async (w: World) => (await principalStub(w.principalId).getUsage(w.principalId)).successCount;

// ---------------------------------------------------------------------------------------------- 1
describe('finding 1: a committed operation_id is not an unlimited free read', () => {
  it('a replay of a committed key is refused with QUOTA_EXCEEDED when the quota is exhausted, before Telegram', async () => {
    const w = await setupWorld();
    const args = { account_id: w.accountIds[0], limit: 1, operation_id: 'op-exhausted-1' };
    expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(false);
    // Daily limit exhausted (100 in the test config).
    await sql(w, (s) => s.exec('UPDATE usage_day SET success_count = 100'));
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_dialogs', args))).toBe('QUOTA_EXCEEDED');
    expect(syntheticControl.opens).toBe(0);
    // Monthly limit exhausted (1000) also refuses, independently of the daily counter.
    await sql(w, (s) => s.exec('UPDATE usage_day SET success_count = 0'));
    await sql(w, (s) => s.exec('UPDATE usage SET success_count = 1000'));
    expect(errCode(await callTool(w.token, 'list_dialogs', args))).toBe('QUOTA_EXCEEDED');
    expect(syntheticControl.opens).toBe(0);
  });

  it('only one free replay per key: further replays are counted as fresh operations', async () => {
    const w = await setupWorld();
    const args = { account_id: w.accountIds[0], limit: 1, operation_id: 'op-bounded-01' };
    for (let i = 0; i < 6; i++) expect((await callTool(w.token, 'list_dialogs', args)).isError).toBe(false);
    // call 1 counted, call 2 free replay, calls 3..6 counted
    expect(await successCount(w)).toBe(5);
  });

  it('the single allowed retry is still free (Q-02)', async () => {
    const w = await setupWorld();
    const args = { account_id: w.accountIds[0], operation_id: 'op-one-retry-1' };
    await callTool(w.token, 'list_dialogs', args);
    await callTool(w.token, 'list_dialogs', args);
    expect(await successCount(w)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------- 2
describe('finding 2: channels:read cannot reach DMs or groups', () => {
  it('get_channel_posts refuses user and group peers with FORBIDDEN, before any history read', async () => {
    const w = await setupWorld({ scopes: ['accounts:read', 'channels:read'] });
    for (const peer of ['u:1000:7', 'g:1000:0']) {
      expect(errCode(await callTool(w.token, 'get_channel_posts', { account_id: w.accountIds[0], channel: peer }))).toBe('FORBIDDEN');
    }
    expect(await successCount(w)).toBe(0);
  });

  it('the mtcute adapter refuses a resolved megagroup and reads only broadcast channels', async () => {
    let history = 0;
    const fake = (chatType: string) =>
      new MtcuteSession(
        { getChat: async () => ({ chatType }), getHistory: async () => { history++; return []; } } as never,
        'initial'
      );
    const q = { peerId: 'c:1000:7', limit: 5, offset: null };
    for (const t of ['supergroup', 'gigagroup', 'group']) {
      await expect(fake(t).getChannelPosts(q)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(history).toBe(0);
    await expect(fake('channel').getChannelPosts(q)).resolves.toMatchObject({ items: [] });
    expect(history).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------- 3
describe('finding 3: file capability is verified at the edge', () => {
  const hasSchema = (principalId: string) =>
    runInDurableObject(principalStub(principalId), (_i, st) => st.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'meta'").one().n);

  it('a random bearer is rejected with 401 and never creates schema in an object for that principal', async () => {
    const victim = crypto.randomUUID();
    const res = await fetchFile('A'.repeat(22), `${victim}.${'B'.repeat(43)}.${'C'.repeat(43)}`);
    expect(res.status).toBe(401);
    expect(await hasSchema(victim)).toBe(0);
  });

  it('the capability is principal.secret.mac; a tampered tag or another intent is refused', async () => {
    const w = await setupWorld();
    const d = parseDownload(await callTool(w.token, 'get_media', { account_id: w.accountIds[0], peer: 'c:1000:7', message_id: 10 }));
    const parts = d.capability.split('.');
    expect(parts).toHaveLength(3);
    const flip = parts[2]!.startsWith('A') ? 'B' : 'A';
    expect((await fetchFile(d.intentId, `${parts[0]}.${parts[1]}.${flip}${parts[2]!.slice(1)}`)).status).toBe(401);
    expect((await fetchFile('Zm9yZ2VkLWludGVudC1pZA', d.capability)).status).toBe(401);
    expect((await fetchFile(d.intentId, d.capability, 'bytes=0-9')).status).toBe(206);
  });

  it('even a correctly signed capability for a never-bound principal gets 404 without creating schema', async () => {
    const ghost = crypto.randomUUID();
    const cap = await signFileCapability((await loadKeys(env)).cursor, ghost, 'A'.repeat(22), 'B'.repeat(43));
    expect((await fetchFile('A'.repeat(22), cap)).status).toBe(404);
    expect(await hasSchema(ghost)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------- 4
describe('finding 4: real mtcute RpcError flood waits', () => {
  it.each([
    ['FLOOD_WAIT_17', 17],
    ['FLOOD_PREMIUM_WAIT_30', 30],
    ['SLOWMODE_WAIT_45', 45]
  ])('%s built by RpcError.fromTl maps to RATE_LIMITED with retryAfter', (message, seconds) => {
    const err = tl.RpcError.fromTl({ errorCode: 420, errorMessage: message });
    expect(err.text).toMatch(/_%d$/); // proves this is the templated form mtcute really produces
    const m = mapTelegramError(err);
    expect(m.code).toBe('RATE_LIMITED');
    expect(m.retryAfterSeconds).toBe(seconds);
  });

  it('clamps absurd waits and keeps the plain-text fallback', () => {
    expect(mapTelegramError(tl.RpcError.fromTl({ errorCode: 420, errorMessage: 'FLOOD_WAIT_99999999' })).retryAfterSeconds).toBe(86_400);
    expect(mapTelegramError(tl.RpcError.fromTl({ errorCode: 420, errorMessage: 'FLOOD_WAIT_0' })).retryAfterSeconds).toBe(1);
    expect(mapTelegramError({ text: 'FLOOD_WAIT_9' }).retryAfterSeconds).toBe(9);
  });

  it('end to end: a real RpcError thrown by the adapter becomes a 429-class tool error', async () => {
    const w = await setupWorld();
    syntheticControl.throwNext = tl.RpcError.fromTl({ errorCode: 420, errorMessage: 'FLOOD_WAIT_17' });
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect(errCode(r)).toBe('RATE_LIMITED');
    expect((r.data.error as { retryAfterSeconds: number }).retryAfterSeconds).toBe(17);
  });
});

// ---------------------------------------------------------------------------------------------- 5
describe('finding 5: deletePrincipal keeps the revocation handle when Telegram logout fails', () => {
  it('marks the principal deleted, wipes all but the envelopes, retries via alarm and wipes after success', async () => {
    const w = await setupWorld({ accounts: 2 });
    const stub = principalStub(w.principalId);
    const d = parseDownload(await callTool(w.token, 'get_media', { account_id: w.accountIds[0], peer: 'c:1000:7', message_id: 10 }));
    syntheticControl.logoutFails = true;
    expect(await stub.deletePrincipal(w.principalId)).toEqual({ ok: true, revocationPending: true });

    const rows = await sql(w, (s) => s.exec('SELECT status, envelope IS NOT NULL AS has, label FROM accounts').toArray());
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toEqual({ status: 'revocation_pending', has: 1, label: '' });
    const counts = await sql(w, (s) => ({
      grants: s.exec('SELECT COUNT(*) AS n FROM grants').one().n,
      usage: s.exec('SELECT COUNT(*) AS n FROM usage').one().n,
      idem: s.exec('SELECT COUNT(*) AS n FROM idem').one().n,
      transfers: s.exec('SELECT COUNT(*) AS n FROM transfers').one().n
    }));
    expect(counts).toEqual({ grants: 0, usage: 0, idem: 0, transfers: 0 });

    // No MCP access at any point.
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_accounts', {}))).toBe('FORBIDDEN');
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('FORBIDDEN');
    expect((await fetchFile(d.intentId, d.capability)).status).toBeGreaterThanOrEqual(400);
    const refused = (p: Promise<unknown>) => p.then(() => false, () => true);
    expect(await refused(stub.putGrant(w.principalId, { grantId: crypto.randomUUID(), accounts: [], scopes: [], version: 1 }))).toBe(true);
    expect(await refused(stub.startLink(w.principalId, crypto.randomUUID()))).toBe(true);
    expect(syntheticControl.opens).toBe(0);

    // Telegram reachable again: the alarm logs both out and wipes everything.
    syntheticControl.logoutFails = false;
    await runDurableObjectAlarm(stub);
    expect(syntheticControl.logouts).toBe(2);
    expect(await sql(w, (s) => s.exec('SELECT COUNT(*) AS n FROM accounts').one().n)).toBe(0);
    expect(errCode(await callTool(w.token, 'list_accounts', {}))).toBe('FORBIDDEN');
  });

  it('a repeated deletePrincipal is idempotent and completes the logout when Telegram is back', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    syntheticControl.logoutFails = true;
    expect(await stub.deletePrincipal(w.principalId)).toEqual({ ok: true, revocationPending: true });
    syntheticControl.logoutFails = false;
    expect(await stub.deletePrincipal(w.principalId)).toEqual({ ok: true, revocationPending: false });
    expect(syntheticControl.logouts).toBe(1);
    expect(await sql(w, (s) => s.exec('SELECT COUNT(*) AS n FROM accounts').one().n)).toBe(0);
  });

  it('gives up after the deadline: the envelope is dropped and the object is fully wiped', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    syntheticControl.logoutFails = true;
    await stub.deletePrincipal(w.principalId);
    await runDurableObjectAlarm(stub);
    expect(await sql(w, (s) => s.exec('SELECT COUNT(*) AS n FROM accounts').one().n)).toBe(1);
    await sql(w, (s) => s.exec('UPDATE accounts SET status_at = ?', Date.now() - 8 * DAY));
    await runDurableObjectAlarm(stub);
    expect(await sql(w, (s) => s.exec('SELECT COUNT(*) AS n FROM accounts').one().n)).toBe(0);
    expect(errCode(await callTool(w.token, 'list_accounts', {}))).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------------------------- 6
describe('finding 6: KEK rotation', () => {
  async function resealWith(w: World, accountId: string, kek: CryptoKey, version: string): Promise<void> {
    const keys = await loadKeys(env);
    const ctx = { principalId: w.principalId, accountId };
    const cur = (await one<{ envelope: string }>(w, 'SELECT envelope FROM accounts WHERE account_id = ?', accountId)).envelope;
    const plain = await openSession(JSON.parse(cur) as SessionEnvelope, ctx, keys.keks);
    const next = JSON.stringify(await sealSession(plain, ctx, kek, version));
    await sql(w, (s) => s.exec('UPDATE accounts SET envelope = ? WHERE account_id = ?', next, accountId));
  }
  const kvOf = async (w: World, accountId: string) =>
    (JSON.parse((await one<{ envelope: string }>(w, 'SELECT envelope FROM accounts WHERE account_id = ?', accountId)).envelope) as SessionEnvelope).kv;
  const prevKek = () => importAesKey(env.SESSION_KEK_PREVIOUS as string, 'kek');

  it('an envelope under the previous KEK is rewrapped to the current version on use', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    await resealWith(w, acc, await prevKek(), 'test-k0');
    expect(await kvOf(w, acc)).toBe('test-k0');
    expect((await callTool(w.token, 'list_dialogs', { account_id: acc })).isError).toBe(false);
    expect(await kvOf(w, acc)).toBe('test-k1');
  });

  it('the alarm sweep rewraps idle envelopes', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    await resealWith(w, acc, await prevKek(), 'test-k0');
    await runDurableObjectAlarm(principalStub(w.principalId));
    expect(await kvOf(w, acc)).toBe('test-k1');
  });

  it('an undecryptable envelope is never silently marked revoked: it stays revocation_pending and unusable', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    const stub = principalStub(w.principalId);
    await resealWith(w, acc, await importAesKey(randomToken(32), 'kek'), 'removed-kek');

    // Use is refused with a safe code, status untouched.
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: acc }))).toBe('ACCOUNT_NOT_ACTIVE');
    expect(syntheticControl.opens).toBe(0);
    expect((await one<{ status: string }>(w, 'SELECT status FROM accounts')).status).toBe('active');

    expect(await stub.disconnectAccount(w.principalId, acc)).toEqual({ telegramLoggedOut: false });
    expect(await one(w, 'SELECT status, envelope IS NOT NULL AS has FROM accounts')).toEqual({ status: 'revocation_pending', has: 1 });
    await runDurableObjectAlarm(stub);
    expect(await one(w, 'SELECT status, envelope IS NOT NULL AS has FROM accounts')).toEqual({ status: 'revocation_pending', has: 1 });
    expect(syntheticControl.logouts).toBe(0);

    await sql(w, (s) => s.exec('UPDATE accounts SET status_at = ?', Date.now() - 8 * DAY));
    await runDurableObjectAlarm(stub);
    expect(await one(w, 'SELECT status, envelope IS NOT NULL AS has FROM accounts')).toEqual({ status: 'disconnected', has: 0 });
  });
});

// ---------------------------------------------------------------------------------------------- 7
describe('finding 7: Content-Disposition never throws', () => {
  it('119 ASCII chars plus an emoji do not cut the surrogate pair', () => {
    const h = safeDisposition(`${'a'.repeat(119)}\u{1F600}.txt`);
    expect(h).toContain("filename*=UTF-8''" + 'a'.repeat(119) + '%F0%9F%98%80');
  });

  it('a lone surrogate in the source name falls back instead of throwing', () => {
    expect(() => safeDisposition('x\uD800y.bin')).not.toThrow();
    expect(safeDisposition('\uD800')).toContain("filename*=UTF-8''");
  });
});
