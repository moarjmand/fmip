-- Up Migration

-- T-060: the training store, as its own schema (D-028). Historical results,
-- bookmaker odds and Club Elo ratings for training and backtesting the model
-- (D-016). Nothing in `public` references it and `apps/api` never queries it
-- (D-014: research data stays off the critical path); the model service is
-- its only reader and the loader its only writer.
--
-- Team names are text here, not UUIDs. This is deliberate and confined: the
-- sources identify teams by name, the data is for offline research, and
-- mapping decades of historical names onto the catalog is the model's problem
-- at training time, not a schema rule to bend rule 1 for.

CREATE SCHEMA training;

COMMENT ON SCHEMA training IS
  'Offline training and backtesting data (D-016). Never read by apps/api or apps/web (D-014).';

-- ---------------------------------------------------------------------------
-- source_load: one row per download. The version of a dataset is the load
-- that produced it: what was fetched, from where, under which terms, with
-- which content hash, and how it ended. Rows are never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE training.source_load (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,
  -- What was asked for, in the source's own terms: 'E0 2024/25', '2025-08-01'.
  scope          text NOT NULL,
  url            text NOT NULL,
  licence_url    text NOT NULL,
  licence_note   text NOT NULL,
  content_sha256 text,
  row_count      integer,
  status         text NOT NULL DEFAULT 'running',
  error          text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  CONSTRAINT source_load_source_check CHECK (source IN ('football_data_co_uk', 'clubelo')),
  CONSTRAINT source_load_status_check CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT source_load_running_is_open CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT source_load_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL),
  CONSTRAINT source_load_succeeded_has_hash
    CHECK (status <> 'succeeded' OR (content_sha256 IS NOT NULL AND row_count IS NOT NULL))
);

CREATE INDEX source_load_recent_idx ON training.source_load (source, scope, started_at DESC);

-- ---------------------------------------------------------------------------
-- match: one row per historical fixture from football-data.co.uk. The natural
-- key is (division, match_date, home_team, away_team); reloading a season
-- updates rows in place and points them at the new load.
-- ---------------------------------------------------------------------------
CREATE TABLE training.match (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_load_id         uuid NOT NULL REFERENCES training.source_load (id) ON DELETE RESTRICT,
  -- football-data.co.uk division code: E0 = Premier League, SP1 = La Liga, ...
  division               text NOT NULL,
  -- '2024/25'
  season                 text NOT NULL,
  match_date             date NOT NULL,
  home_team              text NOT NULL,
  away_team              text NOT NULL,
  home_goals             smallint NOT NULL,
  away_goals             smallint NOT NULL,
  result                 text NOT NULL,
  ht_home_goals          smallint,
  ht_away_goals          smallint,
  home_shots             smallint,
  away_shots             smallint,
  home_shots_on_target   smallint,
  away_shots_on_target   smallint,
  -- Closing 1X2 odds from one bookmaker column set, named in odds_source.
  odds_home              numeric(8, 3),
  odds_draw              numeric(8, 3),
  odds_away              numeric(8, 3),
  odds_source            text,
  CONSTRAINT match_goals_non_negative CHECK (home_goals >= 0 AND away_goals >= 0),
  CONSTRAINT match_result_check CHECK (result IN ('H', 'D', 'A')),
  CONSTRAINT match_result_matches_goals CHECK (
    result = CASE WHEN home_goals > away_goals THEN 'H' WHEN home_goals < away_goals THEN 'A' ELSE 'D' END
  ),
  CONSTRAINT match_odds_positive CHECK (
    (odds_home IS NULL OR odds_home > 1) AND (odds_draw IS NULL OR odds_draw > 1) AND (odds_away IS NULL OR odds_away > 1)
  ),
  CONSTRAINT match_odds_complete CHECK (
    (odds_home IS NULL) = (odds_draw IS NULL) AND (odds_draw IS NULL) = (odds_away IS NULL)
  ),
  CONSTRAINT match_teams_differ CHECK (home_team <> away_team),
  CONSTRAINT match_natural_key UNIQUE (division, match_date, home_team, away_team)
);

CREATE INDEX match_season_idx ON training.match (division, season);
CREATE INDEX match_date_idx ON training.match (match_date);

-- ---------------------------------------------------------------------------
-- elo: Club Elo ratings, one row per club per validity interval as the source
-- publishes them.
-- ---------------------------------------------------------------------------
CREATE TABLE training.elo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_load_id uuid NOT NULL REFERENCES training.source_load (id) ON DELETE RESTRICT,
  club           text NOT NULL,
  country        text NOT NULL,
  level          smallint NOT NULL,
  elo            numeric(8, 3) NOT NULL,
  rank           smallint,
  from_date      date NOT NULL,
  to_date        date NOT NULL,
  CONSTRAINT elo_dates_ordered CHECK (to_date >= from_date),
  CONSTRAINT elo_natural_key UNIQUE (club, from_date)
);

CREATE INDEX elo_club_date_idx ON training.elo (club, from_date);

-- Down Migration

DROP SCHEMA IF EXISTS training CASCADE;
