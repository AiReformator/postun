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
    expect(st).toEqual({ state: 'need_password', hint: null, invalidAttempts: 0 });
    st = await stub.submitPassword(principalId, accountId, 'SYNTH-WRONG-PASSWORD');
    expect(st).toEqual({ state: 'need_password', hint: null, invalidAttempts: 1 });
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

describe('session ended by Telegram and reconnect', () => {
  async function relink(principalId: string, accountId: string): Promise<LinkState> {
    const stub = principalStub(principalId);
    let st = await stub.startRelink(principalId, accountId);
    for (let i = 0; i < 100 && st.state !== 'authorized' && st.state !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(principalId, accountId);
    }
    return st;
  }

  it('marks the account ended, explains it to the AI, and stops opening the dead session', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    const r = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect(errCode(r)).toBe('ACCOUNT_NOT_ACTIVE');
    const err = r.data.error as { reason?: string; hint?: string };
    expect(err.reason).toBe('SESSION_ENDED');
    expect(err.hint).toContain('Reconnect');
    expect(await stub.endedAccounts(w.principalId)).toEqual([acc]);
    const list = await callTool(w.token, 'list_accounts', {});
    expect((list.data.accounts as { status: string }[])[0]?.status).toBe('ended');
    // Later calls are refused before Telegram is contacted, with the same explanation.
    const opens = syntheticControl.opens;
    const again = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect((again.data.error as { reason?: string }).reason).toBe('SESSION_ENDED');
    expect(syntheticControl.opens).toBe(opens);
  });

  it('a Postun-side refusal (undecryptable envelope) is not mistaken for an ended session', async () => {
    const w = await setupWorld({ accounts: 2 });
    const stub = principalStub(w.principalId);
    const [a1, a2] = w.accountIds as [string, string];
    await runInDurableObject(stub, (_i, s) => {
      const e = s.storage.sql.exec('SELECT envelope FROM accounts WHERE account_id = ?', a1).one().envelope as string;
      s.storage.sql.exec('UPDATE accounts SET envelope = ? WHERE account_id = ?', e, a2);
    });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: a2 }))).toBe('ACCOUNT_NOT_ACTIVE');
    expect(await stub.endedAccounts(w.principalId)).toEqual([]);
  });

  it('reconnecting with the same Telegram user keeps the account id and the grant', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    syntheticControl.sessionsEnded = false;
    const stub = principalStub(w.principalId);
    const fails = async (p: Promise<unknown>) => p.then(() => false, () => true);
    expect(await fails(stub.startLink(w.principalId, acc))).toBe(true); // a first link can never overwrite it
    const st = await relink(w.principalId, acc);
    expect(st).toEqual({ state: 'authorized', telegramId: '700000001', label: 'A•••' });
    expect(await stub.endedAccounts(w.principalId)).toEqual([]);
    const r = await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 2 });
    expect(r.isError).toBe(false); // the same token and grant work again
    const row = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT status FROM accounts WHERE account_id = ?', acc).one());
    expect(row).toEqual({ status: 'active' });
  });

  it('another Telegram user cannot take over the account: NOT_ALLOWED, the new session is logged out', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    syntheticControl.sessionsEnded = false;
    syntheticControl.nextTelegramId = '700000999';
    const st = await relink(w.principalId, acc);
    expect(st).toEqual({ state: 'failed', code: 'NOT_ALLOWED' });
    expect(syntheticControl.logouts).toBe(1);
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([acc]);
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: acc }))).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('AUTH_KEY_DUPLICATED refuses the call but does not mark the account ended', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.throwNext = Object.assign(new Error('x'), { text: 'AUTH_KEY_DUPLICATED', code: 406 });
    const r = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect(errCode(r)).toBe('ACCOUNT_NOT_ACTIVE');
    expect((r.data.error as { reason?: string }).reason).toBeUndefined();
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([]);
    expect((await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 2 })).isError).toBe(false);
  });

  it('only an ended account can be reconnected', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const fails = async (p: Promise<unknown>) => p.then(() => false, () => true);
    expect(await fails(stub.startRelink(w.principalId, w.accountIds[0] as string))).toBe(true);
    expect(await fails(stub.startRelink(w.principalId, crypto.randomUUID()))).toBe(true);
  });

  it('an ended account can still be disconnected', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    const stub = principalStub(w.principalId);
    await stub.disconnectAccount(w.principalId, acc);
    const row = await runInDurableObject(stub, (_i, s) => s.storage.sql.exec('SELECT status, envelope FROM accounts WHERE account_id = ?', acc).one());
    expect(row).toEqual({ status: 'disconnected', envelope: null });
  });
});

