import { beforeEach, describe, expect, it } from 'vitest';
import type { MetricsDataset } from '@postun/contracts';
import { controlSnapshot, runScheduled } from '../src/cron';
import { count, db, makeEnv, resetDb } from './helpers';

type Point = Parameters<MetricsDataset['writeDataPoint']>[0];

beforeEach(async () => {
  await resetDb();
});

/** Synthetic control-plane rows: 4 principals (2 active, 1 suspended, 1 deleted), 3 accounts, 3 grants, 2 sessions. */
async function seed(t: number): Promise<void> {
  const old = t - 3 * 86_400;
  await db().batch([
    db().prepare("INSERT INTO principals (principal_id, status, created_at) VALUES ('p-a', 'active', ?1), ('p-b', 'active', ?2), ('p-s', 'suspended', ?1), ('p-d', 'deleted', ?1)").bind(old, t - 60),
    db()
      .prepare(
        "INSERT INTO linked_accounts (account_id, principal_id, status, operation_id, created_at, updated_at) VALUES ('a1','p-a','active','op1',?1,?1), ('a2','p-a','active','op2',?1,?1), ('a3','p-b','pending','op3',?1,?1)"
      )
      .bind(old),
    db()
      .prepare(
        `INSERT INTO grant_reference (grant_id, principal_id, client_id, accounts_json, scopes_json, version, status, created_at, updated_at) VALUES
         ('g1','p-a','client-x','[]','[]',1,'active',?1,?1), ('g2','p-b','client-x','[]','[]',1,'active',?2,?2), ('g3','p-a','client-y','[]','[]',1,'revoked',?1,?1)`
      )
      .bind(old, t - 60),
    db()
      .prepare("INSERT INTO web_sessions VALUES ('live','p-a',?1,?1,?2,?2), ('gone','p-b',1,1,2,3)")
      .bind(t, t + 3600)
  ]);
}

describe('service metrics: hourly control-plane snapshot', () => {
  it('counts aggregates in one pass per table', async () => {
    const t = Math.floor(Date.now() / 1000);
    await seed(t);
    expect(await controlSnapshot(db(), t)).toEqual({
      principals_total: 4,
      principals_active: 2,
      principals_suspended: 1,
      principals_deleted: 1,
      principals_created_24h: 1,
      accounts_active: 2,
      accounts_pending: 1,
      principals_with_active_account: 1,
      grants_active: 2,
      grants_active_clients: 1,
      grants_created_24h: 1,
      web_sessions_live: 1
    });
  });

  it('an empty database gives zeros, not nulls', async () => {
    const s = await controlSnapshot(db(), Math.floor(Date.now() / 1000));
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
  });

  it('the scheduled run writes exactly one snapshot point with no identifiers', async () => {
    const t = Math.floor(Date.now() / 1000);
    await seed(t);
    const points: Point[] = [];
    await runScheduled(makeEnv({ METRICS: { writeDataPoint: (p) => void points.push(p) } }));
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(['control_snapshot']);
    expect(points[0]?.blobs).toEqual(['v1']);
    expect(points[0]?.doubles?.slice(0, 2)).toEqual([4, 2]);
    const serialized = JSON.stringify(points);
    for (const id of ['p-a', 'p-b', 'a1', 'g1', 'client-x', 'live']) expect(serialized).not.toContain(id);
  });

  it('a failing metrics dataset never stops the retention sweep', async () => {
    await db().prepare("INSERT INTO login_states VALUES ('old','b','n','v',NULL,1,2)").run();
    await runScheduled(
      makeEnv({
        METRICS: {
          writeDataPoint() {
            throw new Error('dataset unavailable');
          }
        }
      })
    );
    expect(await count('login_states')).toBe(0);
  });
});
