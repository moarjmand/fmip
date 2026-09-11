-- Up Migration

-- T-053: Performance Rating snapshots (blueprint 9.1, 02-architecture.md
-- "Reputation reproducibility"). A snapshot is one computation of a member's
-- rating: which formula version produced it, over how many settled
-- predictions, the total and each component. Rows are immutable; the newest
-- per member is current; a recomputation that would produce the same numbers
-- from the same inputs writes nothing (inputs_hash), so the history of
-- snapshots is the history of real changes.
CREATE TABLE rating_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  formula_version text NOT NULL,
  settled_count   integer NOT NULL,
  rating          numeric(5,2) NOT NULL,
  components      jsonb NOT NULL,
  provisional     boolean NOT NULL,
  established     boolean NOT NULL,
  -- SHA-256 over the ordered settlement ids and the formula version: the
  -- identity of the inputs, so an unchanged recomputation is detectable.
  inputs_hash     text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rating_snapshot_formula_format CHECK (formula_version ~ '^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT rating_snapshot_count_non_negative CHECK (settled_count >= 0),
  CONSTRAINT rating_snapshot_range CHECK (rating >= 0 AND rating <= 100),
  CONSTRAINT rating_snapshot_status CHECK (NOT (provisional AND established))
);

CREATE INDEX rating_snapshot_user_idx ON rating_snapshot (user_id, computed_at DESC);

COMMENT ON TABLE rating_snapshot IS
  'One computation of a member''s Performance Rating with the formula version and components. Immutable; newest per user is current.';

CREATE TRIGGER rating_snapshot_immutable
  BEFORE UPDATE OR DELETE ON rating_snapshot FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS rating_snapshot;
