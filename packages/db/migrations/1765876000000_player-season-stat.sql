-- Up Migration
-- T-1431 (D-223): players' season totals and careers as the provider counts them.
--
-- The `player_seasons` job asks API-Football for each player's totals in the
-- current season, in every competition it covers (cups and national-team
-- matches we do not ingest match by match among them), and for the teams the
-- player has played for, season by season. What it keeps:
--
--  - `player_season_stat`: one row per player, season, competition and team,
--    the provider's numbers as it sent them (a count it left out is NULL,
--    never 0). Only competitions and teams `provider_mapping` knows are kept
--    (rule 1: no entity without our id, no name as a key); the others are
--    counted on the ask row. Each answer replaces the player's rows for that
--    season and source, so a line the provider drops goes too.
--  - `player_career_season`: one row per player, team and season start year,
--    the same way. Not `player_spell`: a spell needs a start date, and the
--    provider gives only season years; a spell is also what "current team"
--    reads, which a career list must not change.
--  - `player_season_fetch` / `player_career_fetch`: one row per ask target,
--    when it was asked and answered, how many lines came back, were kept, and
--    were left out as unknown to us. `failures` counts unanswered asks since
--    the last answer (`player-seasons.ts` gives up after five).
--
-- The rows are derived and re-fetchable, so they go with the person, team or
-- competition they hang on (ON DELETE CASCADE).
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is
-- replaced, no row is written). The new tables have none.

ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads',
                 'people_names', 'kit_colours', 'player_seasons'));

CREATE TABLE player_season_stat (
  source              text NOT NULL,
  person_id           uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  -- The year the season starts in: 2026 for "2026/27" and for "2026".
  season_year         smallint NOT NULL,
  competition_id      uuid NOT NULL REFERENCES competition (id) ON DELETE CASCADE,
  team_id             uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  appearances         smallint NOT NULL,
  starts              smallint,
  minutes             integer,
  goals               smallint,
  assists             smallint,
  yellow_cards        smallint,
  second_yellow_cards smallint,
  red_cards           smallint,
  -- A goalkeeper's two; NULL for everyone else.
  saves               smallint,
  goals_conceded      smallint,
  rating              numeric(4, 2),
  fetched_at          timestamptz NOT NULL,
  PRIMARY KEY (source, person_id, season_year, competition_id, team_id),
  CONSTRAINT player_season_stat_source_check CHECK (source IN ('api_football')),
  CONSTRAINT player_season_stat_year_range CHECK (season_year BETWEEN 1870 AND 2100),
  CONSTRAINT player_season_stat_appeared CHECK (appearances > 0),
  CONSTRAINT player_season_stat_counts_non_negative CHECK (
    coalesce(starts, 0) >= 0 AND coalesce(minutes, 0) >= 0 AND coalesce(goals, 0) >= 0
    AND coalesce(assists, 0) >= 0 AND coalesce(yellow_cards, 0) >= 0
    AND coalesce(second_yellow_cards, 0) >= 0 AND coalesce(red_cards, 0) >= 0
    AND coalesce(saves, 0) >= 0 AND coalesce(goals_conceded, 0) >= 0),
  CONSTRAINT player_season_stat_rating_range CHECK (rating IS NULL OR (rating > 0 AND rating <= 10))
);

CREATE INDEX player_season_stat_person_idx ON player_season_stat (person_id, season_year DESC);
CREATE INDEX player_season_stat_competition_idx ON player_season_stat (competition_id);
CREATE INDEX player_season_stat_team_idx ON player_season_stat (team_id);

COMMENT ON TABLE player_season_stat IS
  'T-1431 (D-223): a player''s season totals per competition and team as the provider counts them. Shown beside, never mixed into, our own per-match record.';

CREATE TABLE player_career_season (
  source      text NOT NULL,
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  season_year smallint NOT NULL,
  fetched_at  timestamptz NOT NULL,
  PRIMARY KEY (source, person_id, team_id, season_year),
  CONSTRAINT player_career_season_source_check CHECK (source IN ('api_football')),
  CONSTRAINT player_career_season_year_range CHECK (season_year BETWEEN 1870 AND 2100)
);

CREATE INDEX player_career_season_team_idx ON player_career_season (team_id);

COMMENT ON TABLE player_career_season IS
  'T-1431 (D-223): the seasons a player spent at a club or national team, as the provider lists them. Season years only; not a spell.';

CREATE TABLE player_season_fetch (
  provider     text NOT NULL,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  season_year  smallint NOT NULL,
  asked_at     timestamptz NOT NULL DEFAULT now(),
  failures     smallint NOT NULL DEFAULT 0,
  answered_at  timestamptz,
  -- Of the last answer: the lines it carried, the lines kept, and the lines
  -- left out because the competition or the team is unknown to us.
  lines        smallint,
  kept         smallint,
  unmapped     smallint,
  PRIMARY KEY (provider, person_id, season_year),
  CONSTRAINT player_season_fetch_failures_range CHECK (failures >= 0),
  CONSTRAINT player_season_fetch_answer_complete CHECK (
    (answered_at IS NULL) = (lines IS NULL) AND (lines IS NULL) = (kept IS NULL)
    AND (kept IS NULL) = (unmapped IS NULL)),
  CONSTRAINT player_season_fetch_answer_adds_up CHECK (lines IS NULL OR lines = kept + unmapped)
);

CREATE TABLE player_career_fetch (
  provider     text NOT NULL,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  asked_at     timestamptz NOT NULL DEFAULT now(),
  failures     smallint NOT NULL DEFAULT 0,
  answered_at  timestamptz,
  -- Of the last answer: the teams it listed, kept, and left out as unknown to us.
  teams        smallint,
  kept         smallint,
  unmapped     smallint,
  PRIMARY KEY (provider, person_id),
  CONSTRAINT player_career_fetch_failures_range CHECK (failures >= 0),
  CONSTRAINT player_career_fetch_answer_complete CHECK (
    (answered_at IS NULL) = (teams IS NULL) AND (teams IS NULL) = (kept IS NULL)
    AND (kept IS NULL) = (unmapped IS NULL)),
  CONSTRAINT player_career_fetch_answer_adds_up CHECK (teams IS NULL OR teams = kept + unmapped)
);

COMMENT ON TABLE player_season_fetch IS
  'T-1431 (D-223): each player and season the player_seasons job asked the provider about -- asks, the last answer, and what it kept.';
COMMENT ON TABLE player_career_fetch IS
  'T-1431 (D-223): each player the player_seasons job asked the provider for a career -- asks, the last answer, and what it kept.';

-- Down Migration

DROP TABLE player_career_fetch;
DROP TABLE player_season_fetch;
DROP TABLE player_career_season;
DROP TABLE player_season_stat;
DELETE FROM ingest_run WHERE job = 'player_seasons';
ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads',
                 'people_names', 'kit_colours'));
