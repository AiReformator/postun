-- Problem reports sent by AI clients through the MCP tool report_problem, with the user's confirmation (docs/03 section 4).
-- Closed vocabulary plus one short, scrubbed free-text summary (max 500 characters); no message text, chats, names or
-- phone numbers. Written only through the ProjectionSink.submitReport service-binding entrypoint; read by the operator
-- (daily review). Retention 90 days (purged hourly by cron).
CREATE TABLE problem_reports (
  id            TEXT PRIMARY KEY,                -- ticket id shown to the user, "PR-" + 8 characters
  created_at    INTEGER NOT NULL,                -- epoch ms
  principal_ref TEXT NOT NULL,                   -- opaque owner id (same as projections.principal_ref)
  category      TEXT NOT NULL,                   -- REPORT_CATEGORIES
  tool          TEXT,                            -- Postun tool name, if any
  error_code    TEXT,                            -- Postun error code, if any
  error_reason  TEXT,                            -- Postun error reason, if any
  account_ref   TEXT,                            -- account id of the grant, if the report concerns one
  client        TEXT,                            -- AI client name as given by the client, if any
  summary       TEXT NOT NULL,                   -- scrubbed, 10..500 characters
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'fixed', 'wontfix', 'duplicate')),
  note          TEXT,                            -- operator's note (what was done), never user content
  updated_at    INTEGER
) STRICT;
CREATE INDEX idx_problem_reports_status ON problem_reports (status, created_at);
CREATE INDEX idx_problem_reports_created ON problem_reports (created_at);
