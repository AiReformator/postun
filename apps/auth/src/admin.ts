import { WorkerEntrypoint } from 'cloudflare:workers';
import { hmac, toBase64Url, UuidSchema } from '@postun/contracts';
import type { AdminActor, AdminControlRpc } from '@postun/contracts';
import { loadConfig, now } from './env';
import type { Env } from './env';
import { loadKeys } from './keys';

const ROLES = ['postun.operator', 'postun.owner'];

/**
 * The only admin capability: suspend/resume a principal. `principalRef` is the opaque principal_id (UUID) that
 * the MCP projection carries. Every attempt, including denied ones, leaves an audit row (30-day retention).
 */
export class AdminControl extends WorkerEntrypoint<Env> implements AdminControlRpc {
  suspend(actor: AdminActor, principalRef: string): Promise<{ ok: boolean }> {
    return this.change(actor, principalRef, true);
  }

  resume(actor: AdminActor, principalRef: string): Promise<{ ok: boolean }> {
    return this.change(actor, principalRef, false);
  }

  private async change(actor: AdminActor, principalRef: string, suspend: boolean): Promise<{ ok: boolean }> {
    const cfg = loadConfig(this.env);
    const keys = await loadKeys(cfg);
    const action = suspend ? 'principal.suspend' : 'principal.resume';
    const actorOk =
      typeof actor === 'object' && actor !== null && typeof actor.issuer === 'string' && typeof actor.subject === 'string' && actor.subject !== '' && ROLES.includes(actor.role);
    const actorHash = toBase64Url(await hmac(keys.session, 'admin-actor-v1', String(actor?.issuer ?? ''), String(actor?.subject ?? '')));
    const target = UuidSchema.safeParse(principalRef).success ? principalRef : 'invalid';
    let outcome = 'denied';
    try {
      if (!actorOk || target === 'invalid') return { ok: false };
      const row = await this.env.CONTROL_DB.prepare('SELECT status FROM principals WHERE principal_id = ?1').bind(target).first<{ status: string }>();
      if (!row || (row.status !== 'active' && row.status !== 'suspended')) {
        outcome = 'not_found';
        return { ok: false };
      }
      if (suspend) {
        await this.env.VAULT.setSuspended(target, true); // authoritative state first: fail closed
        await this.env.CONTROL_DB.prepare("UPDATE principals SET status = 'suspended' WHERE principal_id = ?1 AND status IN ('active', 'suspended')").bind(target).run();
      } else {
        await this.env.CONTROL_DB.prepare("UPDATE principals SET status = 'active' WHERE principal_id = ?1 AND status IN ('active', 'suspended')").bind(target).run();
        await this.env.VAULT.setSuspended(target, false);
      }
      outcome = 'ok';
      return { ok: true };
    } catch {
      outcome = 'error';
      return { ok: false };
    } finally {
      await this.env.CONTROL_DB.prepare('INSERT INTO admin_audit (actor_hash, action_code, target_ref, outcome, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(actorHash, action, target, outcome, now())
        .run();
    }
  }
}
