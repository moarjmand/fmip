-- Up Migration
-- T-1647, D-305: each finished match's team statistics from our own records,
-- in the training store, for the model-factor experiments (D-303): expected
-- goals, shots and shots on target per side, copied from `fixture_stat` by the
-- model's loader (`load records-stats`, `training/fixture_detail.py`). Training
-- on the feed's records was allowed in D-083; this reads them as `records`
-- does, from our tables, never from the provider.
--
-- A new table, not new columns or rows of `training.match`: the published
-- version (dixon-coles-elo@0.6.0) fits on `training.match`, and our own Elo is
-- computed over every row of it, so nothing the published version reads
-- changes. Nothing published reads this table.
--
-- Every competition is copied, those kept out of `training.match` included
-- (`competition.model_training = false`, D-304): the lab store needs the cups.
-- Each row carries its competition's id, kind, scope and training division, so
-- an experiment can filter without `public`, which the lab store
-- (`scripts/model-lab-setup.sh`) does not have.
--
-- Keyed by our own ids and with no foreign key into `public`: the lab copies
-- the schema whole, and every load replaces every row, so a fixture removed
-- from the catalogue is gone after the next load. A football-data.co.uk row of
-- `training.match` names its clubs by the site's names; an experiment reaches
-- these rows through `training.team_alias` (division, name -> team id) and the
-- date (docs/15-model.md).
--
-- A figure the feed did not supply is NULL, never 0 (rule 3); a match with
-- none of the six has no row, and a missing row is a gap.
CREATE TABLE training.fixture_stat (
  -- Our fixture id (public.fixture.id).
  fixture_id            uuid PRIMARY KEY,
  source_load_id        uuid NOT NULL REFERENCES training.source_load (id) ON DELETE RESTRICT,
  -- The provider our records of the match came from.
  source                text NOT NULL,
  competition_id        uuid NOT NULL,
  competition_kind      text NOT NULL,
  competition_scope     text NOT NULL,
  -- The competition's training division (E0, IR1, ...), NULL for one without.
  division              text,
  -- The season's label, as the catalogue writes it: '2024/25', '2026'.
  season                text NOT NULL,
  -- The kick-off's date in UTC.
  match_date            date NOT NULL,
  home_team_id          uuid NOT NULL,
  away_team_id          uuid NOT NULL,
  home_xg               numeric(8, 2),
  away_xg               numeric(8, 2),
  home_shots            smallint,
  away_shots            smallint,
  home_shots_on_target  smallint,
  away_shots_on_target  smallint,
  CONSTRAINT fixture_stat_source_check CHECK (source IN ('api_football')),
  CONSTRAINT fixture_stat_teams_differ CHECK (home_team_id <> away_team_id),
  CONSTRAINT fixture_stat_non_negative CHECK (
    (home_xg IS NULL OR home_xg >= 0) AND (away_xg IS NULL OR away_xg >= 0)
    AND (home_shots IS NULL OR home_shots >= 0) AND (away_shots IS NULL OR away_shots >= 0)
    AND (home_shots_on_target IS NULL OR home_shots_on_target >= 0)
    AND (away_shots_on_target IS NULL OR away_shots_on_target >= 0)
  ),
  -- A row is a match with at least one figure: an empty row would look like coverage.
  CONSTRAINT fixture_stat_has_a_figure CHECK (
    num_nonnulls(home_xg, away_xg, home_shots, away_shots,
                 home_shots_on_target, away_shots_on_target) > 0
  )
);

CREATE INDEX fixture_stat_date_idx ON training.fixture_stat (match_date);

COMMENT ON TABLE training.fixture_stat IS
  'T-1647, D-305: team statistics of each finished match of our own records (xG, shots, shots on target per side), every competition, for the lab experiments. NULL = not supplied; no row = a gap. Read by no published version.';

-- Down Migration

DROP TABLE IF EXISTS training.fixture_stat;
