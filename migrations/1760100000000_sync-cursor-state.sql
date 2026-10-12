-- Up Migration
-- When a backfill started and finished; completed_at null = still running or never run.
alter table sync_cursors
  add column started_at   timestamptz,
  add column completed_at timestamptz;

-- Down Migration
alter table sync_cursors
  drop column completed_at,
  drop column started_at;
