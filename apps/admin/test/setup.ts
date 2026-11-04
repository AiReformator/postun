import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach } from 'vitest';

const e = env as unknown as { ADMIN_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(e.ADMIN_DB, e.TEST_MIGRATIONS);
});

// Do not rely on automatic storage isolation: start every test from empty tables.
beforeEach(async () => {
  for (const t of ['login_states', 'consumed_login_states', 'admin_sessions', 'admin_blocked_subjects', 'admin_audit', 'projections', 'admin_settings']) await e.ADMIN_DB.prepare(`DELETE FROM ${t}`).run();
});
