-- Up Migration

-- ---------------------------------------------------------------------------
-- evaluation (T-066)
-- ---------------------------------------------------------------------------
-- One row per forecast version once the fixture has a full-time score: what
-- happened, how much probability the version gave it, and the two scores the
-- backtest harness uses (log loss, Brier), so model performance is a query
-- over this table rather than a recomputation. Only `available` versions are
-- evaluated; an `unavailable` version has no probabilities to score and is
-- counted as a gap by the performance query instead.
--
-- pre_kickoff records whether the version was computed before kick-off. A
-- version computed after the result was known is stored and evaluated like
-- any other, but performance figures exclude it: a forecast made in hindsight
-- proves nothing about the model.
--
-- Immutable, like forecast and input_snapshot (rule 5, D-030): the same
-- refuse_change() trigger. Re-evaluating a fixture inserts nothing new — the
-- forecast_id is unique — so a correction to a final score can only be
-- expressed as a new fixture_score row plus an operator decision, never as a
-- silent rewrite of the evaluation.
CREATE TABLE evaluation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id      uuid NOT NULL UNIQUE REFERENCES forecast (id) ON DELETE RESTRICT,
  fixture_id       uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  model_version_id uuid NOT NULL REFERENCES model_version (id) ON DELETE RESTRICT,
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  actual_home      smallint NOT NULL,
  actual_away      smallint NOT NULL,
  outcome          text NOT NULL,
  pre_kickoff      boolean NOT NULL,
  -- Probability the version gave the outcome that happened.
  p_outcome        numeric(5,4) NOT NULL,
  -- -ln(p_outcome); uniform is ln 3 ≈ 1.098612. Lower is better.
  log_loss         numeric(9,6) NOT NULL,
  -- Sum of squared errors over the three outcome indicators; uniform is 2/3.
  brier            numeric(7,6) NOT NULL,
  -- The outcome that happened was the version's most probable one.
  correct          boolean NOT NULL,
  -- The version's single most likely scoreline was the final score.
  scoreline_hit    boolean NOT NULL,
  CONSTRAINT evaluation_actual_non_negative CHECK (actual_home >= 0 AND actual_away >= 0),
  CONSTRAINT evaluation_outcome_check CHECK (outcome IN ('home', 'draw', 'away')),
  CONSTRAINT evaluation_outcome_matches_score CHECK (
    (outcome = 'home' AND actual_home > actual_away)
    OR (outcome = 'draw' AND actual_home = actual_away)
    OR (outcome = 'away' AND actual_home < actual_away)
  ),
  CONSTRAINT evaluation_p_outcome_range CHECK (p_outcome >= 0 AND p_outcome <= 1),
  CONSTRAINT evaluation_log_loss_range CHECK (log_loss >= 0),
  CONSTRAINT evaluation_brier_range CHECK (brier >= 0 AND brier <= 2)
);

CREATE INDEX evaluation_fixture_idx ON evaluation (fixture_id);
CREATE INDEX evaluation_model_version_idx ON evaluation (model_version_id, pre_kickoff);

COMMENT ON TABLE evaluation IS
  'Post-match evaluation of one forecast version against the full-time score. Immutable; one per version.';

CREATE TRIGGER evaluation_immutable
  BEFORE UPDATE OR DELETE ON evaluation FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS evaluation;
