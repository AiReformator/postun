import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { count, db, resetDb } from './helpers';

const e = env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(resetDb);

describe('CI-02 migration on non-empty synthetic data', () => {
  it('preserves ids, relations and constraints when 0001 is re-applied', async () => {
    const t = 1_800_000_000;
    await db().batch([
      db().prepare("INSERT INTO principals (principal_id, oidc_issuer, oidc_subject, primary_telegram_id_hmac, status, plan, accepted_terms_version, created_at) VALUES ('p1','iss','s1','h1','active','beta_free','v1',?1)").bind(t),
      db().prepare("INSERT INTO linked_accounts (account_id, principal_id, telegram_id_hmac, status, label, operation_id, created_at, updated_at) VALUES ('a1','p1','tg1','active','L','op1',?1,?1)").bind(t),
      db().prepare("INSERT INTO grant_reference (grant_id, principal_id, client_id, accounts_json, scopes_json, version, status, created_at, updated_at) VALUES ('g1','p1','c1','[\"a1\"]','[\"accounts:read\"]',3,'active',?1,?1)").bind(t),
      db().prepare("INSERT INTO web_sessions VALUES ('sh1','p1',?1,?1,?2,?2)").bind(t, t + 10),
      db().prepare("INSERT INTO entitlements (principal_id, plan, valid_from) VALUES ('p1','beta_free',?1)").bind(t)
    ]);
    // Tracked re-apply is a no-op; a raw re-execution of every statement must also be safe (IF NOT EXISTS).
    await applyD1Migrations(db(), e.TEST_MIGRATIONS);
    for (const m of e.TEST_MIGRATIONS) for (const q of m.queries) await db().prepare(q).run();
    expect(await count('principals')).toBe(1);
    expect(await count('linked_accounts')).toBe(1);
    const g = await db().prepare('SELECT version, accounts_json FROM grant_reference').first<{ version: number; accounts_json: string }>();
    expect(g).toEqual({ version: 3, accounts_json: '["a1"]' });
    expect(await count('web_sessions')).toBe(1);
    expect(await count('entitlements')).toBe(1);
  });

  it('enforces telegram_id_hmac and operation_id uniqueness, and principal identity uniqueness', async () => {
    const t = 1_800_000_000;
    await db().prepare("INSERT INTO principals (principal_id, oidc_issuer, oidc_subject, created_at) VALUES ('p1','iss','s1',?1),('p2','iss','s2',?1)").bind(t).run();
    const acc = (id: string, p: string, h: string | null, op: string) =>
      db().prepare("INSERT INTO linked_accounts (account_id, principal_id, telegram_id_hmac, status, operation_id, created_at, updated_at) VALUES (?1,?2,?3,'pending',?4,?5,?5)").bind(id, p, h, op, t).run();
    await acc('a1', 'p1', 'dup', 'o1');
    await expect(acc('a2', 'p2', 'dup', 'o2')).rejects.toThrow(/UNIQUE/);
    await expect(acc('a3', 'p2', null, 'o1')).rejects.toThrow(/UNIQUE/);
    await acc('a4', 'p2', null, 'o4');
    await acc('a5', 'p2', null, 'o5'); // NULL hmac values (pending) do not collide
    await expect(db().prepare("INSERT INTO principals (principal_id, oidc_issuer, oidc_subject, created_at) VALUES ('p3','iss','s1',?1)").bind(t).run()).rejects.toThrow(/UNIQUE/);
    // tombstones (NULL issuer/subject) never collide with each other
    await db().prepare("INSERT INTO principals (principal_id, status, created_at, deleted_at) VALUES ('t1','deleted',?1,?1),('t2','deleted',?1,?1)").bind(t).run();
  });
});
