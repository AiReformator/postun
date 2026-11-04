import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { importAesKey, openSession, randomToken, sealSession, utf8, type LinkState, type SessionEnvelope } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { SYNTH_SESSION_MARKER, syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, principalStub, setupWorld } from './helpers';

async function link(principalId: string, accountId: string, password?: string): Promise<LinkState> {
  const stub = principalStub(principalId);
  let st = await stub.startLink(principalId, accountId);
  for (let i = 0; i < 100; i++) {
    if (st.state === 'authorized' || st.state === 'failed') return st;
    if (st.state === 'need_password' && password !== undefined) st = await stub.submitPassword(principalId, accountId, password);
    else {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(principalId, accountId);
    }
  }
  return st;
}

describe('QR link flow', () => {
  it('goes waiting_scan -> authorized with a masked label and a decimal telegram id', async () => {
    syntheticControl.reset();
    syntheticControl.nextTelegramId = '9007199254740991';
    const principalId = crypto.randomUUID();
    const stub = principalStub(principalId);
    const accountId = crypto.randomUUID();
    const first = await stub.startLink(principalId, accountId);
    expect(first.state).toBe('waiting_scan');
    const done = await link(principalId, accountId);
    expect(done).toEqual({ state: 'authorized', telegramId: '9007199254740991', label: 'A•••' });
    // pending is not usable until activated
    expect((await stub.linkStatus(principalId, accountId)).state).toBe('authorized');
    await stub.activateAccount(principalId, accountId);
    expect((await stub.activateAccount(principalId, accountId)).ok).toBe(true); // idempotent
  });

  it('handles 2FA: a wrong password re-prompts, the right one authorizes; the password is never stored', async () => {
    syntheticControl.reset();
    syntheticControl.require2fa = true;
    const principalId = crypto.randomUUID();
    const stub = principalStub(principalId);
    const accountId = crypto.randomUUID();
    let st = await stub.startLink(principalId, accountId);
    for (let i = 0; i < 100 && st.state !== 'need_password'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(principalId, accountId);
    }
    expect(st.state).toBe('need_password');
    st = await stub.submitPassword(principalId, accountId, 'SYNTH-WRONG-PASSWORD');
    expect(st.state).toBe('need_password');
    st = await stub.submitPassword(principalId, accountId, 'synthetic-password');
    expect(st.state).toBe('authorized');
    const dump = await runInDurableObject(stub, (_i, s) => JSON.stringify(s.storage.sql.exec('SELECT * FROM accounts').toArray()));
    expect(dump).not.toContain('SYNTH-WRONG-PASSWORD');
    expect(dump).not.toContain('synthetic-password');
  });

  it('gives up after repeated wrong passwords', async () => {
    syntheticControl.reset();
    syntheticControl.require2fa = true;
    const principalId = crypto.randomUUID();
    const stub = principalStub(principalId);
    const accountId = crypto.randomUUID();
    let st = await stub.startLink(principalId, accountId);
    for (let i = 0; i < 20 && st.state !== 'failed'; i++) {
      if (st.state === 'need_password') st = await stub.submitPassword(principalId, accountId, 'SYNTH-WRONG');
      else {
        await new Promise((r) => setTimeout(r, 10));
        st = await stub.linkStatus(principalId, accountId);
      }
    }
    expect(st).toEqual({ state: 'failed', code: 'PASSWORD_INVALID' });
  });

  it('an unknown account reports unknown; a stale pending one reports EXPIRED', async () => {
    const principalId = crypto.randomUUID();
    const stub = principalStub(principalId);
    expect(await stub.linkStatus(principalId, crypto.randomUUID())).toEqual({ state: 'unknown' });
    const stale = crypto.randomUUID();
    await runInDurableObject(stub, (_i, s) => s.storage.sql.exec("INSERT INTO accounts(account_id, status, label, envelope, created_at, status_at) VALUES(?, 'pending', '', NULL, 1, 1)", stale));
    expect(await stub.linkStatus(principalId, stale)).toEqual({ state: 'failed', code: 'EXPIRED' });
  });

  it('refuses to start a link for an account that is already active, and objects are bound to one principal', async () => {
    const w = await setupWorld();
    const fails = async (p: Promise<unknown>) => p.then(() => false, () => true);
    expect(await fails(principalStub(w.principalId).startLink(w.principalId, w.accountIds[0] as string))).toBe(true);
    // Same DO addressed with a different principal id in the arguments.
    expect(await fails(principalStub(w.principalId).startLink(crypto.randomUUID(), crypto.randomUUID()))).toBe(true);
  });
});

