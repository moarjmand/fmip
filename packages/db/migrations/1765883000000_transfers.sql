-- Up Migration
-- T-1440 (D-231): transfers, as the provider lists them.
--
-- The `transfers` job asks API-Football's `/transfers` for each club of a
-- current season (`?team=`) and for each player named in a current season's
-- line-up (`?player=`): weekly while a transfer window is open, monthly
-- otherwise. What it keeps:
--
--  - `transfer_listing`: one row per move in one answer. The answer belongs to
--    the club or the person asked about (`subject_team_id` or
--    `subject_person_id`, exactly one), and each answer replaces that
--    subject's rows, so a move the provider drops goes too. The player and the
--    two clubs are joined to ours through `provider_mapping` (rule 1); a
--    player or club we do not hold keeps only the provider's name, shown as
--    text and never used as a key or matched to an entity of ours. The
--    provider's name is kept beside a mapped id too, so a row reads the same
--    if a mapping is later removed. A club side may be empty: a player
--    released, or one arriving without a club.
--  - `team_transfer_fetch` / `person_transfer_fetch`: one row per subject asked,
--    when it was asked and answered, how many moves came back, and how many of
--    their players and clubs we hold. `failures` counts unanswered asks since
--    the last answer (`transfers.ts` gives up after five).
--
-- The rows are re-fetchable. They go with the subject they hang on (ON DELETE
-- CASCADE); a deleted player or club on the other side leaves the name.
--
-- `ingest_run_job_check` is rebuilt from the constraint as it stands, plus
-- `transfers`, rather than from a list written here: sessions add jobs in
-- parallel, and a list would drop whichever job landed after it was written.
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is replaced,
-- no row is written). The new tables have none.

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
  IF NOT 'transfers' = ANY (jobs) THEN
    jobs := jobs || 'transfers'::text;
  END IF;
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ') FROM unnest(jobs) AS j));
END
$$;

CREATE TABLE transfer_listing (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source            text NOT NULL,
  subject_team_id   uuid REFERENCES team (id) ON DELETE CASCADE,
  subject_person_id uuid REFERENCES person (id) ON DELETE CASCADE,
  person_id         uuid REFERENCES person (id) ON DELETE SET NULL,
  -- The provider's name for the player, as it wrote it.
  person_name       text NOT NULL,
  transfer_date     date NOT NULL,
  kind              text NOT NULL,
  -- The provider's fee as it wrote it ("€ 75M"), for a fee only.
  fee               text,
  from_team_id      uuid REFERENCES team (id) ON DELETE SET NULL,
  from_name         text,
  to_team_id        uuid REFERENCES team (id) ON DELETE SET NULL,
  to_name           text,
  fetched_at        timestamptz NOT NULL,
  CONSTRAINT transfer_listing_source_check CHECK (source IN ('api_football')),
  CONSTRAINT transfer_listing_one_subject CHECK (num_nonnulls(subject_team_id, subject_person_id) = 1),
  CONSTRAINT transfer_listing_kind_check
    CHECK (kind IN ('loan', 'loan_return', 'free', 'fee', 'transfer', 'unknown')),
  CONSTRAINT transfer_listing_fee_only_for_fee CHECK ((kind = 'fee') = (fee IS NOT NULL)),
  CONSTRAINT transfer_listing_from_named CHECK (from_team_id IS NULL OR from_name IS NOT NULL),
  CONSTRAINT transfer_listing_to_named CHECK (to_team_id IS NULL OR to_name IS NOT NULL),
  CONSTRAINT transfer_listing_a_club CHECK (from_name IS NOT NULL OR to_name IS NOT NULL)
);

CREATE INDEX transfer_listing_subject_team_idx
  ON transfer_listing (subject_team_id, transfer_date DESC) WHERE subject_team_id IS NOT NULL;
CREATE INDEX transfer_listing_subject_person_idx
  ON transfer_listing (subject_person_id) WHERE subject_person_id IS NOT NULL;
CREATE INDEX transfer_listing_person_idx
  ON transfer_listing (person_id, transfer_date DESC) WHERE person_id IS NOT NULL;
CREATE INDEX transfer_listing_from_team_idx ON transfer_listing (from_team_id);
CREATE INDEX transfer_listing_to_team_idx ON transfer_listing (to_team_id);

COMMENT ON TABLE transfer_listing IS
  'T-1440 (D-231): moves of players between clubs, as the provider lists them for a club or a player we asked about. A player or club we do not hold is a name only.';

CREATE TABLE team_transfer_fetch (
  provider    text NOT NULL,
  team_id     uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  failures    smallint NOT NULL DEFAULT 0,
  answered_at timestamptz,
  -- Of the last answer: the moves it listed, and of those the ones whose
  -- player we hold.
  moves       smallint,
  players_held smallint,
  PRIMARY KEY (provider, team_id),
  CONSTRAINT team_transfer_fetch_failures_range CHECK (failures >= 0),
  CONSTRAINT team_transfer_fetch_answer_complete CHECK (
    (answered_at IS NULL) = (moves IS NULL) AND (moves IS NULL) = (players_held IS NULL)),
  CONSTRAINT team_transfer_fetch_adds_up CHECK (moves IS NULL OR players_held <= moves)
);

CREATE TABLE person_transfer_fetch (
  provider    text NOT NULL,
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  failures    smallint NOT NULL DEFAULT 0,
  answered_at timestamptz,
  moves       smallint,
  PRIMARY KEY (provider, person_id),
  CONSTRAINT person_transfer_fetch_failures_range CHECK (failures >= 0),
  CONSTRAINT person_transfer_fetch_answer_complete CHECK ((answered_at IS NULL) = (moves IS NULL))
);

COMMENT ON TABLE team_transfer_fetch IS
  'T-1440 (D-231): each club the transfers job asked the provider about -- asks, the last answer, and what it held.';
COMMENT ON TABLE person_transfer_fetch IS
  'T-1440 (D-231): each player the transfers job asked the provider about -- asks and the last answer.';

-- Down Migration

DROP TABLE person_transfer_fetch;
DROP TABLE team_transfer_fetch;
DROP TABLE transfer_listing;
DELETE FROM ingest_run WHERE job = 'transfers';
DO $$
DECLARE
  jobs text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO jobs
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'ingest_run_job_check' AND c.conrelid = 'ingest_run'::regclass;
  jobs := array_remove(jobs, 'transfers');
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ') FROM unnest(jobs) AS j));
END
$$;
