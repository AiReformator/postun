/**
 * Service-binding RPC contracts between Workers (docs/02 §1–2).
 * All principal IDs passed over these interfaces come from server-verified identity,
 * never from a browser field.
 *
 *   postun-auth  --(binding VAULT, entrypoint VaultControl)-->  postun-mcp
 *   postun-mcp   --(binding AUTH,  default entrypoint)------->  postun-auth   (validateToken only)
 *   postun-mcp   --(binding ADMIN_SINK, entrypoint ProjectionSink)--> postun-admin
 *   postun-admin --(binding CONTROL, entrypoint AdminControl)--> postun-auth  (suspend/resume only)
 */
import type { AdminProjection, GrantProps, UsageView } from './dto';
import type { Scope } from './scopes';

// ---------- postun-mcp: VaultControl (called by postun-auth only) ----------

export type LinkState =
  | { state: 'waiting_scan'; qrUrl: string; expiresAt: string }
  | { state: 'need_password'; hint: string | null }
  | { state: 'authorized'; telegramId: string; label: string } // pending: not usable by MCP until activate()
  | { state: 'failed'; code: 'EXPIRED' | 'PASSWORD_INVALID' | 'RATE_LIMITED' | 'UPSTREAM' | 'CANCELLED' }
  | { state: 'unknown' };

export interface GrantRecord {
  grantId: string;
  accounts: string[];
  scopes: Scope[];
  version: number;
}

export interface VaultControlRpc {
  /** Starts an MTProto QR login for a new pending account inside the principal DO. */
  startLink(principalId: string, accountId: string): Promise<LinkState>;
  linkStatus(principalId: string, accountId: string): Promise<LinkState>;
  /** 2FA password is used in memory only and never persisted. */
  submitPassword(principalId: string, accountId: string, password: string): Promise<LinkState>;
  /** Called after Control D1 has reserved telegram_id uniqueness. pending -> active. */
  activateAccount(principalId: string, accountId: string): Promise<{ ok: true }>;
  /** Discards a pending/active account: logs out the Telegram session, deletes ciphertext and DEK. */
  disconnectAccount(principalId: string, accountId: string): Promise<{ telegramLoggedOut: boolean }>;
  /** Registers/updates the authoritative grant (accounts allowlist + scopes + version). */
  putGrant(principalId: string, grant: GrantRecord): Promise<{ ok: true }>;
  /** Writes deny state first; MCP refuses this grant afterwards even if KV still has tokens. */
  denyGrant(principalId: string, grantId: string): Promise<{ ok: true }>;
  /** Suspends/resumes all MCP access for the principal (admin suspend path goes through auth). */
  setSuspended(principalId: string, suspended: boolean): Promise<{ ok: true }>;
  /** Profile deletion: deny everything, log out every session, wipe DO storage. */
  deletePrincipal(principalId: string): Promise<{ ok: true }>;
  getUsage(principalId: string): Promise<UsageView>;
}

// ---------- postun-auth: default entrypoint used by postun-mcp ----------

export interface ValidatedToken {
  props: GrantProps;
  audience: string | string[];
  expiresAt: number;
  scope: string[];
  userId: string;
  clientId: string;
}

export interface AuthServerRpc {
  validateToken(resource: string, token: string): Promise<ValidatedToken | null>;
}

// ---------- postun-auth: AdminControl (called by postun-admin only) ----------

export interface AdminActor {
  issuer: string;
  subject: string;
  role: 'postun.operator' | 'postun.owner';
}

export interface AdminControlRpc {
  suspend(actor: AdminActor, principalRef: string): Promise<{ ok: boolean }>;
  resume(actor: AdminActor, principalRef: string): Promise<{ ok: boolean }>;
}

// ---------- postun-admin: ProjectionSink (called by postun-mcp only) ----------

export interface ProjectionSinkRpc {
  /** Idempotent upsert of absolute values guarded by revision. */
  upsert(p: AdminProjection): Promise<{ applied: boolean }>;
}
