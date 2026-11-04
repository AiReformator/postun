-- Stateless pre-login flow (docs/06): state/nonce/PKCE verifier now live in the encrypted __Host-postun_admin_flow cookie,
-- so unauthenticated GET /login writes nothing. login_states (0001) is intentionally left in place and is no longer written
-- (not dropped: additive migrations only); the hourly cron still purges any legacy rows.

-- Hashes of login states whose code exchange succeeded (authenticated path only): rejects replay of a captured
-- flow cookie + callback URL within the 10 minute flow lifetime.
CREATE TABLE consumed_login_states (
  state_hash TEXT PRIMARY KEY,            -- SHA-256(state), base64url
  expires_at INTEGER NOT NULL             -- epoch ms; = flow expiry, purged hourly
) STRICT;
CREATE INDEX idx_consumed_login_states_expires ON consumed_login_states (expires_at);
