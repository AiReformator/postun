-- At most one pending link attempt per principal (race-proof backstop for startLink's conditional INSERT).
-- Additive and idempotent: duplicate pending rows left by the earlier SELECT-then-INSERT race are closed first
-- (keeping the newest), so the unique index can always be created and nobody is locked out.
UPDATE linked_accounts
SET status = 'disconnected', telegram_id_hmac = NULL, failure_code = 'EXPIRED', updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE status = 'pending'
  AND rowid NOT IN (SELECT MAX(rowid) FROM linked_accounts WHERE status = 'pending' GROUP BY principal_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_accounts_one_pending ON linked_accounts (principal_id) WHERE status = 'pending';
