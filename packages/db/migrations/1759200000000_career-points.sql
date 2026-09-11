-- Up Migration

-- T-054: Career Points (blueprint 9.2). Participation and achievement, kept
-- apart from the Performance Rating: a ledger of immutable transactions, each
-- earned by one settlement for one reason under one rule version. The total
-- is a sum; nothing here feeds the rating or unlocks a privilege on its own.
CREATE TABLE points_transaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL REFERENCES settlement (id) ON DELETE RESTRICT,
  reason        text NOT NULL,
  points        integer NOT NULL,
  rule_version  text NOT NULL,
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT points_transaction_reason_check CHECK (
    reason IN ('settled', 'correct_outcome', 'exact_score', 'streak_5', 'streak_10')
  ),
  CONSTRAINT points_transaction_points_positive CHECK (points > 0),
  CONSTRAINT points_transaction_rule_format CHECK (rule_version ~ '^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$'),
  -- One award per reason per settlement: re-running the pass writes nothing new.
  CONSTRAINT points_transaction_once UNIQUE (settlement_id, reason)
);

CREATE INDEX points_transaction_user_idx ON points_transaction (user_id, awarded_at);

COMMENT ON TABLE points_transaction IS
  'Career Points ledger: one immutable award per settlement and reason (T-054). Total = sum(points).';

CREATE TRIGGER points_transaction_immutable
  BEFORE UPDATE OR DELETE ON points_transaction FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS points_transaction;
