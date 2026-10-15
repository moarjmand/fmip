-- Up Migration
-- T-1417 (D-218): the shirts of past matches, asked for once each.
--
-- The `kit_colours` job asks the provider for the line-up of each finished
-- match that has a stored line-up and a side without a shirt, newest first,
-- within its batch and the bulk tier of the budget, and writes the answer
-- through the line-up writer (T-1416), which keeps the shirts and refreshes
-- the club's colour. `fixture_kit_fetch` is one row per match asked about: an
-- answered match is never asked again, an unanswered one again a day later,
-- at most five times in all (`kit-colours.ts`).
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is
-- replaced, no row is written). The new table has none.

ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads',
                 'people_names', 'kit_colours'));

CREATE TABLE fixture_kit_fetch (
  fixture_id   uuid PRIMARY KEY REFERENCES fixture (id) ON DELETE CASCADE,
  provider     text NOT NULL,
  asked_at     timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 1,
  answered_at  timestamptz,
  -- How many of the two sides the answer gave a shirt for.
  shirts       smallint,
  CONSTRAINT fixture_kit_fetch_attempts_positive CHECK (attempts > 0),
  CONSTRAINT fixture_kit_fetch_shirts_range CHECK (shirts IS NULL OR shirts BETWEEN 0 AND 2),
  CONSTRAINT fixture_kit_fetch_answer_complete CHECK ((answered_at IS NULL) = (shirts IS NULL))
);

CREATE INDEX fixture_kit_fetch_unanswered_idx
  ON fixture_kit_fetch (asked_at)
  WHERE answered_at IS NULL;

COMMENT ON TABLE fixture_kit_fetch IS
  'T-1417 (D-218): each finished match the kit_colours job asked the provider about for its shirts -- asks, when answered, and how many sides had a shirt.';

-- Down Migration

DROP TABLE fixture_kit_fetch;
DELETE FROM ingest_run WHERE job = 'kit_colours';
ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads', 'people_names'));
