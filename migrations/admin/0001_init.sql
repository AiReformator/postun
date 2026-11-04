-- postun-admin-meta (docs/02 §2, docs/03 §4, docs/06). Additive migration; no user content, no Telegram data.

-- One-time OIDC login state (TTL 10 min, consumed with DELETE ... RETURNING).
CREATE TABLE login_states (
  state_hash   TEXT PRIMARY KEY,          -- SHA-256(state), base64url
  binding_hash TEXT NOT NULL,             -- SHA-256(flow cookie value): binds the callback to the initiating browser
  nonce        TEXT NOT NULL,
  code_verifier TEXT NOT NULL,            -- PKCE S256 verifier
  created_at   INTEGER NOT NULL,          -- epoch ms
  expires_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_login_states_expires ON login_states (expires_at);

-- Opaque admin sessions: only SHA-256(session id) is stored.
CREATE TABLE admin_sessions (
  id_hash            TEXT PRIMARY KEY,
  subject            TEXT NOT NULL,
  issuer             TEXT NOT NULL,
  roles              TEXT NOT NULL,       -- JSON array of validated Postun project roles for the configured org
  mfa                INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  last_seen          INTEGER NOT NULL,
  last_revalidated   INTEGER NOT NULL,
  revalidating_until INTEGER NOT NULL DEFAULT 0, -- soft lock so concurrent requests do not race a rotating refresh token
  csrf_secret        TEXT NOT NULL,
  refresh_enc        TEXT                 -- AES-GCM(ADMIN_SESSION_KEY) refresh token; never sent to the browser
) STRICT;
CREATE INDEX idx_admin_sessions_subject ON admin_sessions (issuer, subject);

-- Local block list, checked on every request, independent of IDP.
CREATE TABLE admin_blocked_subjects (
  issuer      TEXT NOT NULL,
  subject     TEXT NOT NULL,
  reason_code TEXT NOT NULL DEFAULT 'manual',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
) STRICT;

-- Admin security events, retention 30 days (purged hourly by cron).
CREATE TABLE admin_audit (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               INTEGER NOT NULL,
  actor_subject    TEXT NOT NULL,
  action_code      TEXT NOT NULL,
  target_opaque_id TEXT,
  outcome          TEXT NOT NULL
) STRICT;
CREATE INDEX idx_admin_audit_ts ON admin_audit (ts);

-- Aggregate pseudonymous projections pushed by postun-mcp through the ProjectionSink entrypoint.
CREATE TABLE projections (
  principal_ref   TEXT PRIMARY KEY,
  revision        INTEGER NOT NULL,
  linked_accounts INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  plan            TEXT NOT NULL,
  month           TEXT NOT NULL,
  success_count   INTEGER NOT NULL,
  out_bytes       INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_projections_updated ON projections (updated_at);

-- Informational desired values (owner). Not propagated to other Workers.
CREATE TABLE admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;
