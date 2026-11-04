/**
 * SessionAndQuotaDO: one SQLite Durable Object per principal.
 * Owns: encrypted Telegram session envelopes, authoritative grant/deny state, suspension,
 * monthly quota counters, idempotency keys, download intents and the QR link flow.
 * The principal id comes only from validated token props or from VaultControl arguments.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  AdminProjectionSchema, fromBase64Url, fromUtf8, hmac, HTTP_STATUS, jsonResponse, normalizeScopes, openSession, PostunError, randomToken,
  retainedMonths, rewrapSession, sealSession, sha256, timingSafeEqual, toBase64Url, toSafeError, TOOL_SCOPE, utcMonth, utf8,
  type ErrorCode, type GrantRecord, type LinkState, type SessionEnvelope, type ToolName, type UsageView
} from '@postun/contracts';
import { signFileCapability } from '../capability';
import type { Config, Keys } from '../config';
import { loadConfig, loadKeys } from '../config';
import type { Env } from '../env';
import { CAPABILITY_TTL_MS, CHUNK_BYTES, fileHeaders, MAX_TRANSFERS_PER_PRINCIPAL, parseRange, safeContentType, safeDisposition } from '../files';
import { TOOL_INPUT } from '../schemas';
import type { LinkRun, TelegramAdapter, TelegramSession } from '../telegram/adapter';
import { selectAdapter } from '../telegram/adapter';
import { mapTelegramError } from '../telegram/errors';
import { assertFeatureEnabled, parseToolArgs, runTool, type JsonValue } from '../tools';
import { KeyedLocks } from './locks';
import { SCHEMA } from './schema';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;
const LINK_TTL_MS = 5 * 60 * 1000;
const LOCK_WAIT_MS = 30_000;
const REVOCATION_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const ALARM_PERIOD_MS = 30 * 60 * 1000;
const SWEEP_PERIOD_MS = 6 * 60 * 60 * 1000;
const MAX_REVOKE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MAX_LIVE_INTENTS = 50;
/**
 * Idempotency semantics (docs/03 section 6, docs/05 Q-02). A committed operation_id may be replayed against Telegram
 * (results are never stored) for at most FREE_REPLAYS further calls within the TTL; those are not counted again.
 * Every replay beyond that is a fresh, counted operation, and a replay is never free once the monthly quota is
 * exhausted. So one key can never produce unlimited uncounted work.
 */
const FREE_REPLAYS = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ToolCallRequest {
  principalId: string;
  grantId: string;
  grantVersion: number;
  scopes: string[];
  accounts: string[];
  tool: ToolName;
  args: Record<string, unknown>;
}

/** `json` is the serialised result: keeps the RPC type shallow and the payload opaque to the transport. */
export type ToolOutcome =
  | { ok: true; json: string }
  | { ok: false; code: ErrorCode; message: string; retryAfterSeconds?: number };

interface AccountRow extends Record<string, SqlStorageValue> {
  account_id: string;
  status: string;
  label: string;
  envelope: string | null;
  created_at: number;
  status_at: number;
}
interface GrantRow extends Record<string, SqlStorageValue> {
  grant_id: string;
  accounts: string;
  scopes: string;
  version: number;
  denied: number;
}
interface IntentRow extends Record<string, SqlStorageValue> {
  intent_id: string;
  token_hash: string;
  grant_id: string;
  account_id: string;
  peer_id: string;
  message_id: number;
  size: number;
  expires_at: number;
}

interface Reservation {
  counted: boolean;
  month: string;
  op: string | null;
}

interface LinkRec {
  state: LinkState;
  run: LinkRun | null;
  waiter: ((password: string) => void) | null;
  invalid: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export class SessionAndQuotaDO extends DurableObject<Env> {
  private readonly locks = new KeyedLocks();
  private readonly reserved = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private readonly links = new Map<string, LinkRec>();
  private readonly transfers = new Map<string, string>(); // transfer key -> account id
  private principal: string | null = null;
  private alarmAt: number | null = null;
  private schemaReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Schema is created lazily on first real use, so an object that is only addressed (never bound) stays empty.
  }

  // ------------------------------------------------------------------ storage helpers

