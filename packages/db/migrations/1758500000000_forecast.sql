-- Up Migration

-- T-064: forecast versions (02-architecture.md, "Forecast versioning"):
--
--     input_snapshot  →  model_version  →  forecast  →  evaluation (T-066)
--
-- Rule 5 in CLAUDE.md: forecasts are immutable. That is enforced here, not in
-- application code: a trigger refuses UPDATE and DELETE on input_snapshot and
-- forecast outright. A new forecast is a new row with the next version number
-- for its fixture; comparing two versions is how the match centre explains
-- what changed (blueprint 6.4).
--
-- Rule 4: every forecast carries computed_at, and the API's list response
-- carries last_updated_at and a coverage state.

-- The competition's football-data.co.uk division, so the forecast boundary
-- can tell the model which history to fit. NULL = the model cannot forecast
-- this competition yet, and says so.
ALTER TABLE competition ADD COLUMN football_data_division text;
ALTER TABLE competition ADD CONSTRAINT competition_division_format
  CHECK (football_data_division IS NULL OR football_data_division ~ '^[A-Z]{1,2}[0-9C]$');
COMMENT ON COLUMN competition.football_data_division IS
  'football-data.co.uk division code (E0, SP1, ...). NULL until the competition is mapped for the model.';

-- ---------------------------------------------------------------------------
-- model_version
-- ---------------------------------------------------------------------------
-- One row per model id the service has ever answered with. The constants are
-- recorded as the service reported them, so a forecast can always be traced
-- to the exact parameters that produced it.
CREATE TABLE model_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_version_model_id_format CHECK (model_id ~ '^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT model_version_model_id_unique UNIQUE (model_id)
);

COMMENT ON TABLE model_version IS 'Every model id (name@semver) that has produced a stored forecast.';

-- ---------------------------------------------------------------------------
-- input_snapshot
-- ---------------------------------------------------------------------------
-- What was sent to the model and what the model said it used. kind is the
-- blueprint's stage: early, when predicted line-ups arrive, when confirmed
-- line-ups arrive, or a manual recomputation.
CREATE TABLE input_snapshot (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id       uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  model_version_id uuid NOT NULL REFERENCES model_version (id) ON DELETE RESTRICT,
  kind             text NOT NULL,
  captured_at      timestamptz NOT NULL DEFAULT now(),
  -- The ModelForecastRequest, verbatim.
  request          jsonb NOT NULL,
  -- The model's `inputs` block, verbatim; NULL when the model answered unavailable.
  model_inputs     jsonb,
  CONSTRAINT input_snapshot_kind_check
    CHECK (kind IN ('early', 'lineups_predicted', 'lineups_confirmed', 'manual'))
);

CREATE INDEX input_snapshot_fixture_idx ON input_snapshot (fixture_id, captured_at);

COMMENT ON TABLE input_snapshot IS
  'What the model was asked and what it used, per forecast version. Immutable.';

-- ---------------------------------------------------------------------------
-- forecast
-- ---------------------------------------------------------------------------
-- One row per input snapshot. Probabilities are stored to four decimals and
-- must total exactly 1.0000: the rounding convention (largest absorbs the
-- gap) is applied before the row is written, and the CHECK makes sure it was.
-- An unavailable answer is also a version: it records that at this moment the
-- model could not say, and why.
CREATE TABLE forecast (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id           uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  input_snapshot_id    uuid NOT NULL REFERENCES input_snapshot (id) ON DELETE RESTRICT,
  model_version_id     uuid NOT NULL REFERENCES model_version (id) ON DELETE RESTRICT,
  version_number       integer NOT NULL,
  computed_at          timestamptz NOT NULL,
  status               text NOT NULL,
  p_home               numeric(5, 4),
  p_draw               numeric(5, 4),
  p_away               numeric(5, 4),
  expected_home_goals  numeric(6, 3),
  expected_away_goals  numeric(6, 3),
  most_likely          jsonb,
  leading_factors      jsonb,
  data_completeness    text,
  unavailable_reason   text,
  unavailable_detail   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forecast_status_check CHECK (status IN ('available', 'unavailable')),
  CONSTRAINT forecast_version_positive CHECK (version_number >= 1),
  CONSTRAINT forecast_version_unique UNIQUE (fixture_id, version_number),
  CONSTRAINT forecast_one_per_snapshot UNIQUE (input_snapshot_id),
  CONSTRAINT forecast_completeness_check
    CHECK (data_completeness IS NULL OR data_completeness IN ('available', 'limited')),
  CONSTRAINT forecast_reason_check CHECK (
    unavailable_reason IS NULL
    OR unavailable_reason IN ('team_not_mapped', 'no_history', 'division_not_loaded', 'competition_not_mapped', 'model_unreachable', 'contract_violation')
  ),
  -- An available forecast carries everything; an unavailable one carries a reason and nothing else.
  CONSTRAINT forecast_available_complete CHECK (
    CASE status
      WHEN 'available' THEN
        p_home IS NOT NULL AND p_draw IS NOT NULL AND p_away IS NOT NULL
        AND expected_home_goals IS NOT NULL AND expected_away_goals IS NOT NULL
        AND most_likely IS NOT NULL AND leading_factors IS NOT NULL AND data_completeness IS NOT NULL
        AND unavailable_reason IS NULL
      ELSE
        p_home IS NULL AND p_draw IS NULL AND p_away IS NULL
        AND expected_home_goals IS NULL AND expected_away_goals IS NULL
        AND most_likely IS NULL AND leading_factors IS NULL AND data_completeness IS NULL
        AND unavailable_reason IS NOT NULL
    END
  ),
  CONSTRAINT forecast_probabilities_range CHECK (
    (p_home IS NULL OR (p_home >= 0 AND p_home <= 1))
    AND (p_draw IS NULL OR (p_draw >= 0 AND p_draw <= 1))
    AND (p_away IS NULL OR (p_away >= 0 AND p_away <= 1))
  ),
  -- Blueprint 6.2: the three outcome probabilities always total 100% after rounding.
  CONSTRAINT forecast_probabilities_total_one CHECK (
    p_home IS NULL OR p_home + p_draw + p_away = 1.0000
  ),
  CONSTRAINT forecast_expected_goals_positive CHECK (
    (expected_home_goals IS NULL OR expected_home_goals > 0)
    AND (expected_away_goals IS NULL OR expected_away_goals > 0)
  )
);

CREATE INDEX forecast_fixture_idx ON forecast (fixture_id, version_number DESC);

COMMENT ON TABLE forecast IS
  'One immutable forecast version per input snapshot. p_home + p_draw + p_away = 1.0000 exactly.';

-- ---------------------------------------------------------------------------
-- Immutability (rule 5). Refusing at the database means no code path, no
-- migration typo and no psql session can rewrite history.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (CLAUDE.md rule 5); write a new version instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION refuse_change() IS
  'Trigger function: raises on any UPDATE or DELETE. Attach to tables whose rows are immutable.';

CREATE TRIGGER input_snapshot_immutable
  BEFORE UPDATE OR DELETE ON input_snapshot FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER forecast_immutable
  BEFORE UPDATE OR DELETE ON forecast FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS forecast;
DROP TABLE IF EXISTS input_snapshot;
DROP TABLE IF EXISTS model_version;
DROP FUNCTION IF EXISTS refuse_change();
ALTER TABLE competition DROP CONSTRAINT IF EXISTS competition_division_format;
ALTER TABLE competition DROP COLUMN IF EXISTS football_data_division;
