-- Up Migration
-- T-101: each player's numbers in one match.
--
-- One row per player, per metric, per side of a fixture -- the same long shape
-- as `fixture_stat`, so a metric the provider did not send for a player is a
-- missing row, never a zero (rule 3). The metric list is closed and mirrors
-- `PLAYER_STAT_METRICS` in `packages/ingestion/src/normalised.ts`: there is no
-- per-player expected goals because no provider in use supplies it, and no
-- pass accuracy because the one that sends it does not say whether it is a
-- count or a percentage. `rating` is the provider's own 0-10 mark.
--
-- A player appears here only once the catalogue holds them (D-079); an id it
-- does not hold is queued, not written as a blank. No change trigger: these
-- rows arrive in the same post-match write as the team's statistics, which
-- already wake the match's open streams.
CREATE TABLE fixture_player_stat (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  metric         text NOT NULL,
  value          numeric(6, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_player_stat_metric_check CHECK (
    metric IN (
      'minutes', 'rating', 'shots', 'shots_on_target', 'goals', 'assists',
      'key_passes', 'passes', 'tackles', 'blocks', 'interceptions',
      'duels', 'duels_won', 'dribbles', 'dribbles_won',
      'fouls_drawn', 'fouls_committed', 'offsides', 'yellow_cards', 'red_cards',
      'saves', 'goals_conceded'
    )
  ),
  CONSTRAINT fixture_player_stat_value_non_negative CHECK (value >= 0),
  CONSTRAINT fixture_player_stat_rating_range CHECK (metric <> 'rating' OR value <= 10),
  CONSTRAINT fixture_player_stat_one_per_metric UNIQUE (participant_id, person_id, metric)
);

CREATE INDEX fixture_player_stat_person ON fixture_player_stat (person_id);

CREATE TRIGGER fixture_player_stat_set_updated_at
  BEFORE UPDATE ON fixture_player_stat FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fixture_player_stat IS
  'One player''s value for one metric in one match, as the provider supplied it; absent means not supplied (T-101).';

-- Down Migration

DROP TABLE fixture_player_stat;
