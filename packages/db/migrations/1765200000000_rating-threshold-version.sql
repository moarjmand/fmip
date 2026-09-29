-- Up Migration

-- ---------------------------------------------------------------------------
-- Rating thresholds as versioned rows (blueprint 16, T-1160, D-152, D-164).
--
-- The numbers a rating and a contributor eligibility are judged by were
-- constants in code: when a rating stops being provisional (30) and becomes
-- established (50), the contributor thresholds of D-059 (rating 70, 50
-- settled, a 90-day conduct window) and D-137's sustained period (30 days,
-- D-169). They become rows an administrator supersedes from the console with
-- a reason and a start. The formula itself is never here: it changes only by
-- a new formula version with its own decision.
--
-- A row is never edited or deleted (`refuse_change()`); a new version
-- supersedes. The version in force at an instant is the one with the latest
-- `effective_from` at or before it, the higher version winning a tie, so a
-- scheduled version set by mistake is corrected by another at the same
-- start. A start is never in the past: what an earlier rating was computed
-- under does not move.
--
-- Version 1 holds today's constants exactly, in force from the epoch, so
-- nothing changes on the day this ships. It is the one row with no actor.
--
-- `rating_snapshot.threshold_version` names the version a snapshot's
-- provisional and established flags were computed under (rule 8: a rating
-- is recomputable from stored predictions, settlements and this row). Every
-- snapshot written before this migration was computed under version 1's
-- values, which is what the default records for them; the API always names
-- the version it computed under.
-- ---------------------------------------------------------------------------
CREATE TABLE rating_threshold_version (
  version                  integer PRIMARY KEY,
  provisional_below        integer NOT NULL,
  established_at           integer NOT NULL,
  contributor_min_rating   numeric(4, 1) NOT NULL,
  contributor_min_settled  integer NOT NULL,
  conduct_window_days      integer NOT NULL,
  flag_period_days         integer NOT NULL,
  effective_from           timestamptz NOT NULL,
  set_by                   uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  reason                   text NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rating_threshold_version_positive CHECK (version >= 1),
  CONSTRAINT rating_threshold_provisional_range CHECK (provisional_below BETWEEN 1 AND 1000),
  -- A rating is never both provisional and established (rating_snapshot_status).
  CONSTRAINT rating_threshold_established_range
    CHECK (established_at BETWEEN provisional_below AND 1000),
  CONSTRAINT rating_threshold_min_rating_range CHECK (contributor_min_rating BETWEEN 0 AND 100),
  CONSTRAINT rating_threshold_min_settled_range CHECK (contributor_min_settled BETWEEN 1 AND 10000),
  CONSTRAINT rating_threshold_conduct_range CHECK (conduct_window_days BETWEEN 1 AND 3650),
  CONSTRAINT rating_threshold_flag_period_range CHECK (flag_period_days BETWEEN 1 AND 365),
  CONSTRAINT rating_threshold_reason_not_blank CHECK (btrim(reason) <> ''),
  -- Only the first version, written here, has no administrator behind it.
  CONSTRAINT rating_threshold_actor CHECK ((version = 1) = (set_by IS NULL))
);

CREATE INDEX rating_threshold_version_in_force_idx
  ON rating_threshold_version (effective_from DESC, version DESC);

COMMENT ON TABLE rating_threshold_version IS
  'The rating and eligibility thresholds, versioned: in force from effective_from until a later start; superseded, never edited (T-1160, D-152, D-164).';

INSERT INTO rating_threshold_version
  (version, provisional_below, established_at, contributor_min_rating, contributor_min_settled,
   conduct_window_days, flag_period_days, effective_from, set_by, reason)
VALUES
  (1, 30, 50, 70, 50, 90, 30, '1970-01-01T00:00:00Z', NULL,
   'The constants in force before T-1160: performance-rating@1.0.0''s provisional and established counts, privilege-eligibility@1.1.0 (D-059) and the sustained period of D-137 and D-169.');

CREATE TRIGGER rating_threshold_version_immutable
  BEFORE UPDATE OR DELETE ON rating_threshold_version
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

ALTER TABLE rating_snapshot
  ADD COLUMN threshold_version integer NOT NULL DEFAULT 1
    REFERENCES rating_threshold_version (version) ON DELETE RESTRICT;

COMMENT ON COLUMN rating_snapshot.threshold_version IS
  'The rating_threshold_version its provisional and established flags were computed under (T-1160).';

-- Down Migration

ALTER TABLE rating_snapshot DROP COLUMN threshold_version;
DROP TABLE rating_threshold_version;