  private migrate(): void {
    for (const stmt of SCHEMA) this.ctx.storage.sql.exec(stmt);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE idem ADD COLUMN replays INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already present (new schema or already migrated)
    }
    this.schemaReady = true;
  }
  private ensureSchema(): void {
    if (!this.schemaReady) this.migrate();
  }
  /** True when this object was ever initialised; does not create anything. */
  private hasSchema(): boolean {
    if (this.schemaReady) return true;
    return this.ctx.storage.sql.exec("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  }
  private q<T extends Record<string, SqlStorageValue>>(sql: string, ...b: SqlStorageValue[]): T[] {
    this.ensureSchema();
    return this.ctx.storage.sql.exec<T>(sql, ...b).toArray();
  }
  private run(sql: string, ...b: SqlStorageValue[]): void {
    this.ensureSchema();
    this.ctx.storage.sql.exec(sql, ...b);
  }
  private getMeta(k: string): string | null {
    return this.q<{ v: string }>('SELECT v FROM meta WHERE k = ?', k)[0]?.v ?? null;
  }
  private setMeta(k: string, v: string): void {
    this.run('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  }
  private account(id: string): AccountRow | null {
    return this.q<AccountRow>('SELECT account_id, status, label, envelope, created_at, status_at FROM accounts WHERE account_id = ?', id)[0] ?? null;
  }
  private grant(id: string): GrantRow | null {
    return this.q<GrantRow>('SELECT grant_id, accounts, scopes, version, denied FROM grants WHERE grant_id = ?', id)[0] ?? null;
  }

  /** Binds this object to one principal on first use; a different principal is refused. */
  private bind(principalId: string): void {
    if (!UUID_RE.test(principalId)) throw new PostunError('INVALID_INPUT');
    this.principal ??= this.getMeta('principal');
    if (this.principal === null) {
      this.setMeta('principal', principalId);
      this.principal = principalId;
    } else if (this.principal !== principalId) {
      throw new PostunError('FORBIDDEN');
    }
    if (this.getMeta('deleted') === '1') throw new PostunError('FORBIDDEN');
  }

  /** Same binding rule, but a deleted principal is allowed through (only deletePrincipal retries use it). */
  private bindAllowDeleted(principalId: string): void {
    if (!UUID_RE.test(principalId)) throw new PostunError('INVALID_INPUT');
    this.principal ??= this.getMeta('principal');
    if (this.principal === null) {
      this.setMeta('principal', principalId);
      this.principal = principalId;
    } else if (this.principal !== principalId) {
      throw new PostunError('FORBIDDEN');
    }
  }

  private ensureAlarm(delayMs: number = ALARM_PERIOD_MS): void {
    const at = Date.now() + delayMs;
    if (this.alarmAt !== null && this.alarmAt <= at) return; // an earlier alarm is already armed
    this.alarmAt = at;
    void this.ctx.storage.setAlarm(at);
  }

  // ------------------------------------------------------------------ projection

  private nextRevision(): number {
    const rev = Math.max(Number(this.getMeta('revision') ?? '0') + 1, Date.now());
    this.setMeta('revision', String(rev));
    return rev;
  }

  /** Best-effort aggregate projection for the Admin Worker. Never blocks or fails the caller. */
  private emitProjection(): void {
    const sink = this.env.ADMIN_SINK;
    if (!sink || !this.principal) return;
    try {
      const month = utcMonth();
      const u = this.q<{ success_count: number; out_bytes: number }>('SELECT success_count, out_bytes FROM usage WHERE month = ?', month)[0];
      const linked = this.q<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE status = 'active'")[0]?.n ?? 0;
      const status = this.getMeta('deleted') === '1' ? 'deleted' : this.getMeta('suspended') === '1' ? 'suspended' : 'active';
      const p = AdminProjectionSchema.parse({
        principalRef: this.principal,
        revision: this.nextRevision(),
        linkedAccounts: Math.min(linked, 100),
        status,
        plan: 'beta_free',
        month,
        successCount: u?.success_count ?? 0,
        outBytes: u?.out_bytes ?? 0
      });
      this.ctx.waitUntil(
        Promise.resolve()
          .then(() => sink.upsert(p))
          .then(
            () => undefined,
            () => undefined
          )
      );
    } catch {
      // projection is advisory; swallow without logging content
    }
  }

  // ------------------------------------------------------------------ crypto helpers

  private async seal(accountId: string, payload: { s: string; tid: string }, keys: Keys): Promise<string> {
    const bytes = utf8(JSON.stringify(payload));
    try {
      return JSON.stringify(await sealSession(bytes, { principalId: this.principal ?? '', accountId }, keys.kek, keys.kekVersion));
    } finally {
      bytes.fill(0);
    }
  }

  private async unseal(accountId: string, envelope: string, keys: Keys): Promise<{ s: string; tid: string }> {
    const plain = await openSession(JSON.parse(envelope) as SessionEnvelope, { principalId: this.principal ?? '', accountId }, keys.keks);
    try {
      const p = JSON.parse(fromUtf8(plain)) as { s: string; tid: string };
      if (typeof p.s !== 'string' || typeof p.tid !== 'string') throw new Error('bad payload');
      return p;
    } finally {
      plain.fill(0);
    }
  }

  /**
   * KEK rotation: an envelope under an older (still configured) KEK version is rewrapped to the current one,
   * so removing SESSION_KEK_PREVIOUS later cannot strand it. Failure is non-fatal.
   */
  private async rewrapIfStale(accountId: string, envelope: string, keys: Keys): Promise<void> {
    try {
      const parsed = JSON.parse(envelope) as SessionEnvelope;
      if (parsed.kv === keys.kekVersion || !keys.keks.has(parsed.kv)) return;
      const next = await rewrapSession(parsed, { principalId: this.principal ?? '', accountId }, keys.keks, keys.kek, keys.kekVersion);
      this.run('UPDATE accounts SET envelope = ? WHERE account_id = ? AND envelope = ?', JSON.stringify(next), accountId, envelope);
    } catch {
      // keep the old envelope; it is still readable while the previous KEK is configured
    }
  }

  // ------------------------------------------------------------------ authorisation + quota

  private authorize(
    a: { principalId: string; grantId: string; grantVersion: number; scopes: readonly string[]; accounts: readonly string[]; tool: ToolName; accountId: string | null }
  ): GrantRow {
    this.bind(a.principalId);
    if (this.getMeta('suspended') === '1') throw new PostunError('FORBIDDEN');
    const g = this.grant(a.grantId);
    if (!g) throw new PostunError('FORBIDDEN');
    if (g.denied === 1) throw new PostunError('GRANT_REVOKED');
    if (g.version < a.grantVersion) throw new PostunError('FORBIDDEN');
    const need = TOOL_SCOPE[a.tool];
    const grantScopes = JSON.parse(g.scopes) as string[];
    if (!a.scopes.includes(need) || !grantScopes.includes(need)) throw new PostunError('FORBIDDEN');
    if (a.accountId !== null) {
      const grantAccounts = JSON.parse(g.accounts) as string[];
      if (!a.accounts.includes(a.accountId) || !grantAccounts.includes(a.accountId)) throw new PostunError('ACCOUNT_NOT_IN_GRANT');
      const acc = this.account(a.accountId);
      if (!acc || acc.status !== 'active' || !acc.envelope) throw new PostunError('ACCOUNT_NOT_ACTIVE');
    }
    return g;
  }

  private usageRow(month: string): { success_count: number; out_bytes: number } {
    const r = this.q<{ success_count: number; out_bytes: number }>('SELECT success_count, out_bytes FROM usage WHERE month = ?', month)[0];
    if (r) return r;
    this.run('INSERT INTO usage(month, success_count, out_bytes, revision) VALUES(?, 0, 0, 0)', month);
    return { success_count: 0, out_bytes: 0 };
  }

  /** Synchronous (no await inside): the check and the reservation are one atomic step. */
  private reserve(cfg: Config, op: string | null, reqHash: string | null): Reservation {
    const now = Date.now();
    const month = utcMonth(new Date(now));
    let carriedReplays = 0;
    let carriedExpiry = now + IDEMPOTENCY_TTL_MS;
    if (op !== null) {
      const row = this.q<{ state: string; req_hash: string; expires_at: number; replays: number }>(
        'SELECT state, req_hash, expires_at, replays FROM idem WHERE operation_id = ?', op
      )[0];
      if (row && row.expires_at > now) {
        if (row.req_hash !== reqHash) throw new PostunError('CONFLICT');
        if (row.state === 'committed') {
          // A replay never bypasses the quota, even though it is not counted again.
          const used = this.usageRow(month).success_count + (this.reserved.get(month) ?? 0);
          if (used >= cfg.quota.monthlySuccessLimit) throw new PostunError('QUOTA_EXCEEDED');
          if (row.replays < FREE_REPLAYS) {
            this.run('UPDATE idem SET replays = replays + 1 WHERE operation_id = ?', op);
            return { counted: false, month, op };
          }
          // Free replays used up: this call is a fresh counted operation under the same key (keeps the replay count and expiry).
          carriedReplays = row.replays;
          carriedExpiry = row.expires_at;
        } else if (this.inflight.has(op)) {
          throw new PostunError('CONFLICT');
        }
        // else: stale 'reserved' row from before a restart: take it over
      }
      if (row) this.run('DELETE FROM idem WHERE operation_id = ?', op);
    }
    const u = this.usageRow(month);
    const held = this.reserved.get(month) ?? 0;
    if (u.success_count + held >= cfg.quota.monthlySuccessLimit) throw new PostunError('QUOTA_EXCEEDED');
    this.reserved.set(month, held + 1);
    if (op !== null) {
      this.run(
        "INSERT INTO idem(operation_id, month, state, req_hash, expires_at, replays) VALUES(?, ?, 'reserved', ?, ?, ?)",
        op, month, reqHash ?? '', carriedExpiry, carriedReplays
      );
      this.inflight.add(op);
      this.ensureAlarm();
    }
    return { counted: true, month, op };
  }

  private dropHeld(r: Reservation): void {
    if (!r.counted) return;
    this.reserved.set(r.month, Math.max(0, (this.reserved.get(r.month) ?? 1) - 1));
    if (r.op !== null) this.inflight.delete(r.op);
  }

  private commit(r: Reservation): void {
    if (!r.counted) return;
    this.ctx.storage.transactionSync(() => {
      this.usageRow(r.month);
      this.run('UPDATE usage SET success_count = success_count + 1, revision = ? WHERE month = ?', this.nextRevision(), r.month);
      if (r.op !== null) this.run("UPDATE idem SET state = 'committed' WHERE operation_id = ?", r.op);
    });
    this.dropHeld(r);
    this.emitProjection();
  }

  private release(r: Reservation): void {
    if (!r.counted) return;
    if (r.op !== null) this.run("DELETE FROM idem WHERE operation_id = ? AND state = 'reserved'", r.op);
    this.dropHeld(r);
  }

  private addBytes(n: number): void {
    const month = utcMonth();
    this.usageRow(month);
    this.run('UPDATE usage SET out_bytes = out_bytes + ?, revision = ? WHERE month = ?', n, this.nextRevision(), month);
  }

  // ------------------------------------------------------------------ MCP tool execution

  async callTool(req: ToolCallRequest): Promise<ToolOutcome> {
    try {
      return { ok: true, json: JSON.stringify(await this.callToolInner(req)) };
    } catch (e) {
      const s = toSafeError(e);
      return { ok: false, ...s };
    }
  }

  private async callToolInner(req: ToolCallRequest): Promise<JsonValue> {
    const cfg = loadConfig(this.env);
    const keys = await loadKeys(this.env);
    if (!(req.tool in TOOL_INPUT)) throw new PostunError('INVALID_INPUT');
    const args = parseToolArgs(req.tool, req.args) as { account_id?: string; operation_id?: string };
    const accountId = req.tool === 'list_accounts' ? null : (args.account_id ?? null);
    const auth = { ...req, accountId };
    const op = args.operation_id ?? null;

    if (req.tool === 'list_accounts') {
      const g = this.authorize(auth);
      return this.listAccounts(g, req.accounts);
    }
    assertFeatureEnabled(req.tool, cfg);

    let reqHash: string | null = null;
    if (op !== null) {
      const { operation_id: _op, ...rest } = args;
      reqHash = toBase64Url(await hmac(keys.cursor, 'idem-v1', req.tool, accountId ?? '', stableJson(rest)));
    }

    // Authorise and reserve in one synchronous step, before any upstream I/O.
    const grant = this.authorize(auth);
    const reservation = this.reserve(cfg, op, reqHash);
    let committed = false;
    try {
      const accId = accountId as string;
      const unlock = await this.locks.acquire(accId, LOCK_WAIT_MS);
      let data: JsonValue;
      try {
        // Deny / suspend / disconnect may have happened while we waited.
        this.authorize(auth);
        data = await this.withSession(accId, keys, async (session) => {
          try {
            return await runTool(
              {
                principalId: req.principalId,
                accountId: accId,
                session,
                cursorKey: keys.cursor,
                cfg,
                globalSearchAllowed: this.chatAllowlist(grant) === null,
                issueMedia: (peerId, messageId, size) => this.issueIntent(grant.grant_id, accId, peerId, messageId, size, keys)
              },
              req.tool as Exclude<ToolName, 'list_accounts'>,
              req.args
            );
          } catch (e) {
            throw mapTelegramError(e);
          }
        });
      } finally {
        unlock();
      }
      this.commit(reservation);
      committed = true;
      return data;
    } finally {
      if (!committed) this.release(reservation);
    }
  }

  /** Grants carry no per-chat allowlist in the beta; when one exists, global search must be refused. */
  private chatAllowlist(_g: GrantRow): string[] | null {
    return null;
  }

  private listAccounts(g: GrantRow, tokenAccounts: readonly string[]): JsonValue {
    const allowed = new Set((JSON.parse(g.accounts) as string[]).filter((a) => tokenAccounts.includes(a)));
    const rows = this.q<AccountRow>('SELECT account_id, status, label, envelope, created_at, status_at FROM accounts ORDER BY created_at');
    return {
      accounts: rows
        .filter((r) => allowed.has(r.account_id) && r.status !== 'disconnected')
        .map((r) => ({ accountId: r.account_id, label: r.label, status: r.status, createdAt: new Date(r.created_at).toISOString() }))
    };
  }

  /** Opens the decrypted session for one operation; re-seals only if the SDK changed it. */
  private async withSession<T>(accountId: string, keys: Keys, fn: (s: TelegramSession) => Promise<T>): Promise<T> {
    const acc = this.account(accountId);
    if (!acc?.envelope || acc.status !== 'active') throw new PostunError('ACCOUNT_NOT_ACTIVE');
    let payload: { s: string; tid: string };
    try {
      payload = await this.unseal(accountId, acc.envelope, keys);
    } catch {
      // Undecryptable (e.g. the KEK version was removed): refuse use, never treat it as revoked.
      throw new PostunError('ACCOUNT_NOT_ACTIVE');
    }
    await this.rewrapIfStale(accountId, acc.envelope, keys);
    const adapter = await selectAdapter(this.env);
    let session: TelegramSession;
    try {
      session = await adapter.open(payload.s);
    } catch (e) {
      throw mapTelegramError(e);
    }
    try {
      return await fn(session);
    } finally {
      await this.finishSession(accountId, session, payload.tid, keys);
    }
  }

  private async finishSession(accountId: string, session: TelegramSession, tid: string, keys: Keys): Promise<void> {
    const updated = await session.close().catch(() => null);
    if (updated !== null) {
      const env = await this.seal(accountId, { s: updated, tid }, keys);
      this.run("UPDATE accounts SET envelope = ? WHERE account_id = ? AND status = 'active'", env, accountId);
    }
  }

  // ------------------------------------------------------------------ download intents and streaming

  private async issueIntent(grantId: string, accountId: string, peerId: string, messageId: number, size: number, keys: Keys): Promise<{ intentId: string; capability: string; expiresAt: string }> {
    const now = Date.now();
    this.run('DELETE FROM transfers WHERE expires_at <= ?', now);
    if ((this.q<{ n: number }>('SELECT COUNT(*) AS n FROM transfers')[0]?.n ?? 0) >= MAX_LIVE_INTENTS) throw new PostunError('RATE_LIMITED', 60);
    const intentId = randomToken(16);
    const secret = randomToken(32);
    const hash = toBase64Url(await sha256(secret));
    const expires = now + CAPABILITY_TTL_MS;
    this.run(
      'INSERT INTO transfers(intent_id, token_hash, grant_id, account_id, peer_id, message_id, size, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      intentId, hash, grantId, accountId, peerId, messageId, size, expires
    );
    this.ensureAlarm();
    return { intentId, capability: await signFileCapability(keys.cursor, this.principal ?? '', intentId, secret), expiresAt: new Date(expires).toISOString() };
  }

  /** Re-checks everything that can revoke a transfer. Throws a PostunError when it must stop. */
  private assertTransferAllowed(row: IntentRow, cfg: Config): void {
    if (this.getMeta('deleted') === '1' || this.getMeta('suspended') === '1') throw new PostunError('FORBIDDEN');
    const g = this.grant(row.grant_id);
    if (!g) throw new PostunError('FORBIDDEN');
    if (g.denied === 1) throw new PostunError('GRANT_REVOKED');
    if (!(JSON.parse(g.scopes) as string[]).includes(TOOL_SCOPE.get_media)) throw new PostunError('FORBIDDEN');
    if (!(JSON.parse(g.accounts) as string[]).includes(row.account_id)) throw new PostunError('ACCOUNT_NOT_IN_GRANT');
    const acc = this.account(row.account_id);
    if (!acc || acc.status !== 'active' || !acc.envelope) throw new PostunError('ACCOUNT_NOT_ACTIVE');
    if (cfg.quota.monthlyByteLimit !== null && this.usageRow(utcMonth()).out_bytes >= cfg.quota.monthlyByteLimit) throw new PostunError('QUOTA_EXCEEDED');
  }

  private fileError(e: unknown): Response {
    const s = toSafeError(e);
    return jsonResponse({ error: { code: s.code, message: s.message } }, HTTP_STATUS[s.code], s.retryAfterSeconds ? { 'retry-after': String(s.retryAfterSeconds) } : {});
  }

  /** GET /files/:intentId. The capability is verified against its hash; every chunk re-checks the grant. */
  async openFile(principalId: string, intentId: string, secret: string, rangeHeader: string | null): Promise<Response> {
    const transferKey = crypto.randomUUID();
    let unlock: (() => void) | null = null;
    let session: TelegramSession | null = null;
    let tid = '';
    let keys: Keys | null = null;
    let accountId = '';
    let released = false;
    const cleanup = async (): Promise<void> => {
      if (released) return;
      released = true;
      this.transfers.delete(transferKey);
      try {
        if (session && keys) await this.finishSession(accountId, session, tid, keys);
      } catch {
        // ignore
      }
      unlock?.();
      this.emitProjection();
    };
    try {
      const cfg = loadConfig(this.env);
      keys = await loadKeys(this.env);
      // An object that was never bound has nothing to serve: answer without creating any schema.
      if (!this.hasSchema()) throw new PostunError('NOT_FOUND');
      this.principal ??= this.getMeta('principal');
      if (this.getMeta('deleted') === '1') throw new PostunError('FORBIDDEN');
      if (!UUID_RE.test(principalId) || this.principal !== principalId || !/^[A-Za-z0-9_-]{16,64}$/.test(intentId) || !/^[A-Za-z0-9_-]{32,64}$/.test(secret)) {
        throw new PostunError('NOT_FOUND');
      }
      const row = this.q<IntentRow>('SELECT intent_id, token_hash, grant_id, account_id, peer_id, message_id, size, expires_at FROM transfers WHERE intent_id = ?', intentId)[0];
      if (!row || row.expires_at <= Date.now()) throw new PostunError('NOT_FOUND');
      const presented = await sha256(secret);
      if (!timingSafeEqual(presented, fromBase64Url(row.token_hash))) throw new PostunError('UNAUTHENTICATED');
      this.assertTransferAllowed(row, cfg);

      const range = parseRange(rangeHeader, row.size);
      if (!range.ok) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${row.size}`, 'cache-control': 'no-store' } });
      }
      if (this.transfers.size >= MAX_TRANSFERS_PER_PRINCIPAL || [...this.transfers.values()].includes(row.account_id)) throw new PostunError('CONFLICT');
      this.transfers.set(transferKey, row.account_id);
      accountId = row.account_id;
      unlock = await this.locks.acquire(accountId, LOCK_WAIT_MS);
      this.assertTransferAllowed(row, cfg);

      const acc = this.account(accountId);
      const payload = await this.unseal(accountId, acc?.envelope ?? '', keys);
      tid = payload.tid;
      const adapter: TelegramAdapter = await selectAdapter(this.env);
      session = await adapter.open(payload.s);
      let media;
      try {
        media = await session.openMediaStream(row.peer_id, row.message_id, { start: range.start, end: range.end });
      } catch (e) {
        throw mapTelegramError(e);
      }
      if (media.size !== row.size) {
        await media.cancel();
        throw new PostunError('NOT_FOUND');
      }
      const expected = range.end - range.start + 1;
      const reader = media.stream.getReader();
      let delivered = 0;
      let pending: Uint8Array | null = null;
      const check = () => this.assertTransferAllowed(row, cfg);
      const count = (n: number) => this.addBytes(n);
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              check();
              if (!pending) {
                const r = await reader.read();
                if (r.done) {
                  if (delivered !== expected) throw new PostunError('UPSTREAM_UNAVAILABLE');
                  controller.close();
                  await cleanup();
                  return;
                }
                pending = r.value;
              }
              const part = pending.subarray(0, Math.min(CHUNK_BYTES, expected - delivered));
              pending = part.length < pending.length ? pending.subarray(part.length) : null;
              delivered += part.length;
              count(part.length);
              controller.enqueue(part);
              if (delivered >= expected && !pending) {
                controller.close();
                await media.cancel();
                await cleanup();
              }
            } catch (e) {
              const err = e instanceof PostunError ? e : mapTelegramError(e);
              controller.error(err);
              await media.cancel().catch(() => undefined);
              await cleanup();
            }
          },
          async cancel() {
            await media.cancel().catch(() => undefined);
            await cleanup();
          }
        },
        new CountQueuingStrategy({ highWaterMark: 1 })
      );
      const headers = fileHeaders({
        contentType: safeContentType(media.mimeType),
        disposition: safeDisposition(media.fileName),
        length: expected,
        ...(range.partial ? { range: { start: range.start, end: range.end, size: row.size } } : {})
      });
      return new Response(body, { status: range.partial ? 206 : 200, headers });
    } catch (e) {
      await cleanup();
      return this.fileError(e);
    }
  }

  // ------------------------------------------------------------------ VaultControl: link flow

  private setLinkState(rec: LinkRec, state: LinkState): void {
    if (rec.state.state === 'failed' || rec.state.state === 'authorized') return; // terminal states are final
    rec.state = state;
    for (const l of [...rec.listeners]) l();
  }

  private stateOf(rec: LinkRec): LinkState {
    return rec.state;
  }

  private waitChange(rec: LinkRec, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        rec.listeners.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      rec.listeners.add(done);
    });
  }

  async startLink(principalId: string, accountId: string): Promise<LinkState> {
    this.bind(principalId);
    if (!UUID_RE.test(accountId)) throw new PostunError('INVALID_INPUT');
    const keys = await loadKeys(this.env);
    loadConfig(this.env);
    const acc = this.account(accountId);
    if (acc && (acc.status === 'active' || acc.status === 'revocation_pending')) throw new PostunError('CONFLICT');
    const existing = this.links.get(accountId);
    if (existing && existing.state.state !== 'failed') return existing.state;
    if (acc?.status === 'pending' && acc.envelope) return this.linkStatus(principalId, accountId);

    const adapter = await selectAdapter(this.env);
    const now = Date.now();
    this.run(
      "INSERT INTO accounts(account_id, status, label, envelope, created_at, status_at) VALUES(?, 'pending', '', NULL, ?, ?) ON CONFLICT(account_id) DO UPDATE SET status = 'pending', envelope = NULL, created_at = excluded.created_at, status_at = excluded.status_at",
      accountId, now, now
    );
    this.ensureAlarm();
    const rec: LinkRec = { state: { state: 'unknown' }, run: null, waiter: null, invalid: 0, listeners: new Set(), timer: null };
    this.links.set(accountId, rec);
    const fail = (code: Extract<LinkState, { state: 'failed' }>['code']) => {
      if (rec.state.state === 'authorized' || rec.state.state === 'failed') return;
      this.run("DELETE FROM accounts WHERE account_id = ? AND status = 'pending' AND envelope IS NULL", accountId);
      this.setLinkState(rec, { state: 'failed', code });
    };
    rec.run = adapter.startQrLink({
      onQr: (url, exp) => this.setLinkState(rec, { state: 'waiting_scan', qrUrl: url, expiresAt: exp.toISOString() }),
      requestPassword: () =>
        new Promise<string>((resolve) => {
          rec.waiter = resolve;
          this.setLinkState(rec, { state: 'need_password', hint: null });
        }),
      onPasswordInvalid: () => {
        rec.invalid++;
        if (rec.invalid >= 5) {
          fail('PASSWORD_INVALID');
          rec.run?.cancel();
        }
      }
    });
    rec.timer = setTimeout(() => {
      fail('EXPIRED');
      rec.run?.cancel();
    }, LINK_TTL_MS);
    const finished = rec.run.done.then(
      async (r) => {
        try {
          const envelope = await this.seal(accountId, { s: r.session, tid: r.telegramId }, keys);
          const initial = Array.from(r.firstName.trim())[0]?.toUpperCase() ?? 'T';
          this.run("UPDATE accounts SET envelope = ?, label = ? WHERE account_id = ? AND status = 'pending'", envelope, `${initial}•••`, accountId);
          this.setLinkState(rec, { state: 'authorized', telegramId: r.telegramId, label: `${initial}•••` });
        } catch {
          fail('UPSTREAM');
        }
      },
      (e: unknown) => {
        const m = mapTelegramError(e);
        fail(m.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : rec.state.state === 'failed' ? 'CANCELLED' : 'UPSTREAM');
      }
    ).finally(() => {
      if (rec.timer) clearTimeout(rec.timer);
      rec.waiter = null;
    });
    this.ctx.waitUntil(finished);
    if (this.stateOf(rec).state === 'unknown') await this.waitChange(rec, 15_000);
    if (this.stateOf(rec).state === 'unknown') {
      fail('UPSTREAM');
      rec.run.cancel();
    }
    return rec.state;
  }

  async linkStatus(principalId: string, accountId: string): Promise<LinkState> {
    this.bind(principalId);
    if (!UUID_RE.test(accountId)) throw new PostunError('INVALID_INPUT');
    const rec = this.links.get(accountId);
    if (rec && rec.state.state !== 'authorized') return rec.state;
    const acc = this.account(accountId);
    if (!acc || acc.status === 'disconnected') return rec?.state ?? { state: 'unknown' };
    if (acc.envelope && (acc.status === 'pending' || acc.status === 'active')) {
      try {
        const p = await this.unseal(accountId, acc.envelope, await loadKeys(this.env));
        return { state: 'authorized', telegramId: p.tid, label: acc.label };
      } catch {
        return { state: 'failed', code: 'UPSTREAM' };
      }
    }
    if (acc.status === 'pending') return { state: 'failed', code: 'EXPIRED' };
    return { state: 'unknown' };
  }

  async submitPassword(principalId: string, accountId: string, password: string): Promise<LinkState> {
    this.bind(principalId);
    const rec = this.links.get(accountId);
    if (!rec || rec.state.state !== 'need_password' || !rec.waiter || typeof password !== 'string' || password.length === 0 || password.length > 256) {
      return this.linkStatus(principalId, accountId);
    }
    const resolve = rec.waiter;
    rec.waiter = null;
    resolve(password);
    await this.waitChange(rec, 10_000);
    const st = this.stateOf(rec);
    return st.state === 'authorized' ? this.linkStatus(principalId, accountId) : st;
  }

  async activateAccount(principalId: string, accountId: string): Promise<{ ok: true }> {
    this.bind(principalId);
    this.ensureAlarm(SWEEP_PERIOD_MS); // periodic KEK rotation sweep
    const acc = this.account(accountId);
    if (!acc) throw new PostunError('NOT_FOUND');
    if (acc.status === 'active') return { ok: true };
    if (acc.status !== 'pending' || !acc.envelope) throw new PostunError('ACCOUNT_NOT_ACTIVE');
    this.run("UPDATE accounts SET status = 'active', status_at = ? WHERE account_id = ?", Date.now(), accountId);
    this.links.delete(accountId);
    this.emitProjection();
    return { ok: true };
  }

  async disconnectAccount(principalId: string, accountId: string): Promise<{ telegramLoggedOut: boolean }> {
    this.bind(principalId);
    if (!UUID_RE.test(accountId)) throw new PostunError('INVALID_INPUT');
    const rec = this.links.get(accountId);
    rec?.run?.cancel();
    this.links.delete(accountId);
    const before = this.account(accountId);
    if (!before || before.status === 'disconnected') return { telegramLoggedOut: false };
    // Not usable from this moment: running calls and transfers see it at their next check,
    // which also frees the account lock that the logout below has to wait for.
    this.run('DELETE FROM transfers WHERE account_id = ?', accountId);
    if (before.envelope) this.run("UPDATE accounts SET status = 'revocation_pending', status_at = ? WHERE account_id = ?", Date.now(), accountId);
    const unlock = await this.locks.acquire(accountId, LOCK_WAIT_MS);
    try {
      const acc = this.account(accountId);
      if (!acc || acc.status === 'disconnected') return { telegramLoggedOut: false };
      if (!acc.envelope) {
        this.run("UPDATE accounts SET status = 'disconnected', status_at = ? WHERE account_id = ?", Date.now(), accountId);
        return { telegramLoggedOut: false };
      }
      const out = await this.tryLogout(accountId, acc.envelope);
      this.emitProjection();
      if (!out) this.ensureAlarm();
      return { telegramLoggedOut: out };
    } finally {
      unlock();
    }
  }

  /** Keeps the original status_at of an already pending account so the give-up deadline is not pushed out. */
  private markRevocationPending(accountId: string): void {
    this.run(
      "UPDATE accounts SET status = 'revocation_pending', status_at = CASE WHEN status = 'revocation_pending' THEN status_at ELSE ? END WHERE account_id = ? AND envelope IS NOT NULL",
      Date.now(), accountId
    );
  }

  /** Logs out on Telegram and drops the envelope. false = Telegram unreachable, envelope kept for retry. */
  private async tryLogout(accountId: string, envelope: string): Promise<boolean> {
    let session: string;
    try {
      session = (await this.unseal(accountId, envelope, await loadKeys(this.env))).s;
    } catch {
      // Undecryptable now (KEK version missing / config) does NOT mean revoked: the authorisation may still be live
      // on Telegram. Keep the envelope as revocation_pending (use is refused) and retry until the give-up deadline.
      this.markRevocationPending(accountId);
      return false;
    }
    try {
      await (await selectAdapter(this.env)).logOut(session);
    } catch {
      this.markRevocationPending(accountId);
      return false;
    }
    this.run("UPDATE accounts SET envelope = NULL, status = 'disconnected', status_at = ? WHERE account_id = ?", Date.now(), accountId);
    return true;
  }

  // ------------------------------------------------------------------ VaultControl: grants, suspension, deletion

  async putGrant(principalId: string, grant: GrantRecord): Promise<{ ok: true }> {
    this.bind(principalId);
    if (!UUID_RE.test(grant.grantId) || !grant.accounts.every((a) => UUID_RE.test(a)) || !Number.isSafeInteger(grant.version) || grant.version < 0) {
      throw new PostunError('INVALID_INPUT');
    }
    const scopes = normalizeScopes(grant.scopes);
    // Deny is sticky: a denied grant is never resurrected; a lower version never overwrites a newer one.
    this.run(
      `INSERT INTO grants(grant_id, accounts, scopes, version, denied, denied_at) VALUES(?, ?, ?, ?, 0, NULL)
       ON CONFLICT(grant_id) DO UPDATE SET accounts = excluded.accounts, scopes = excluded.scopes, version = excluded.version
       WHERE grants.denied = 0 AND excluded.version >= grants.version`,
      grant.grantId, JSON.stringify(grant.accounts), JSON.stringify(scopes), grant.version
    );
    return { ok: true };
  }

  async denyGrant(principalId: string, grantId: string): Promise<{ ok: true }> {
    this.bind(principalId);
    if (!UUID_RE.test(grantId)) throw new PostunError('INVALID_INPUT');
    // Deny state is written first; downloads and calls observe it at their next check.
    this.run(
      `INSERT INTO grants(grant_id, accounts, scopes, version, denied, denied_at) VALUES(?, '[]', '[]', 0, 1, ?)
       ON CONFLICT(grant_id) DO UPDATE SET denied = 1, denied_at = COALESCE(grants.denied_at, excluded.denied_at)`,
      grantId, Date.now()
    );
    this.run('DELETE FROM transfers WHERE grant_id = ?', grantId);
    return { ok: true };
  }

  async setSuspended(principalId: string, suspended: boolean): Promise<{ ok: true }> {
    this.bind(principalId);
    this.setMeta('suspended', suspended ? '1' : '0');
    this.emitProjection();
    return { ok: true };
  }

  /**
   * Profile deletion (docs/03 section 3). The principal is marked deleted first: no MCP call, link, transfer or
   * grant can succeed from then on. Every Telegram session is logged out; an envelope whose logout fails is the only
   * handle to revoke a live authorisation, so it alone survives as revocation_pending and the alarm retries with
   * backoff until logout succeeds or REVOCATION_GIVE_UP_MS passes. Everything else is wiped immediately.
   */
  async deletePrincipal(principalId: string): Promise<{ ok: true; revocationPending: boolean }> {
    this.bindAllowDeleted(principalId);
    this.setMeta('deleted', '1'); // every new operation is refused from here on
    for (const rec of this.links.values()) rec.run?.cancel();
    this.links.clear();
    this.run('DELETE FROM transfers');
    const rows = this.q<AccountRow>('SELECT account_id, status, label, envelope, created_at, status_at FROM accounts WHERE envelope IS NOT NULL');
    // Not usable from this moment, and in-flight work cannot re-seal over it.
    for (const r of rows) this.markRevocationPending(r.account_id);
    await Promise.allSettled(
      rows.map(async (r) => {
        const unlock = await this.locks.acquire(r.account_id, 5000).catch(() => null);
        if (!unlock) return; // busy: stays pending, the alarm retries
        try {
          const cur = this.account(r.account_id);
          if (cur?.envelope) await this.tryLogout(r.account_id, cur.envelope);
        } finally {
          unlock();
        }
      })
    );
    const pending = this.hasPendingEnvelopes();
    if (pending) {
      this.wipeExceptEnvelopes();
      this.ensureAlarm(ALARM_PERIOD_MS);
    } else {
      await this.finalizeDeletion();
    }
    this.emitProjection();
    return { ok: true, revocationPending: pending };
  }

  private hasPendingEnvelopes(): boolean {
    return (this.q<{ n: number }>('SELECT COUNT(*) AS n FROM accounts WHERE envelope IS NOT NULL')[0]?.n ?? 0) > 0;
  }

  /** Drops all user data except the envelopes that still need a Telegram logout (and the deleted tombstone). */
  private wipeExceptEnvelopes(): void {
    this.ctx.storage.transactionSync(() => {
      this.run('DELETE FROM grants');
      this.run('DELETE FROM usage');
      this.run('DELETE FROM idem');
      this.run('DELETE FROM transfers');
      this.run('DELETE FROM accounts WHERE envelope IS NULL');
      this.run("UPDATE accounts SET label = '' WHERE envelope IS NOT NULL");
      this.run("DELETE FROM meta WHERE k NOT IN ('principal', 'deleted', 'revision', 'revoke_attempts')");
    });
  }

  /** Full wipe leaving a tombstone without user data: keeps the object bound to this principal and refusing work. */
  private async finalizeDeletion(): Promise<void> {
    const principal = this.principal;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.alarmAt = null;
    this.schemaReady = false;
    this.migrate();
    if (principal) this.setMeta('principal', principal);
    this.setMeta('deleted', '1');
  }

  async getUsage(principalId: string): Promise<UsageView> {
    this.bind(principalId);
    const cfg = loadConfig(this.env);
    const month = utcMonth();
    const u = this.usageRow(month);
    return { month, successCount: u.success_count, outBytes: u.out_bytes, monthlySuccessLimit: cfg.quota.monthlySuccessLimit };
  }

  // ------------------------------------------------------------------ retention

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    const now = Date.now();
    this.run('DELETE FROM idem WHERE expires_at <= ?', now);
    this.run('DELETE FROM transfers WHERE expires_at <= ?', now);
    this.run("DELETE FROM accounts WHERE status = 'pending' AND envelope IS NULL AND created_at <= ?", now - PENDING_TTL_MS);
    const keep = retainedMonths(new Date(now));
    this.run(`DELETE FROM usage WHERE month NOT IN (${keep.map(() => '?').join(',')})`, ...keep);
    for (const [id, rec] of this.links) {
      if (rec.state.state === 'failed') this.links.delete(id);
    }
    // KEK rotation sweep: move envelopes still under an older (configured) KEK to the current one.
    const keys = await loadKeys(this.env).catch(() => null);
    if (keys) {
      for (const r of this.q<AccountRow>('SELECT account_id, status, label, envelope, created_at, status_at FROM accounts WHERE envelope IS NOT NULL')) {
        let kv: string;
        try {
          kv = (JSON.parse(r.envelope as string) as SessionEnvelope).kv;
        } catch {
          continue;
        }
        if (kv === keys.kekVersion || !keys.keks.has(kv)) continue;
        const unlock = await this.locks.acquire(r.account_id, 5000).catch(() => null);
        if (!unlock) continue;
        try {
          const cur = this.account(r.account_id);
          if (cur?.envelope) await this.rewrapIfStale(r.account_id, cur.envelope, keys);
        } finally {
          unlock();
        }
      }
    }
    for (const r of this.q<AccountRow>("SELECT account_id, status, label, envelope, created_at, status_at FROM accounts WHERE status = 'revocation_pending'")) {
      if (!r.envelope) continue;
      const unlock = await this.locks.acquire(r.account_id, 5000).catch(() => null);
      if (!unlock) continue;
      try {
        const cur = this.account(r.account_id);
        if (!cur?.envelope) continue;
        const ok = await this.tryLogout(r.account_id, cur.envelope);
        if (!ok && r.status_at + REVOCATION_GIVE_UP_MS <= now) {
          this.run("UPDATE accounts SET envelope = NULL, status = 'disconnected', status_at = ? WHERE account_id = ?", now, r.account_id);
        }
      } finally {
        unlock();
      }
    }
    const deleted = this.getMeta('deleted') === '1';
    if (deleted && !this.hasPendingEnvelopes()) {
      await this.finalizeDeletion();
      return;
    }
    const revoking = (this.q<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE status = 'revocation_pending'")[0]?.n ?? 0) > 0;
    if (revoking) {
      // Exponential backoff between logout retries, capped.
      const attempts = Math.min(Number(this.getMeta('revoke_attempts') ?? '0') + 1, 16);
      this.setMeta('revoke_attempts', String(attempts));
      this.ensureAlarm(Math.min(ALARM_PERIOD_MS * 2 ** (attempts - 1), MAX_REVOKE_BACKOFF_MS));
      return;
    }
    if (this.getMeta('revoke_attempts') !== null) this.run("DELETE FROM meta WHERE k = 'revoke_attempts'");
    const open =
      (this.q<{ n: number }>(
        "SELECT (SELECT COUNT(*) FROM idem) + (SELECT COUNT(*) FROM transfers) + (SELECT COUNT(*) FROM accounts WHERE status = 'pending') AS n"
      )[0]?.n ?? 0) > 0;
    if (open) this.ensureAlarm();
    else if (!deleted && this.hasPendingEnvelopes()) this.ensureAlarm(SWEEP_PERIOD_MS);
  }
}
