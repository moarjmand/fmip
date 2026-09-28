-- Up Migration

-- T-921, D-111: an Elo computed from our own training store, for the days
-- Club Elo does not answer. Computed by the model service from
-- `training.match` alone -- football-data.co.uk's divisions (D-016, training
-- only) and our own records of the licensed feed (D-083) -- so it stays within
-- D-014: nothing here comes from a source the critical path may not use.
--
-- A run is one computation: the day it rates clubs as of (every match on or
-- before it), the rules it used, and the matches it read, counted and hashed
-- in the order they were applied, so a day can be recomputed from the stored
-- results and checked against what was written. Its ratings are one row per
-- club that has played; a club with no match is absent, never given a default.
--
-- A club is its catalogue id where the committed bridge (D-080,
-- `training.team_alias`) names it, else `<division>:<name>`, a club of that
-- division only. Two sources' spellings are never matched by likeness.

CREATE TABLE training.own_elo_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day              date NOT NULL,
  -- The rules' name and version, e.g. own-elo@1.0.0: K, home advantage, start.
  rules            text NOT NULL,
  match_count      integer NOT NULL,
  first_match_date date,
  last_match_date  date,
  -- sha256 over the matches in the order they were applied.
  matches_sha256   text NOT NULL,
  club_count       integer NOT NULL,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT own_elo_run_counts CHECK (match_count >= 0 AND club_count >= 0),
  CONSTRAINT own_elo_run_matches_before_day CHECK (last_match_date IS NULL OR last_match_date <= day),
  CONSTRAINT own_elo_run_day_rules UNIQUE (day, rules)
);

CREATE TABLE training.own_elo (
  run_id          uuid NOT NULL REFERENCES training.own_elo_run (id) ON DELETE CASCADE,
  -- A catalogue team id, or '<division>:<name>' for a club the bridge does not name.
  club            text NOT NULL,
  -- The division of the club's newest match: where its rating was last moved.
  division        text NOT NULL,
  elo             numeric(7, 2) NOT NULL,
  matches         integer NOT NULL,
  last_match_date date NOT NULL,
  CONSTRAINT own_elo_pkey PRIMARY KEY (run_id, club),
  CONSTRAINT own_elo_has_history CHECK (matches > 0)
);

COMMENT ON TABLE training.own_elo_run IS
  'T-921, D-111: one computation of our own Elo from training.match, as of a day, with the rules and a hash of the matches it read. Recomputable from the stored results.';
COMMENT ON TABLE training.own_elo IS
  'T-921, D-111: each club''s own Elo in a run. Clubs are catalogue ids through training.team_alias (D-080) or <division>:<name>; a club with no match has no row.';

-- Down Migration

DROP TABLE IF EXISTS training.own_elo;
DROP TABLE IF EXISTS training.own_elo_run;
