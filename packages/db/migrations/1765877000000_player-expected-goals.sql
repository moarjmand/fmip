-- Up Migration
-- T-1432 (D-224): each player's expected goals in one match, from a source of
-- its own.
--
-- No provider behind `fixture_player_stat` supplies per-player expected goals;
-- Highlightly's box score does. Its figures live here, apart from that table,
-- so they are never averaged, ranked or shown with another source's numbers as
-- one figure (rules 3 and 6), and every reader names `source` beside them.
--
-- `fixture_player_expected` has the same long shape as `fixture_player_stat`:
-- a figure the source did not supply for a player is a missing row, never a
-- zero. `xgp` (goals prevented: xGOT conceded minus goals let in) is the one
-- figure that may be negative.
--
-- `fixture_box_score` is the match-level record that the source was asked and
-- answered: how many players it listed and how many of them we could not yet
-- place on our people (rule 1: through `provider_mapping` only; the rest are
-- queued in `unresolved_entity`). A match with a row here and no player row is
-- one the source answered without a figure -- `not_supplied`, said as such.
CREATE TABLE fixture_box_score (
  fixture_id  uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  source      text NOT NULL,
  fetched_at  timestamptz NOT NULL,
  players     integer NOT NULL,
  unresolved  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, source),
  CONSTRAINT fixture_box_score_source_check CHECK (source IN ('highlightly')),
  CONSTRAINT fixture_box_score_counts CHECK (
    players >= 0 AND unresolved >= 0 AND unresolved <= players
  )
);

CREATE TRIGGER fixture_box_score_set_updated_at
  BEFORE UPDATE ON fixture_box_score FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fixture_box_score IS
  'A per-player box score asked of a source and answered: players listed, players not yet mapped (T-1432).';

CREATE TABLE fixture_player_expected (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  source         text NOT NULL,
  metric         text NOT NULL,
  value          numeric(6, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_player_expected_source_check CHECK (source IN ('highlightly')),
  CONSTRAINT fixture_player_expected_metric_check CHECK (
    metric IN ('xg', 'xa', 'xgot', 'xgot_conceded', 'xgp')
  ),
  CONSTRAINT fixture_player_expected_sign CHECK (metric = 'xgp' OR value >= 0),
  CONSTRAINT fixture_player_expected_one_per_metric
    UNIQUE (participant_id, person_id, source, metric)
);

CREATE INDEX fixture_player_expected_person ON fixture_player_expected (person_id);

CREATE TRIGGER fixture_player_expected_set_updated_at
  BEFORE UPDATE ON fixture_player_expected FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fixture_player_expected IS
  'One player''s expected-goals figure in one match, as one named source supplied it; never blended with another source (T-1432).';

-- Down Migration

DROP TABLE fixture_player_expected;
DROP TABLE fixture_box_score;