describe('MT-01 session envelope at rest', () => {
  it('ciphertext contains no plaintext marker and survives eviction of the DO', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const rows = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT * FROM accounts').toArray());
    const text = JSON.stringify(rows);
    expect(text).not.toContain(SYNTH_SESSION_MARKER);
    expect(text).not.toContain('synthetic:');
    expect(JSON.parse(rows[0]?.envelope as string)).toMatchObject({ v: 1, kv: 'test-k1', t: 'telegram-session' });
    await evictDurableObject(stub);
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 3 });
    expect(r.isError).toBe(false);
    expect((r.data.dialogs as unknown[]).length).toBe(3);
  });

  it('the envelope is bound to principal and account (AAD): a copy under another account id does not open', async () => {
    const w = await setupWorld({ accounts: 2 });
    const stub = principalStub(w.principalId);
    const [a1, a2] = w.accountIds as [string, string];
    await runInDurableObject(stub, (_i, s) => {
      const e = s.storage.sql.exec('SELECT envelope FROM accounts WHERE account_id = ?', a1).one().envelope as string;
      s.storage.sql.exec('UPDATE accounts SET envelope = ? WHERE account_id = ?', e, a2);
    });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: a2 }))).toBe('ACCOUNT_NOT_ACTIVE');
    expect((await callTool(w.token, 'list_dialogs', { account_id: a1 })).isError).toBe(false);
  });

  it('opens an envelope sealed under the previous KEK version (rotation window)', async () => {
    const { loadKeys } = await import('../src/config');
    const keys = await loadKeys(env);
    const oldSecret = randomToken(32);
    const oldKek = await importAesKey(oldSecret, 'kek');
    const ctx = { principalId: crypto.randomUUID(), accountId: crypto.randomUUID() };
    const sealed = await sealSession(utf8('x'), ctx, oldKek, 'old-version');
    expect(keys.keks.has('old-version')).toBe(false);
    const rotated = new Map(keys.keks).set('old-version', oldKek);
    expect(new TextDecoder().decode(await openSession(sealed as SessionEnvelope, ctx, rotated))).toBe('x');
    await expect(openSession(sealed as SessionEnvelope, ctx, keys.keks)).rejects.toThrow();
  });
});

describe('disconnect and revocation', () => {
  it('logs out on Telegram, deletes the envelope and refuses further use', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const res = await stub.disconnectAccount(w.principalId, w.accountIds[0] as string);
    expect(res).toEqual({ telegramLoggedOut: true });
    expect(syntheticControl.logouts).toBe(1);
    const row = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT status, envelope FROM accounts').one());
    expect(row).toEqual({ status: 'disconnected', envelope: null });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('Telegram unreachable: revocation_pending, key never used for reads, retried by the alarm', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    syntheticControl.logoutFails = true;
    expect(await stub.disconnectAccount(w.principalId, w.accountIds[0] as string)).toEqual({ telegramLoggedOut: false });
    const row = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT status FROM accounts').one().status);
    expect(row).toBe('revocation_pending');
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('ACCOUNT_NOT_ACTIVE');
    expect(syntheticControl.opens).toBe(0);
    syntheticControl.logoutFails = false;
    await runDurableObjectAlarm(stub);
    const after = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT status, envelope FROM accounts').one());
    expect(after).toEqual({ status: 'disconnected', envelope: null });
  });

  it('deletePrincipal logs everything out, wipes storage and keeps refusing the principal', async () => {
    const w = await setupWorld({ accounts: 2 });
    const stub = principalStub(w.principalId);
    await stub.deletePrincipal(w.principalId);
    expect(syntheticControl.logouts).toBe(2);
    const tables = await runInDurableObject(stub, (_i, s) => ({
      accounts: s.storage.sql.exec('SELECT COUNT(*) AS n FROM accounts').one().n,
      grants: s.storage.sql.exec('SELECT COUNT(*) AS n FROM grants').one().n,
      usage: s.storage.sql.exec('SELECT COUNT(*) AS n FROM usage').one().n
    }));
    expect(tables).toEqual({ accounts: 0, grants: 0, usage: 0 });
    expect(errCode(await callTool(w.token, 'list_accounts', {}))).toBe('FORBIDDEN');
    const refused = await stub.putGrant(w.principalId, { grantId: crypto.randomUUID(), accounts: [], scopes: [], version: 1 }).then(() => false, () => true);
    expect(refused).toBe(true);
  });
});

describe('admin projection', () => {
  it('sends absolute aggregate values with a growing revision and no content', async () => {
    const w = await setupWorld();
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    await new Promise((r) => setTimeout(r, 50));
    const all = (await (env.ADMIN_SINK as unknown as { all(): Promise<Record<string, unknown>[]> }).all()).filter((p) => p.principalRef === w.principalId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const last = all[all.length - 1]!;
    expect(last).toMatchObject({ principalRef: w.principalId, linkedAccounts: 1, status: 'active', plan: 'beta_free', successCount: 2, outBytes: 0 });
    const revs = all.map((p) => p.revision as number);
    expect([...revs].sort((a, b) => a - b)).toEqual(revs);
    expect(Object.keys(last).sort()).toEqual(['linkedAccounts', 'month', 'outBytes', 'plan', 'principalRef', 'revision', 'status', 'successCount']);
  });

  it('a missing or failing sink never breaks the operation', async () => {
    const w = await setupWorld();
    await runInDurableObject(principalStub(w.principalId), (inst) => {
      (inst as unknown as { env: Record<string, unknown> }).env = { ...(inst as unknown as { env: object }).env, ADMIN_SINK: { upsert: () => Promise.reject(new Error('SECRET-SINK-ERROR')) } };
    });
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] })).isError).toBe(false);
  });
});
