-- Up Migration
-- T-1648, D-305: each finished match's line-ups and minutes from our own
-- records, in the training store, for the regulars index of the model-factor
-- experiments (T-1655, D-303): one row per player named on a side's line-up,
-- starter or bench, with the minutes the feed gave him, copied from `lineup`
-- and `fixture_player_stat` by the model's loader (`load records-lineups`,
-- `training/fixture_detail.py`). D-083 named line-ups among the records the
-- model may learn from.
--
-- A new table beside `training.match`, which it does not change, as
-- `training.fixture_stat` (T-1647): nothing the published version reads moves,
-- and nothing published reads this. Every competition is copied, those kept
-- out of `training.match` included (D-304), with the competition's id, kind,
-- scope and training division on each row, so the lab store, which has no
-- `public`, can filter (friendlies apart, say). No foreign key into `public`:
-- the lab copies the schema whole, and every load replaces every row.
--
-- A side without a stored line-up has no rows: a gap, never a default XI.
-- `minutes` is NULL when our records hold no minutes for the player: the feed
-- writes none for a substitute who did not come on (the adapter stores no row
-- rather than a zero, T-101), so on a side whose other players have minutes a
-- NULL is an unused substitute, and on a side where none has, the statistics
-- were not supplied. Neither is written as 0 (rule 3).
CREATE TABLE training.fixture_lineup (
  -- Our fixture, team and person ids (public.fixture, public.team, public.person).
  fixture_id        uuid NOT NULL,
  team_id           uuid NOT NULL,
  person_id         uuid NOT NULL,
  source_load_id    uuid NOT NULL REFERENCES training.source_load (id) ON DELETE RESTRICT,
  -- The provider our records of the match came from.
  source            text NOT NULL,
  side              text NOT NULL,
  competition_id    uuid NOT NULL,
  competition_kind  text NOT NULL,
  competition_scope text NOT NULL,
  -- The competition's training division (E0, IR1, ...), NULL for one without.
  division          text,
  season            text NOT NULL,
  -- The kick-off's date in UTC.
  match_date        date NOT NULL,
  -- In the XI (lineup.role = 'starter'), else on the bench.
  started           boolean NOT NULL,
  minutes           smallint,
  -- The line-up's position bucket, NULL when the feed gave none.
  position          text,
  CONSTRAINT fixture_lineup_pkey PRIMARY KEY (fixture_id, team_id, person_id),
  CONSTRAINT fixture_lineup_source_check CHECK (source IN ('api_football')),
  CONSTRAINT fixture_lineup_side_check CHECK (side IN ('home', 'away')),
  CONSTRAINT fixture_lineup_minutes_non_negative CHECK (minutes IS NULL OR minutes >= 0),
  CONSTRAINT fixture_lineup_position_check
    CHECK (position IS NULL OR position IN ('goalkeeper', 'defender', 'midfielder', 'forward'))
);

-- A side's recent matches, newest first: what the regulars index reads.
CREATE INDEX fixture_lineup_team_date_idx ON training.fixture_lineup (team_id, match_date);

COMMENT ON TABLE training.fixture_lineup IS
  'T-1648, D-305: each player named on a side''s line-up of a finished match of our own records, every competition, with whether he started and his minutes, for the lab experiments. No rows for a side = no stored line-up (a gap); NULL minutes = none in our records. Read by no published version.';

-- Down Migration

DROP TABLE IF EXISTS training.fixture_lineup;
