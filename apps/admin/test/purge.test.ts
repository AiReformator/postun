import { createScheduledController } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { db, makeEnv } from './helpers';

describe('hourly cron purge', () => {
  it('drops audit rows older than 30 days, expired login states and dead sessions only', async () => {
    const now = Date.now();
    const day = 24 * 3600_000;
    const a = db.prepare('INSERT INTO admin_audit (ts, actor_subject, action_code, target_opaque_id, outcome) VALUES (?, ?, ?, ?, ?)');
    await db.batch([a.bind(now - 31 * day, 's', 'old', null, 'ok'), a.bind(now - 29 * day, 's', 'new', null, 'ok')]);
    const l = db.prepare('INSERT INTO login_states (state_hash, binding_hash, nonce, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)');
    await db.batch([l.bind('a', 'b', 'n', 'v', now - 1e6, now - 1000), l.bind('c', 'b', 'n', 'v', now, now + 1e5)]);
    const s = db.prepare('INSERT INTO admin_sessions (id_hash, subject, issuer, roles, mfa, created_at, last_seen, last_revalidated, csrf_secret) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)');
    await db.batch([s.bind('dead', 'u', 'i', '[]', now - 2 * 3600_000, now - 3600_000, now, 'x'), s.bind('live', 'u', 'i', '[]', now, now, now, 'x')]);
    await worker.scheduled(createScheduledController(), makeEnv());
    expect((await db.prepare('SELECT action_code FROM admin_audit').all()).results).toEqual([{ action_code: 'new' }]);
    expect((await db.prepare('SELECT state_hash FROM login_states').all()).results).toEqual([{ state_hash: 'c' }]);
    expect((await db.prepare('SELECT id_hash FROM admin_sessions').all()).results).toEqual([{ id_hash: 'live' }]);
  });
});
