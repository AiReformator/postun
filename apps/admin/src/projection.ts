import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  AdminProjectionSchema, ProblemReportSchema, REPORT_BACKLOG_LIMIT, type AdminProjection, type ProblemReport, type ProblemReportReceipt, type ProjectionSinkRpc
} from '@postun/contracts';
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

  /**
   * Stores one problem report from report_problem (docs/03 section 4). The payload is re-validated here: this is the
   * boundary of the admin store, so it does not trust the Worker that sent it. A full backlog is refused rather than
   * grown without bound.
   */
  async submitReport(r: ProblemReport): Promise<ProblemReportReceipt> {
    const v = ProblemReportSchema.parse(r);
    const backlog = await this.env.ADMIN_DB.prepare("SELECT COUNT(*) AS n FROM problem_reports WHERE status = 'new'").first<{ n: number }>();
    if ((backlog?.n ?? 0) >= REPORT_BACKLOG_LIMIT) throw new Error('report backlog is full');
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const ticket = newTicket();
      try {
        await this.env.ADMIN_DB.prepare(
          `INSERT INTO problem_reports (id, created_at, principal_ref, category, tool, error_code, error_reason, account_ref, client, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(ticket, now, v.principalRef, v.category, v.tool, v.errorCode, v.errorReason, v.accountRef, v.client, v.summary)
          .run();
        return { ticket, receivedAt: new Date(now).toISOString() };
      } catch (e) {
        if (!/UNIQUE|constraint/i.test(String(e))) throw e; // only a ticket id collision is retried
      }
    }
    throw new Error('could not allocate a ticket id');
  }
}

/** "PR-" plus 8 characters without look-alikes (no 0/O, 1/I/L): easy to read out and to quote. */
const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `PR-${Array.from(bytes, (b) => TICKET_ALPHABET[b % TICKET_ALPHABET.length]).join('')}`;
}
