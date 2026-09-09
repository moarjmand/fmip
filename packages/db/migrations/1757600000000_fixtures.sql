-- Up Migration

-- T-011: the match. A fixture is the canonical entity the whole product hangs
-- off (blueprint 1.1); everything a match centre shows is a row in one of the
-- tables below, or a coverage state saying why it is absent (T-012).
--
-- Same conventions as the catalog (T-010): generated UUID keys, TEXT + CHECK
-- for enumerations (D-024), created_at / updated_at with the trigger, and no
-- name-based keys. One structural rule is new here: a team's involvement in a
-- fixture is a row in fixture_participant, and lineups, incidents and
-- statistics reference that row rather than the team directly. A lineup for a
-- team that is not playing this fixture is therefore impossible to write, not
-- merely unlikely.

-- ---------------------------------------------------------------------------
-- fixture
-- ---------------------------------------------------------------------------
-- status is the coarse state; the running clock and the period detail live in
-- fixture_period. `minute` is the live display minute and is NULL unless the
-- fixture is live. Both teams are rows in fixture_participant; a fixture with
-- fewer than two is a fixture still being resolved, not a valid match.
CREATE TABLE fixture (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id        uuid NOT NULL REFERENCES season (id) ON DELETE RESTRICT,
  stage_id         uuid REFERENCES stage (id) ON DELETE RESTRICT,
  -- Free text from the competition's own vocabulary: 'Matchday 3', 'Round of 16'.
  round            text,
  -- Group letter or name inside a group stage.
  group_name       text,
  -- 1 or 2 for a two-legged tie; NULL otherwise.
  leg              smallint,
  kickoff_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'scheduled',
  minute           smallint,
  venue_id         uuid REFERENCES venue (id) ON DELETE SET NULL,
  is_neutral_venue boolean NOT NULL DEFAULT false,
  referee_id       uuid REFERENCES person (id) ON DELETE SET NULL,
  attendance       integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_status_check CHECK (
    status IN ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned', 'awarded')
  ),
  CONSTRAINT fixture_leg_check CHECK (leg IS NULL OR leg IN (1, 2)),
  CONSTRAINT fixture_minute_range CHECK (minute IS NULL OR minute BETWEEN 0 AND 150),
  CONSTRAINT fixture_minute_only_when_live CHECK (minute IS NULL OR status = 'live'),
  CONSTRAINT fixture_attendance_positive CHECK (attendance IS NULL OR attendance >= 0)
);

CREATE INDEX fixture_kickoff_at_idx ON fixture (kickoff_at);
CREATE INDEX fixture_season_id_idx ON fixture (season_id);
CREATE INDEX fixture_stage_id_idx ON fixture (stage_id);
CREATE INDEX fixture_venue_id_idx ON fixture (venue_id);
CREATE INDEX fixture_referee_id_idx ON fixture (referee_id);
-- The scores page asks "what is live right now" far more often than it asks
-- anything else about status.
CREATE INDEX fixture_live_idx ON fixture (kickoff_at) WHERE status = 'live';

COMMENT ON TABLE fixture IS
  'A match. Teams are rows in fixture_participant; scores in fixture_score; the clock in fixture_period.';

