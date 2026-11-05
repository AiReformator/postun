import { WorkerEntrypoint } from 'cloudflare:workers';
import { AdminProjectionSchema, type AdminProjection, type ProjectionSinkRpc } from '@postun/contracts';
import type { Env } from './env';

/**
 * Service-binding-only entrypoint called by postun-mcp (binding ADMIN_SINK). It is not routed by the default fetch
 * handler and defines no fetch() of its own, so it is unreachable over HTTP.
 */
export class ProjectionSink extends WorkerEntrypoint<Env> implements ProjectionSinkRpc {
  async upsert(p: AdminProjection): Promise<{ applied: boolean }> {
    const v = AdminProjectionSchema.parse(p);
    // Absolute values, applied only for a strictly newer revision (idempotent, order-independent).
    const r = await this.env.ADMIN_DB.prepare(
      `INSERT INTO projections (principal_ref, revision, linked_accounts, status, plan, month, success_count, out_bytes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (principal_ref) DO UPDATE SET revision = excluded.revision, linked_accounts = excluded.linked_accounts,
         status = excluded.status, plan = excluded.plan, month = excluded.month, success_count = excluded.success_count,
         out_bytes = excluded.out_bytes, updated_at = excluded.updated_at
       WHERE excluded.revision > projections.revision`
    )
      .bind(v.principalRef, v.revision, v.linkedAccounts, v.status, v.plan, v.month, v.successCount, v.outBytes, Date.now())
      .run();
    return { applied: r.meta.changes > 0 };
  }
}
