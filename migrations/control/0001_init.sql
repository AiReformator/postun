-- Control D1 (postun-control), owned by postun-auth. Additive, idempotent (IF NOT EXISTS) so a re-run on populated data is safe.
-- Times are unix seconds (INTEGER). No plaintext Telegram IDs, tokens or session ids are ever stored here.

CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  primary_telegram_id_hmac TEXT,
  telegram_id_enc TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting', 'deleted')),
  plan TEXT NOT NULL DEFAULT 'beta_free',
  accepted_terms_version TEXT,
  accepted_terms_at INTEGER,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (oidc_issuer, oidc_subject)
);
CREATE INDEX IF NOT EXISTS idx_principals_tg_hmac ON principals (primary_telegram_id_hmac);

CREATE TABLE IF NOT EXISTS linked_accounts (
  account_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (principal_id),
  telegram_id_hmac TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revocation_pending', 'disconnected')),
  label TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_principal ON linked_accounts (principal_id);

CREATE TABLE IF NOT EXISTS grant_reference (
  grant_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (principal_id),
  client_id TEXT NOT NULL,
  client_name TEXT,
  accounts_json TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoking', 'revoked', 'expired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_grant_reference_principal ON grant_reference (principal_id);

CREATE TABLE IF NOT EXISTS web_sessions (
  session_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (principal_id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_principal ON web_sessions (principal_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expiry ON web_sessions (idle_expires_at);

CREATE TABLE IF NOT EXISTS login_states (
  state_hash TEXT PRIMARY KEY,
  binder_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_states_expiry ON login_states (expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_hash TEXT NOT NULL,
  action_code TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit (created_at);

-- Future billing: entitlements are separate from sessions and identity (no billing logic in beta).
CREATE TABLE IF NOT EXISTS entitlements (
  entitlement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  principal_id TEXT NOT NULL REFERENCES principals (principal_id),
  plan TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entitlements_principal ON entitlements (principal_id);
