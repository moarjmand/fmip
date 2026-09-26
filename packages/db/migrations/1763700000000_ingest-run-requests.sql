-- Up Migration
-- T-501: how many requests each ingest run sent to its provider.
--
-- The provider counts every request against the plan's day; until now nothing
-- here did, so the first overrun would have been its refusal in the middle of
-- a match day. `requests` is what the run sent, refusals by our own budget
-- excluded (they are never sent). NULL for every run recorded before this
-- column existed: unknown, not zero -- nothing is back-filled, because nothing
-- recorded what those runs spent.

ALTER TABLE ingest_run ADD COLUMN requests integer;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_requests_non_negative
  CHECK (requests IS NULL OR requests >= 0);

COMMENT ON COLUMN ingest_run.requests IS
  'Requests this run sent to its provider (T-501); NULL for runs recorded before it was counted.';

-- Down Migration

ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_requests_non_negative;
ALTER TABLE ingest_run DROP COLUMN requests;
