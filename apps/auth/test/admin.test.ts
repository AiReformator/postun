import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminActor } from '@postun/contracts';
import { AdminControl } from '../src/admin';
import { runScheduled } from '../src/cron';
import type { Env } from '../src/env';
import { FakeVault, count, db, installFetchMock, login, makeEnv, newTelegram, resetDb } from './helpers';
import type { Telegram } from './helpers';

let tg: Telegram;
beforeEach(async () => {
  await resetDb();
  tg = await newTelegram();
  installFetchMock(tg);
});
afterEach(() => vi.restoreAllMocks());

const actor = (role: string): AdminActor => ({ issuer: 'https://idp.example', subject: 'admin-subject-1', role: role as AdminActor['role'] });
const admin = (e: Env): AdminControl => new AdminControl({} as ExecutionContext, e);

async function principal(e: Env): Promise<string> {
  await login(e, tg);
  return (await db().prepare('SELECT principal_id FROM principals').first<{ principal_id: string }>())?.principal_id as string;
}

describe('AdminControl', () => {
  it('rejects the viewer role (and any unknown role) without changing state, auditing the denial', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const pid = await principal(e);
    for (const role of ['postun.viewer', 'viewer', '']) {
      expect(await admin(e).suspend(actor(role), pid)).toEqual({ ok: false });
    }
    expect(vault.calls).toEqual([]);
    expect((await db().prepare('SELECT status FROM principals').first<{ status: string }>())?.status).toBe('active');
    const audit = await db().prepare('SELECT * FROM admin_audit').all<Record<string, unknown>>();
    expect(audit.results).toHaveLength(3);
    expect(audit.results.every((r) => r['outcome'] === 'denied' && r['action_code'] === 'principal.suspend')).toBe(true);
    expect(JSON.stringify(audit.results)).not.toContain('admin-subject-1'); // subject is hashed
  });

  it('operator/owner can suspend and resume; vault deny state is written first on suspend', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const pid = await principal(e);
    vault.hooks['setSuspended'] = async () => {
      const row = await db().prepare('SELECT status FROM principals WHERE principal_id = ?1').bind(pid).first<{ status: string }>();
      if (vault.calls.at(-1) === 'setSuspended:true') expect(row?.status).toBe('active');
    };
    expect(await admin(e).suspend(actor('postun.operator'), pid)).toEqual({ ok: true });
    expect((await db().prepare('SELECT status FROM principals').first<{ status: string }>())?.status).toBe('suspended');
    expect(await admin(e).resume(actor('postun.owner'), pid)).toEqual({ ok: true });
    expect((await db().prepare('SELECT status FROM principals').first<{ status: string }>())?.status).toBe('active');
    expect(vault.calls).toEqual(['setSuspended:true', 'setSuspended:false']);
    expect(await count('admin_audit')).toBe(2);
  });

  it('does not touch unknown or deleted principals and survives a vault failure without a half state', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    expect(await admin(e).suspend(actor('postun.owner'), crypto.randomUUID())).toEqual({ ok: false });
    expect(await admin(e).suspend(actor('postun.owner'), 'not-a-uuid')).toEqual({ ok: false });
    const pid = await principal(e);
    vault.failOn.add('setSuspended');
    expect(await admin(e).suspend(actor('postun.owner'), pid)).toEqual({ ok: false });
    expect((await db().prepare('SELECT status FROM principals').first<{ status: string }>())?.status).toBe('active');
    const outcomes = (await db().prepare('SELECT outcome FROM admin_audit ORDER BY id').all<{ outcome: string }>()).results.map((r) => r.outcome);
    expect(outcomes).toEqual(['not_found', 'denied', 'error']);
  });
});

describe('scheduled retention', () => {
  it('purges expired login states, sessions and audit rows older than 30 days', async () => {
    const vault = new FakeVault();
    const e = makeEnv({}, vault);
    const pid = await principal(e);
    const t = Math.floor(Date.now() / 1000);
    await db().prepare("INSERT INTO login_states VALUES ('old','b','n','v',NULL,1,2)").run();
    await db().prepare("INSERT INTO login_states VALUES ('fresh','b','n','v',NULL,?1,?2)").bind(t, t + 600).run();
    await db().prepare("INSERT INTO web_sessions VALUES ('expired',?1,1,1,2,3)").bind(pid).run();
    await db().prepare("INSERT INTO admin_audit (actor_hash,action_code,target_ref,outcome,created_at) VALUES ('a','x','y','ok',?1),('a','x','y','ok',?2)").bind(t - 31 * 86400, t).run();
    await db()
      .prepare("INSERT INTO linked_accounts (account_id,principal_id,status,operation_id,created_at,updated_at) VALUES ('stale',?1,'pending','op-stale',?2,?2)")
      .bind(pid, t - 7200)
      .run();
    await runScheduled(e);
    expect((await db().prepare('SELECT state_hash FROM login_states').all<{ state_hash: string }>()).results.map((r) => r.state_hash)).toEqual(['fresh']);
    expect(await count('admin_audit')).toBe(1);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM web_sessions WHERE session_hash = 'expired'").first<{ n: number }>())?.n).toBe(0);
    expect((await db().prepare("SELECT status FROM linked_accounts WHERE account_id = 'stale'").first<{ status: string }>())?.status).toBe('disconnected');
    expect(vault.calls).toContain('disconnectAccount:stale');
  });

  it('the default entrypoint wires scheduled()', async () => {
    const { default: AuthServer } = await import('../src/index');
    const e = makeEnv();
    await db().prepare("INSERT INTO login_states VALUES ('old','b','n','v',NULL,1,2)").run();
    await new AuthServer({} as ExecutionContext, e).scheduled();
    expect(await count('login_states')).toBe(0);
    expect(env).toBeTruthy();
  });
});
