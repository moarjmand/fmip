-- Up Migration
-- T-1437 (D-228): teams' season statistics as the provider counts them.
--
-- The `team_seasons` job asks API-Football's `/teams/statistics` for each team
-- that plays in a season we hold, one competition and season at a time. What
-- it keeps:
--
--  - `team_season_stat`: one row per team and season (a season is one
--    competition's), the provider's numbers as it sent them: a count it left
--    out is NULL, never 0. Each answer replaces the row. The minute bands and
--    the penalties are NULL, with `bands_withheld`, when the provider's bands
--    miss its own goal totals: a cup's count the kicks of a penalty shoot-out,
--    and those are not goals (D-228). Home and away are kept apart; a total is
--    their sum, read.
--  - `team_season_fetch`: one row per ask, when it was asked and answered, and
--    whether the answer carried statistics (`supplied`); a team the provider
--    has none for there is answered, and has no stat row. `failures` counts
--    unanswered asks since the last answer (`team-seasons.ts` gives up after
--    five).
--
-- The rows are derived and re-fetchable, so they go with the team or season
-- they hang on (ON DELETE CASCADE).
--
-- `ingest_run_job_check` gains `team_seasons`. Other jobs are being added in
-- parallel, so this reads the constraint as it stands and adds only its own
-- name, rather than writing the whole list (and the down migration removes
-- only its own).
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is
-- replaced, no row is written). The new tables have none.

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'ingest_run_job_check' AND conrelid = 'ingest_run'::regclass;
  IF def IS NULL OR position('ARRAY[' IN def) = 0 THEN
    RAISE EXCEPTION 'ingest_run_job_check is not a list of jobs: %', def;
  END IF;
  IF position('''team_seasons''' IN def) = 0 THEN
    ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
    EXECUTE 'ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check '
      || replace(def, 'ARRAY[', 'ARRAY[''team_seasons''::text, ');
  END IF;
END $$;

CREATE TABLE team_season_stat (
  source                 text NOT NULL,
  team_id                uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  season_id              uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  played_home            smallint,
  played_away            smallint,
  wins_home              smallint,
  wins_away              smallint,
  draws_home             smallint,
  draws_away             smallint,
  losses_home            smallint,
  losses_away            smallint,
  goals_for_home         smallint,
  goals_for_away         smallint,
  goals_against_home     smallint,
  goals_against_away     smallint,
  clean_sheets_home      smallint,
  clean_sheets_away      smallint,
  failed_to_score_home   smallint,
  failed_to_score_away   smallint,
  -- Oldest result first: W, D and L only.
  form                   text,
  -- [{"from": 0, "to": 15, "goals": 9}, ...], bands with a goal only.
  goals_for_by_minute    jsonb,
  goals_against_by_minute jsonb,
  bands_withheld         boolean NOT NULL DEFAULT false,
  penalties_scored       smallint,
  penalties_missed       smallint,
  -- {"win": {"home": {"for": 4, "against": 2} | null, "away": ...},
  --  "defeat": {...}, "run": {"wins": 4, "draws": 3, "losses": 1}}
  biggest                jsonb NOT NULL,
  -- [{"formation": "4-2-3-1", "played": 20}, ...], most used first.
  formations             jsonb NOT NULL,
  fetched_at             timestamptz NOT NULL,
  PRIMARY KEY (source, team_id, season_id),
  CONSTRAINT team_season_stat_source_check CHECK (source IN ('api_football')),
  CONSTRAINT team_season_stat_played CHECK (coalesce(played_home, 0) + coalesce(played_away, 0) > 0),
  CONSTRAINT team_season_stat_counts_non_negative CHECK (
    coalesce(played_home, 0) >= 0 AND coalesce(played_away, 0) >= 0
    AND coalesce(wins_home, 0) >= 0 AND coalesce(wins_away, 0) >= 0
    AND coalesce(draws_home, 0) >= 0 AND coalesce(draws_away, 0) >= 0
    AND coalesce(losses_home, 0) >= 0 AND coalesce(losses_away, 0) >= 0
    AND coalesce(goals_for_home, 0) >= 0 AND coalesce(goals_for_away, 0) >= 0
    AND coalesce(goals_against_home, 0) >= 0 AND coalesce(goals_against_away, 0) >= 0
    AND coalesce(clean_sheets_home, 0) >= 0 AND coalesce(clean_sheets_away, 0) >= 0
    AND coalesce(failed_to_score_home, 0) >= 0 AND coalesce(failed_to_score_away, 0) >= 0
    AND coalesce(penalties_scored, 0) >= 0 AND coalesce(penalties_missed, 0) >= 0),
  CONSTRAINT team_season_stat_form_letters CHECK (form IS NULL OR form ~ '^[WDL]+$'),
  CONSTRAINT team_season_stat_withheld CHECK (
    NOT bands_withheld OR (goals_for_by_minute IS NULL AND goals_against_by_minute IS NULL
                           AND penalties_scored IS NULL AND penalties_missed IS NULL)),
  CONSTRAINT team_season_stat_json_shapes CHECK (
    jsonb_typeof(biggest) = 'object' AND jsonb_typeof(formations) = 'array'
    AND (goals_for_by_minute IS NULL OR jsonb_typeof(goals_for_by_minute) = 'array')
    AND (goals_against_by_minute IS NULL OR jsonb_typeof(goals_against_by_minute) = 'array'))
);

CREATE INDEX team_season_stat_team_idx ON team_season_stat (team_id);
CREATE INDEX team_season_stat_season_idx ON team_season_stat (season_id);

COMMENT ON TABLE team_season_stat IS
  'T-1437 (D-228): a team''s statistics for one season of one competition as the provider counts them. Shown as the provider''s, beside our own table and splits, never mixed into them.';

CREATE TABLE team_season_fetch (
  provider    text NOT NULL,
  team_id     uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  season_id   uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  failures    smallint NOT NULL DEFAULT 0,
  answered_at timestamptz,
  -- Of the last answer: whether it carried statistics for the team there.
  supplied    boolean,
  PRIMARY KEY (provider, team_id, season_id),
  CONSTRAINT team_season_fetch_failures_range CHECK (failures >= 0),
  CONSTRAINT team_season_fetch_answer_complete CHECK ((answered_at IS NULL) = (supplied IS NULL))
);

CREATE INDEX team_season_fetch_season_idx ON team_season_fetch (season_id);

COMMENT ON TABLE team_season_fetch IS
  'T-1437 (D-228): each team and season the team_seasons job asked the provider about -- asks, the last answer, and whether it carried statistics.';

-- Down Migration

DROP TABLE team_season_fetch;
DROP TABLE team_season_stat;
DELETE FROM ingest_run WHERE job = 'team_seasons';
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'ingest_run_job_check' AND conrelid = 'ingest_run'::regclass;
  IF position('''team_seasons''' IN def) > 0 THEN
    ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
    EXECUTE 'ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check '
      || replace(replace(def, '''team_seasons''::text, ', ''), ', ''team_seasons''::text', '');
  END IF;
END $$;
