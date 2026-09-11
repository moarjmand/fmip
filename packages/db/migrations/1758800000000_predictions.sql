-- Up Migration

-- T-050: registered-user predictions (blueprint 6.6, 02-architecture.md
-- "predictions"). One prediction per member per fixture; every submission is
-- a new immutable version, so the history shows exactly what was said and
-- when (rule: versions are retained). Settlement (T-052) and the kick-off
-- lock at the database level (T-051) arrive in their own migrations.

-- ---------------------------------------------------------------------------
-- user_prediction: the member's stance on one fixture
-- ---------------------------------------------------------------------------
CREATE TABLE user_prediction (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_prediction_one_per_fixture UNIQUE (user_id, fixture_id)
);

CREATE INDEX user_prediction_fixture_idx ON user_prediction (fixture_id);

COMMENT ON TABLE user_prediction IS
  'One member''s prediction on one fixture; the content lives in prediction_version.';

-- ---------------------------------------------------------------------------
-- prediction_version: what was submitted, each time
-- ---------------------------------------------------------------------------
-- An exact score is optional and, when given, must agree with the outcome.
-- Reason tags are a closed list of at most three. The explanation is short;
-- posting permissions (blueprint 6.6) arrive with the community features.
CREATE TABLE prediction_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id  uuid NOT NULL REFERENCES user_prediction (id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  outcome        text NOT NULL,
  home_goals     smallint,
  away_goals     smallint,
  confidence     smallint NOT NULL,
  reason_tags    text[] NOT NULL DEFAULT '{}',
  explanation    text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prediction_version_number_positive CHECK (version_number >= 1),
  CONSTRAINT prediction_version_unique UNIQUE (prediction_id, version_number),
  CONSTRAINT prediction_version_outcome_check CHECK (outcome IN ('home', 'draw', 'away')),
  CONSTRAINT prediction_version_score_pair CHECK ((home_goals IS NULL) = (away_goals IS NULL)),
  CONSTRAINT prediction_version_score_range CHECK (
    (home_goals IS NULL OR home_goals BETWEEN 0 AND 20)
    AND (away_goals IS NULL OR away_goals BETWEEN 0 AND 20)
  ),
  CONSTRAINT prediction_version_score_matches_outcome CHECK (
    home_goals IS NULL
    OR (outcome = 'home' AND home_goals > away_goals)
    OR (outcome = 'draw' AND home_goals = away_goals)
    OR (outcome = 'away' AND home_goals < away_goals)
  ),
  CONSTRAINT prediction_version_confidence_range CHECK (confidence BETWEEN 1 AND 5),
  CONSTRAINT prediction_version_tags_count CHECK (cardinality(reason_tags) <= 3),
  CONSTRAINT prediction_version_tags_known CHECK (
    reason_tags <@ ARRAY[
      'form', 'lineup', 'home_advantage', 'injuries', 'tactics',
      'fatigue', 'competition_importance', 'head_to_head', 'motivation'
    ]::text[]
  ),
  CONSTRAINT prediction_version_explanation_length
    CHECK (explanation IS NULL OR char_length(explanation) BETWEEN 1 AND 280)
);

CREATE INDEX prediction_version_prediction_idx ON prediction_version (prediction_id, version_number);

COMMENT ON TABLE prediction_version IS
  'One submission of a prediction. Immutable; a resubmission is the next version_number.';

-- Same device as forecasts (D-030): the database refuses UPDATE and DELETE.
CREATE TRIGGER prediction_version_immutable
  BEFORE UPDATE OR DELETE ON prediction_version FOR EACH ROW EXECUTE FUNCTION refuse_change();

CREATE TRIGGER user_prediction_set_updated_at
  BEFORE UPDATE ON user_prediction FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS prediction_version;
DROP TABLE IF EXISTS user_prediction;
