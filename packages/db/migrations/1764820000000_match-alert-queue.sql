-- Up Migration

-- T-835: match alerts off the live job. The live job now only records each
-- event in `match_alert` and hands a BullMQ job the word; a worker expands
-- the events to their audience (one set-based insert per event) and carries
-- them. These two columns are the worker's bookkeeping, and what makes the
-- expansion safe under retries and several processes:
--
-- - `claimed_at`: a lease. A worker claims one pending event at a time with
--   `FOR UPDATE SKIP LOCKED`; a claim older than two minutes is taken to
--   belong to a worker that died, and another may expand the event again.
--   Expanding twice is harmless -- every notification carries the event key
--   as its dedupe key, so the second insert writes nothing.
-- - `expanded_at`: done. An event with this set is never expanded again, and
--   a correction waits until the goal it withdraws has it, so its audience
--   (the members told of the goal) is complete when it is read.
--
-- Events recorded before this change were expanded inline when they were
-- recorded, so they are marked done: the column is added with a default of
-- the migration's own time, which is then dropped so a new event starts
-- pending.

ALTER TABLE match_alert ADD COLUMN claimed_at timestamptz;
ALTER TABLE match_alert ADD COLUMN expanded_at timestamptz DEFAULT now();
ALTER TABLE match_alert ALTER COLUMN expanded_at DROP DEFAULT;

-- The worker's question is "what is pending", and the answer is a handful of
-- rows in a table that grows by every event of every match.
CREATE INDEX match_alert_pending_idx ON match_alert (created_at) WHERE expanded_at IS NULL;

COMMENT ON COLUMN match_alert.claimed_at IS
  'When a worker last claimed this event for expansion (T-835); a lease, taken over after two minutes.';
COMMENT ON COLUMN match_alert.expanded_at IS
  'When the event''s notifications were written (T-835); null while pending.';

-- Down Migration

DROP INDEX IF EXISTS match_alert_pending_idx;
ALTER TABLE match_alert DROP COLUMN IF EXISTS expanded_at;
ALTER TABLE match_alert DROP COLUMN IF EXISTS claimed_at;