-- ---------------------------------------------------------------------------
-- fixture_participant
-- ---------------------------------------------------------------------------
-- Exactly one home and one away side per fixture, and a team appears at most
-- once. Team-level match facts that are not statistics (formation, who was in
-- the dugout) live here.
CREATE TABLE fixture_participant (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES team (id) ON DELETE RESTRICT,
  side       text NOT NULL,
  -- '4-3-3', as announced. NULL until the lineup is known.
  formation  text,
  coach_id   uuid REFERENCES person (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_participant_side_check CHECK (side IN ('home', 'away')),
  CONSTRAINT fixture_participant_formation_format
    CHECK (formation IS NULL OR formation ~ '^[0-9](-[0-9]){2,4}$'),
  CONSTRAINT fixture_participant_one_per_side UNIQUE (fixture_id, side),
  CONSTRAINT fixture_participant_team_once UNIQUE (fixture_id, team_id)
);

CREATE INDEX fixture_participant_team_id_idx ON fixture_participant (team_id);
CREATE INDEX fixture_participant_coach_id_idx ON fixture_participant (coach_id);

COMMENT ON TABLE fixture_participant IS
  'One team''s involvement in one fixture. Lineups, incidents and statistics hang off this row, so they cannot name a team that is not playing.';

-- ---------------------------------------------------------------------------
-- fixture_score
-- ---------------------------------------------------------------------------
-- One row per score the product displays. 'current' is what the scoreboard
-- shows now and is the only row that changes while a match is live; the others
-- are written once when their period closes. 'aggregate' is the tie total for
-- a second leg. Home and away are columns rather than a side row because a
-- score is one fact with two halves, not two facts.
CREATE TABLE fixture_score (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  home       smallint NOT NULL,
  away       smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_score_kind_check
    CHECK (kind IN ('current', 'half_time', 'full_time', 'extra_time', 'penalties', 'aggregate')),
  CONSTRAINT fixture_score_non_negative CHECK (home >= 0 AND away >= 0),
  CONSTRAINT fixture_score_one_per_kind UNIQUE (fixture_id, kind)
);

COMMENT ON TABLE fixture_score IS
  'Scores by kind (current, half_time, full_time, extra_time, penalties, aggregate). One row per kind per fixture.';

-- ---------------------------------------------------------------------------
-- fixture_period
-- ---------------------------------------------------------------------------
-- The clock. A period that has started but not ended is the one running now;
-- the live minute on fixture is derived from it plus the period's base minute.
-- sequence orders periods within the fixture (1 = first half).
CREATE TABLE fixture_period (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id    uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  kind          text NOT NULL,
  sequence      smallint NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  -- Stoppage time announced at the end of the period, in minutes.
  added_minutes smallint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_period_kind_check CHECK (
    kind IN ('first_half', 'second_half', 'extra_time_first', 'extra_time_second', 'penalties')
  ),
  CONSTRAINT fixture_period_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT fixture_period_times_ordered CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT fixture_period_added_minutes_range
    CHECK (added_minutes IS NULL OR added_minutes BETWEEN 0 AND 30),
  CONSTRAINT fixture_period_one_per_kind UNIQUE (fixture_id, kind),
  CONSTRAINT fixture_period_sequence_unique UNIQUE (fixture_id, sequence)
);

COMMENT ON TABLE fixture_period IS
  'Playing periods of a fixture with real start and end times. An open ended_at is the period in progress.';

-- ---------------------------------------------------------------------------
-- incident
-- ---------------------------------------------------------------------------
-- Goals, cards, substitutions and VAR decisions, in the order they happened.
-- participant_id is the team the incident is credited to: for a goal the
-- scoring team, for an own goal the team that benefits, for a card the
-- carded player's team. person_id is the player; related_person_id is the
-- assist provider for a goal or the player coming on for a substitution.
-- sequence is the only ordering that survives two incidents in the same
-- minute.
CREATE TABLE incident (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  participant_id    uuid REFERENCES fixture_participant (id) ON DELETE CASCADE,
  person_id         uuid REFERENCES person (id) ON DELETE RESTRICT,
  related_person_id uuid REFERENCES person (id) ON DELETE RESTRICT,
  kind              text NOT NULL,
  minute            smallint NOT NULL,
  -- Minutes into stoppage time: 45+3 is minute 45, added_time 3.
  added_time        smallint,
  sequence          smallint NOT NULL,
  -- VAR outcome or other detail the provider supplies as text.
  detail            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_kind_check CHECK (
    kind IN (
      'goal', 'own_goal', 'penalty_goal', 'penalty_missed',
      'yellow_card', 'second_yellow_card', 'red_card',
      'substitution', 'var'
    )
  ),
  CONSTRAINT incident_minute_range CHECK (minute BETWEEN 0 AND 150),
  CONSTRAINT incident_added_time_range CHECK (added_time IS NULL OR added_time BETWEEN 0 AND 30),
  CONSTRAINT incident_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT incident_sequence_unique UNIQUE (fixture_id, sequence),
  -- A card or a substitution without a player is not an incident we can show.
  CONSTRAINT incident_player_required CHECK (
    kind IN ('var') OR person_id IS NOT NULL
  ),
  CONSTRAINT incident_substitution_has_two_players CHECK (
    kind <> 'substitution' OR related_person_id IS NOT NULL
  )
);

CREATE INDEX incident_participant_id_idx ON incident (participant_id);
CREATE INDEX incident_person_id_idx ON incident (person_id);
CREATE INDEX incident_related_person_id_idx ON incident (related_person_id);

COMMENT ON TABLE incident IS
  'Match events in order. participant_id is the team credited; person_id the player; related_person_id the assist or the substitute coming on.';

-- ---------------------------------------------------------------------------
-- lineup
-- ---------------------------------------------------------------------------
-- One row per named player per team per fixture, starters and bench. Shirt
-- numbers are unique within the team's lineup, not within the fixture: both
-- sides have a number 10.
CREATE TABLE lineup (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  role           text NOT NULL,
  shirt_number   smallint,
  position       text,
  is_captain     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lineup_role_check CHECK (role IN ('starter', 'bench')),
  CONSTRAINT lineup_shirt_range CHECK (shirt_number IS NULL OR shirt_number BETWEEN 1 AND 99),
  CONSTRAINT lineup_position_check
    CHECK (position IS NULL OR position IN ('goalkeeper', 'defender', 'midfielder', 'forward')),
  CONSTRAINT lineup_person_once UNIQUE (participant_id, person_id),
  CONSTRAINT lineup_shirt_once UNIQUE (participant_id, shirt_number)
);

CREATE INDEX lineup_person_id_idx ON lineup (person_id);

-- One captain per side. Partial unique index, same device as season.is_current.
CREATE UNIQUE INDEX lineup_one_captain_per_participant
  ON lineup (participant_id)
  WHERE is_captain;

COMMENT ON TABLE lineup IS
  'Named players for one side of one fixture: starters and bench, with shirt number and position.';

-- ---------------------------------------------------------------------------
-- fixture_stat
-- ---------------------------------------------------------------------------
-- Team-level match statistics as (metric, value) rows. A closed list of
-- metrics under CHECK (D-024): a provider metric we have not modelled is
-- rejected here and surfaces as an ingestion error, rather than appearing on
-- a page under a name nobody chose. A missing row means "not supplied", which
-- is what the coverage state (T-012) says out loud; it is never stored as 0.
CREATE TABLE fixture_stat (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  metric         text NOT NULL,
  value          numeric(8, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_stat_metric_check CHECK (
    metric IN (
      'possession_pct', 'shots', 'shots_on_target', 'shots_off_target', 'blocked_shots',
      'corners', 'offsides', 'fouls', 'yellow_cards', 'red_cards',
      'passes', 'passes_accurate', 'pass_accuracy_pct', 'saves', 'expected_goals'
    )
  ),
  CONSTRAINT fixture_stat_value_non_negative CHECK (value >= 0),
  CONSTRAINT fixture_stat_pct_range CHECK (metric NOT LIKE '%\_pct' OR value <= 100),
  CONSTRAINT fixture_stat_one_per_metric UNIQUE (participant_id, metric)
);

COMMENT ON TABLE fixture_stat IS
  'Team statistics for one side of one fixture, one row per metric. Absent row = not supplied; never stored as zero.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER fixture_set_updated_at
  BEFORE UPDATE ON fixture FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fixture_participant_set_updated_at
  BEFORE UPDATE ON fixture_participant FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fixture_score_set_updated_at
  BEFORE UPDATE ON fixture_score FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fixture_period_set_updated_at
  BEFORE UPDATE ON fixture_period FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER incident_set_updated_at
  BEFORE UPDATE ON incident FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lineup_set_updated_at
  BEFORE UPDATE ON lineup FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fixture_stat_set_updated_at
  BEFORE UPDATE ON fixture_stat FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

-- Reverse dependency order. Children of fixture_participant first.
DROP TABLE IF EXISTS fixture_stat;
DROP TABLE IF EXISTS lineup;
DROP TABLE IF EXISTS incident;
DROP TABLE IF EXISTS fixture_period;
DROP TABLE IF EXISTS fixture_score;
DROP TABLE IF EXISTS fixture_participant;
DROP TABLE IF EXISTS fixture;
