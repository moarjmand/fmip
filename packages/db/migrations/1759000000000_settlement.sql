-- Up Migration

-- T-052: settlement of predictions (blueprint 6.6, 9.1). Once a fixture is
-- final, every prediction on it gets one settlement row: the version that
-- stood at kick-off, what happened, and whether the outcome and the exact
-- score were right. A postponed, abandoned, cancelled or awarded match is
-- settled as `void` with the reason; when such a fixture is later finished
-- for real, a `settled` row supersedes the void one. Rows are immutable
-- (rule 8: a rating must be recomputable from stored records alone), so a
-- correction is a new row, never an edit, and each run is recorded.

CREATE TABLE settlement_run (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id  uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  started_at  timestamptz NOT NULL DEFAULT now(),
  -- What the run found: how many rows it wrote and how many it left alone.
  settled     integer NOT NULL DEFAULT 0,
  voided      integer NOT NULL DEFAULT 0,
  unchanged   integer NOT NULL DEFAULT 0,
  CONSTRAINT settlement_run_counts_non_negative
    CHECK (settled >= 0 AND voided >= 0 AND unchanged >= 0)
);

CREATE INDEX settlement_run_fixture_idx ON settlement_run (fixture_id, started_at);

COMMENT ON TABLE settlement_run IS
  'One execution of settlement for one fixture, with what it wrote. Re-running is expected and idempotent.';

CREATE TABLE settlement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES settlement_run (id) ON DELETE RESTRICT,
  prediction_id   uuid NOT NULL REFERENCES user_prediction (id) ON DELETE CASCADE,
  version_id      uuid NOT NULL REFERENCES prediction_version (id) ON DELETE RESTRICT,
  fixture_id      uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  settled_at      timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL,
  void_reason     text,
  actual_home     smallint,
  actual_away     smallint,
  outcome_correct boolean,
  score_predicted boolean NOT NULL,
  score_correct   boolean,
  confidence      smallint NOT NULL,
  CONSTRAINT settlement_status_check CHECK (status IN ('settled', 'void')),
  CONSTRAINT settlement_void_reason_check CHECK (
    void_reason IS NULL
    OR void_reason IN ('postponed', 'abandoned', 'cancelled', 'awarded')
  ),
  CONSTRAINT settlement_void_shape CHECK (
    (status = 'void' AND void_reason IS NOT NULL AND actual_home IS NULL AND actual_away IS NULL
       AND outcome_correct IS NULL AND score_correct IS NULL)
    OR
    (status = 'settled' AND void_reason IS NULL AND actual_home IS NOT NULL AND actual_away IS NOT NULL
       AND outcome_correct IS NOT NULL AND (score_predicted = (score_correct IS NOT NULL)))
  ),
  CONSTRAINT settlement_confidence_range CHECK (confidence BETWEEN 1 AND 5)
);

-- One real settlement per prediction, ever. Void rows may repeat (a match
-- postponed twice) and may be superseded by the one settled row.
CREATE UNIQUE INDEX settlement_one_settled_per_prediction
  ON settlement (prediction_id) WHERE status = 'settled';
CREATE INDEX settlement_prediction_idx ON settlement (prediction_id, settled_at);
CREATE INDEX settlement_fixture_idx ON settlement (fixture_id);

COMMENT ON TABLE settlement IS
  'How one prediction was settled against the final result, or why it is void. Immutable; the newest row per prediction is current.';

CREATE TRIGGER settlement_immutable
  BEFORE UPDATE OR DELETE ON settlement FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER settlement_run_immutable
  BEFORE UPDATE OR DELETE ON settlement_run FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS settlement;
DROP TABLE IF EXISTS settlement_run;
