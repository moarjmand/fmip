-- Up Migration
-- T-1650 (D-306; D-303 point 4): past seasons' absences, for the training
-- store only.
--
-- `absence_history` holds every absence the provider listed for every match
-- of a past season (`/injuries?league=&season=`, one answer a season),
-- written by the operator's command `dist/cli/absence-history.js`. It is not
-- `fixture_absence`: that one is the match page's team news, and nothing in
-- the API's routes or the web app reads this one. The model's loader copies
-- it into `training.absence` (`load.py records-absences`), which only the
-- experiments of Phase 14 read; the published version reads neither.
--
-- Keys (rule 1: never a name). The match and the club are ours, through
-- `provider_mapping`; an entry whose match or club we do not hold is not
-- written, and the command counts it. The player is ours when mapped, and
-- the provider's id is kept in `provider_person_id` in every row: it is the
-- row's key with the provider, so a run after the person is mapped lands on
-- the same row and fills `person_id` in. The provider's words for the reason
-- are kept beside what they amount to, as in `fixture_absence`.
--
-- `ingest_run.job` gains `absence_history`, so the command's run, and the
-- requests it spent, are on `/health/ingestion` and counted in the day's
-- budget like any job's. It is not scheduled.
--
-- `training.absence` is the copy. Its ids carry no foreign key into
-- `public`: the lab store (D-303) holds the `training` schema without it.
-- A competition and season it holds no row for is one whose absences the
-- provider did not list, not one where nobody was missing.
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only, `training.source_load`
-- none (constraints are replaced, no row is written). The new tables have none.

DO $$
DECLARE
  jobs text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO jobs
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'ingest_run_job_check' AND c.conrelid = 'ingest_run'::regclass;
  IF jobs IS NULL OR NOT 'fixtures' = ANY (jobs) THEN
    RAISE EXCEPTION 'ingest_run_job_check could not be read';
  END IF;
  IF NOT 'absence_history' = ANY (jobs) THEN
    jobs := jobs || 'absence_history'::text;
  END IF;
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ') FROM unnest(jobs) AS j));
END
$$;

CREATE TABLE absence_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider           text NOT NULL,
  fixture_id         uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  season_id          uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  team_id            uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  person_id          uuid REFERENCES person (id) ON DELETE SET NULL,
  provider_person_id text NOT NULL,
  status             text NOT NULL,
  kind               text,
  -- The provider's words, e.g. "Knee Injury"; NULL when it gave none.
  reason             text,
  -- When the provider gave the answer this row was last written from.
  fetched_at         timestamptz NOT NULL,
  CONSTRAINT absence_history_provider_check CHECK (provider IN ('api_football')),
  CONSTRAINT absence_history_provider_person_not_blank CHECK (btrim(provider_person_id) <> ''),
  CONSTRAINT absence_history_status_check CHECK (status IN ('out', 'doubtful')),
  CONSTRAINT absence_history_kind_check
    CHECK (kind IS NULL OR kind IN ('injury', 'suspension', 'illness', 'other')),
  CONSTRAINT absence_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT absence_history_once UNIQUE (provider, fixture_id, provider_person_id)
);

CREATE INDEX absence_history_season_idx ON absence_history (season_id);
CREATE INDEX absence_history_person_idx ON absence_history (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX absence_history_unmapped_idx
  ON absence_history (provider, provider_person_id) WHERE person_id IS NULL;

COMMENT ON TABLE absence_history IS
  'T-1650 (D-306): absences the provider listed for past seasons'' matches, for the training store only; never shown, never read by the API''s routes or the web app.';
COMMENT ON COLUMN absence_history.provider_person_id IS
  'The provider''s id for the player: the row''s key with the provider, kept so a later run fills person_id in once the person is mapped.';

DO $$
DECLARE
  sources text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO sources
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'source_load_source_check' AND c.conrelid = 'training.source_load'::regclass;
  IF sources IS NULL OR NOT 'our_records' = ANY (sources) THEN
    RAISE EXCEPTION 'source_load_source_check could not be read';
  END IF;
  IF NOT 'our_absences' = ANY (sources) THEN
    sources := sources || 'our_absences'::text;
  END IF;
  ALTER TABLE training.source_load DROP CONSTRAINT source_load_source_check;
  EXECUTE format(
    'ALTER TABLE training.source_load ADD CONSTRAINT source_load_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(s), ', ') FROM unnest(sources) AS s));
END
$$;

CREATE TABLE training.absence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_load_id     uuid NOT NULL REFERENCES training.source_load (id) ON DELETE RESTRICT,
  -- Our catalogue's ids, without foreign keys (see above).
  fixture_id         uuid NOT NULL,
  competition_id     uuid NOT NULL,
  -- '2023/24', the catalogue's label.
  season             text NOT NULL,
  match_date         date NOT NULL,
  team_id            uuid NOT NULL,
  person_id          uuid,
  provider_person_id text NOT NULL,
  status             text NOT NULL,
  kind               text,
  CONSTRAINT absence_status_check CHECK (status IN ('out', 'doubtful')),
  CONSTRAINT absence_kind_check
    CHECK (kind IS NULL OR kind IN ('injury', 'suspension', 'illness', 'other')),
  CONSTRAINT absence_once UNIQUE (fixture_id, provider_person_id)
);

CREATE INDEX absence_team_date_idx ON training.absence (team_id, match_date);
CREATE INDEX absence_competition_season_idx ON training.absence (competition_id, season);

COMMENT ON TABLE training.absence IS
  'T-1650 (D-306): the copy of absence_history the Phase 14 experiments read; the published version does not. No row for a competition and season means the provider listed none there, not that nobody was missing.';

-- Down Migration

DROP TABLE training.absence;

-- Loads already recorded from it stay (training.source_load is never
-- deleted from); the narrower check applies to new rows only.
DO $$
DECLARE
  sources text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO sources
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'source_load_source_check' AND c.conrelid = 'training.source_load'::regclass;
  sources := array_remove(sources, 'our_absences');
  ALTER TABLE training.source_load DROP CONSTRAINT source_load_source_check;
  EXECUTE format(
    'ALTER TABLE training.source_load ADD CONSTRAINT source_load_source_check CHECK (source IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(s), ', ') FROM unnest(sources) AS s));
END
$$;

DROP TABLE absence_history;
DELETE FROM ingest_run WHERE job = 'absence_history';
DO $$
DECLARE
  jobs text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO jobs
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'ingest_run_job_check' AND c.conrelid = 'ingest_run'::regclass;
  jobs := array_remove(jobs, 'absence_history');
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ') FROM unnest(jobs) AS j));
END
$$;
