/** Additive, idempotent schema. No message or file content is ever stored in these tables. */
export const SCHEMA: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS accounts(
     account_id TEXT PRIMARY KEY,
     status TEXT NOT NULL CHECK (status IN ('pending','active','revocation_pending','disconnected')),
     label TEXT NOT NULL,
     envelope TEXT,
     created_at INTEGER NOT NULL,
     status_at INTEGER NOT NULL,
     ended_at INTEGER,
     ended_code TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS grants(
     grant_id TEXT PRIMARY KEY,
     accounts TEXT NOT NULL,
     scopes TEXT NOT NULL,
     version INTEGER NOT NULL,
     denied INTEGER NOT NULL DEFAULT 0,
     denied_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS usage(
     month TEXT PRIMARY KEY,
     success_count INTEGER NOT NULL,
     out_bytes INTEGER NOT NULL,
     revision INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS usage_day(
     day TEXT PRIMARY KEY,
     success_count INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS idem(
     operation_id TEXT PRIMARY KEY,
     month TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('reserved','committed')),
     req_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     replays INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS transfers(
     intent_id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL,
     grant_id TEXT NOT NULL,
     account_id TEXT NOT NULL,
     peer_id TEXT NOT NULL,
     message_id INTEGER NOT NULL,
     size INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  // Per-account pacing state (token buckets, rolling counters) and the persisted Telegram flood cooldown.
  // Counters only; no identifiers beyond the account id, no content.
  `CREATE TABLE IF NOT EXISTS pacing(
     account_id TEXT PRIMARY KEY,
     state TEXT NOT NULL,
     cooldown_until INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   )`,
  // Connection journal (docs/03 section 4): technical events about one account's Telegram session, from a closed
  // vocabulary (see SESSION_EVENT_KINDS / SESSION_ERROR_CODES). No message text, peers, queries, file names or Telegram
  // free text. Capped per account and aged out by the alarm; deleted with the account and with the profile.
  `CREATE TABLE IF NOT EXISTS account_events(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     event TEXT NOT NULL,
     code TEXT,
     source TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS account_events_by_account ON account_events(account_id, id)'
];