describe('connection journal (docs/03 section 4)', () => {
  type Ev = { at: string; event: string; code: string | null; source: string | null };
  const events = (principalId: string, accountId: string): Promise<Ev[]> => principalStub(principalId).accountEvents(principalId, accountId);
  const tg = (text: string, code: number) => Object.assign(new Error('x'), { text, code });
  const armAlarm = (principalId: string) => runInDurableObject(principalStub(principalId), (_i, st) => st.storage.setAlarm(Date.now() + 5));

  it('records why a session ended (the Telegram error name) and which tool found out', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    const r = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect((r.data.error as { reason?: string }).reason).toBe('SESSION_ENDED');
    const ev = await events(w.principalId, acc);
    expect(ev[0]).toMatchObject({ event: 'session_ended', code: 'AUTH_KEY_UNREGISTERED', source: 'list_dialogs' });
    expect(await principalStub(w.principalId).endedDetails(w.principalId)).toEqual([
      { accountId: acc, endedAt: expect.any(Number), code: 'AUTH_KEY_UNREGISTERED' }
    ]);
    // The Telegram error name stays on the server: clients only see the fixed code, reason and hint.
    expect(r.raw).not.toContain('sessionError');
    expect(r.raw).not.toContain('AUTH_KEY_UNREGISTERED');
  });

  it('tells a session closed in Devices apart from a deactivated account, with different fixed hints', async () => {
    const w = await setupWorld({ accounts: 2 });
    const [a1, a2] = w.accountIds as [string, string];
    syntheticControl.throwNext = tg('SESSION_REVOKED', 401);
    const revoked = await callTool(w.token, 'list_dialogs', { account_id: a1 });
    expect((revoked.data.error as { hint?: string }).hint).toContain('Devices list');
    syntheticControl.throwNext = tg('USER_DEACTIVATED', 401);
    const gone = await callTool(w.token, 'list_dialogs', { account_id: a2 });
    expect((gone.data.error as { hint?: string }).hint).toContain('Reconnecting will not help');
    expect((await events(w.principalId, a1))[0]).toMatchObject({ event: 'session_ended', code: 'SESSION_REVOKED' });
    expect((await events(w.principalId, a2))[0]).toMatchObject({ event: 'session_ended', code: 'USER_DEACTIVATED' });
  });

  it('journals AUTH_KEY_DUPLICATED without ending the account, and checks the key soon', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.throwNext = tg('AUTH_KEY_DUPLICATED', 406);
    const r = await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect((r.data.error as { reason?: string }).reason).toBeUndefined();
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([]);
    expect((await events(w.principalId, acc))[0]).toMatchObject({ event: 'key_duplicate', code: 'AUTH_KEY_DUPLICATED', source: 'list_dialogs' });
    // The key is fine: the prompt health check finds nothing wrong and ends nothing.
    const ops = syntheticControl.ops;
    expect(await runDurableObjectAlarm(principalStub(w.principalId))).toBe(true);
    expect(syntheticControl.ops).toBe(ops + 1);
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([]);
  });

  it('after a duplicated key that Telegram then invalidated, the health check marks the account ended and says why', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.throwNext = tg('AUTH_KEY_DUPLICATED', 406);
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    syntheticControl.sessionsEnded = true; // Telegram has now dropped the key
    await runDurableObjectAlarm(principalStub(w.principalId));
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([acc]);
    const ev = await events(w.principalId, acc);
    expect(ev.map((e) => [e.event, e.code, e.source])).toEqual([
      ['session_ended', 'AUTH_KEY_UNREGISTERED', 'health_check'],
      ['key_duplicate', 'AUTH_KEY_DUPLICATED', 'list_dialogs'],
      ['linked', null, 'link']
    ]);
  });

  it('the periodic health check notices an ended session before any AI call, once per period', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await armAlarm(w.principalId);
    expect(await runDurableObjectAlarm(principalStub(w.principalId))).toBe(true);
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([acc]);
    expect((await events(w.principalId, acc))[0]).toMatchObject({ event: 'session_ended', source: 'health_check' });
    const list = await callTool(w.token, 'list_accounts', {});
    expect((list.data.accounts as { status: string }[])[0]?.status).toBe('ended'); // no stale "active" for the next client
  });

  it('does not repeat the health check within its period and skips an ended account', async () => {
    const w = await setupWorld();
    await armAlarm(w.principalId);
    const ops = syntheticControl.ops;
    await runDurableObjectAlarm(principalStub(w.principalId));
    expect(syntheticControl.ops).toBe(ops + 1);
    await armAlarm(w.principalId);
    await runDurableObjectAlarm(principalStub(w.principalId));
    expect(syntheticControl.ops).toBe(ops + 1); // still inside the period
  });

  it('a transient failure of the health check ends nothing and writes nothing', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.throwNext = new Error('network down');
    await armAlarm(w.principalId);
    await runDurableObjectAlarm(principalStub(w.principalId));
    expect(await principalStub(w.principalId).endedAccounts(w.principalId)).toEqual([]);
    expect((await events(w.principalId, acc)).map((e) => e.event)).toEqual(['linked']); // nothing added by the failed check
  });

  it('a reconnect is journaled and clears the reason; a refused reconnect is journaled too', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    const stub = principalStub(w.principalId);
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    syntheticControl.sessionsEnded = false;
    syntheticControl.nextTelegramId = '700000999';
    let st = await stub.startRelink(w.principalId, acc);
    for (let i = 0; i < 100 && st.state !== 'authorized' && st.state !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(w.principalId, acc);
    }
    expect(st).toEqual({ state: 'failed', code: 'NOT_ALLOWED' });
    expect((await events(w.principalId, acc))[0]).toMatchObject({ event: 'relink_refused', source: 'relink' });
    syntheticControl.nextTelegramId = '700000001';
    st = await stub.startRelink(w.principalId, acc);
    for (let i = 0; i < 100 && st.state !== 'authorized' && st.state !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await stub.linkStatus(w.principalId, acc);
    }
    expect(st.state).toBe('authorized');
    expect((await events(w.principalId, acc))[0]).toMatchObject({ event: 'relinked', source: 'relink' });
    expect(await stub.endedDetails(w.principalId)).toEqual([]);
    const row = await runInDurableObject(stub, (_i, d) => d.storage.sql.exec('SELECT ended_at, ended_code FROM accounts WHERE account_id = ?', acc).one());
    expect(row).toEqual({ ended_at: null, ended_code: null });
  });

  it('keeps only the newest 100 events per account', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    await runInDurableObject(principalStub(w.principalId), (inst) => {
      const j = inst as unknown as { recordEvent(a: string, e: string, c: string | null, s: string | null): void };
      for (let i = 0; i < 105; i++) j.recordEvent(acc, 'key_duplicate', 'AUTH_KEY_DUPLICATED', 'list_dialogs');
    });
    const all = await principalStub(w.principalId).accountEvents(w.principalId, acc, 1000);
    expect(all).toHaveLength(100);
  });

  it('the alarm ages out events older than the retention period', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    await runInDurableObject(principalStub(w.principalId), (_i, st) => {
      st.storage.sql.exec("INSERT INTO account_events(account_id, at, event, code, source) VALUES(?, ?, 'session_ended', 'SESSION_REVOKED', 'list_dialogs')", acc, Date.now() - 181 * 24 * 3600 * 1000);
      st.storage.sql.exec("INSERT INTO account_events(account_id, at, event, code, source) VALUES(?, ?, 'session_ended', 'SESSION_REVOKED', 'list_dialogs')", acc, Date.now() - 1000);
    });
    await armAlarm(w.principalId);
    await runDurableObjectAlarm(principalStub(w.principalId));
    const left = (await events(w.principalId, acc)).filter((e) => e.event === 'session_ended');
    expect(left).toHaveLength(1); // the 181-day-old one is gone, the recent one stays
  });

  it('disconnecting an account deletes its journal', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    expect((await events(w.principalId, acc)).map((e) => e.event)).toEqual(['session_ended', 'linked']);
    await principalStub(w.principalId).disconnectAccount(w.principalId, acc);
    expect(await events(w.principalId, acc)).toEqual([]);
  });

  it('stores nothing but the closed vocabulary: no content, queries, peers or Telegram text', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.throwNext = Object.assign(new Error('RAW-SECRET +10000000000 message text'), { text: 'AUTH_KEY_DUPLICATED RAW-SECRET', code: 406 });
    await callTool(w.token, 'search_messages', { account_id: acc, query: 'SYNTH-QUERY-PRIVATE' });
    syntheticControl.throwNext = tg('SESSION_REVOKED', 401);
    await callTool(w.token, 'list_dialogs', { account_id: acc });
    const dump = await runInDurableObject(principalStub(w.principalId), (_i, st) => JSON.stringify(st.storage.sql.exec('SELECT * FROM account_events').toArray()));
    expect(dump).not.toContain('RAW-SECRET');
    expect(dump).not.toContain('SYNTH');
    expect(dump).not.toContain('PRIVATE');
    const rows = JSON.parse(dump) as { event: string; code: string | null; source: string | null }[];
    for (const r of rows) {
      expect(['linked', 'session_ended', 'key_duplicate', 'relinked', 'relink_refused']).toContain(r.event);
      expect([null, 'AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED', 'SESSION_EXPIRED', 'AUTH_KEY_DUPLICATED']).toContain(r.code);
    }
  });

  it('migrates an existing non-empty object additively: accounts, grants and an ended session survive', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0] as string;
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: acc }); // ended before the journal existed, in this rehearsal
    const stub = principalStub(w.principalId);
    // Put the object back into the previous schema: no journal table, no ended_code column.
    await runInDurableObject(stub, (inst, st) => {
      st.storage.sql.exec('DROP TABLE account_events');
      st.storage.sql.exec('ALTER TABLE accounts DROP COLUMN ended_code');
      (inst as unknown as { schemaReady: boolean }).schemaReady = false;
    });
    expect(await stub.endedAccounts(w.principalId)).toEqual([acc]);
    expect(await stub.endedDetails(w.principalId)).toEqual([{ accountId: acc, endedAt: expect.any(Number), code: null }]); // old row: no reason recorded
    expect(await stub.accountEvents(w.principalId, acc)).toEqual([]);
    const cols = await runInDurableObject(stub, (_i, st) => st.storage.sql.exec('SELECT name FROM pragma_table_info(\'accounts\')').toArray().map((r) => r.name));
    expect(cols).toContain('ended_code');
    syntheticControl.sessionsEnded = false;
    const r = await callTool(w.token, 'list_accounts', {});
    expect((r.data.accounts as { status: string }[])[0]?.status).toBe('ended'); // the grant and the account are intact
  });

  it('refuses a malformed account id and returns nothing for an unknown one', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    expect(await stub.accountEvents(w.principalId, crypto.randomUUID())).toEqual([]);
    const fails = async (p: Promise<unknown>) => p.then(() => false, () => true);
    expect(await fails(stub.accountEvents(w.principalId, 'not-a-uuid'))).toBe(true);
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
