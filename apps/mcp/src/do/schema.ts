/** Additive, idempotent schema. No message or file content is ever stored in these tables. */
export const SCHEMA: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS accounts(
     account_id TEXT PRIMARY KEY,
     status TEXT NOT NULL CHECK (status IN ('pending','active','revocation_pending','disconnected')),
     label TEXT NOT NULL,
     envelope TEXT,
     created_at INTEGER NOT NULL,
     status_at INTEGER NOT NULL
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
   )`
];
