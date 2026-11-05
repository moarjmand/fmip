-- Up Migration

-- T-1740 (D-361): a pick made before the member confirmed their e-mail address.
--
-- A guest taps an outcome, creates an account and is back on the match before
-- any e-mail could have been confirmed. That first action is kept: it is saved
-- here as a **pending pick**, and it becomes a prediction only if the member
-- confirms the address before kick-off. If kick-off comes first it stays
-- "saved, not counted".
--
-- **This is not a prediction and nothing reads it as one.** It has its own
-- table; `user_prediction`, `prediction_version` and `settlement` are not
-- touched, so the consensus, the settlement and the rating are still computed
-- from stored predictions and settlements alone (rule 8), and a pending pick
-- is in none of them. When the address is confirmed in time, the predictions
-- boundary writes an ordinary first version through its own path, timed by the
-- database at that moment -- nothing is back-dated -- and under the same lock
-- as any prediction (`refuse_prediction_after_kickoff`, PL001). The row here
-- then only records that it happened.
--
-- One row is one choice. Choosing again before confirming resolves the row
-- that was waiting as `replaced` and adds a new one, so what became of every
-- choice stays readable: `pending`, `converted`, `expired` (kick-off came
-- first), `replaced`, `withdrawn`. It holds the outcome and nothing else: no
-- score, confidence or reasons.
--
-- No backfill: before this migration nothing was kept for an unconfirmed
-- member, so there is nothing to bring over.

CREATE TABLE pending_pick (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  -- CASCADE, unlike a prediction's RESTRICT: a pending pick is no record that
  -- must outlive its match.
  fixture_id   uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  outcome      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- When it stopped waiting; the status says how.
  resolved_at  timestamptz,
  CONSTRAINT pending_pick_outcome CHECK (outcome IN ('home', 'draw', 'away')),
  CONSTRAINT pending_pick_status
    CHECK (status IN ('pending', 'converted', 'expired', 'replaced', 'withdrawn')),
  CONSTRAINT pending_pick_resolution CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CONSTRAINT pending_pick_resolved_after CHECK (resolved_at IS NULL OR resolved_at >= created_at)
);

-- One pick waiting per member per match.
CREATE UNIQUE INDEX pending_pick_one_waiting ON pending_pick (user_id, fixture_id)
  WHERE status = 'pending';
-- The member's newest pick on a match, and their export.
CREATE INDEX pending_pick_member_idx ON pending_pick (user_id, fixture_id, created_at DESC);
-- The retention purge reads by the match's kick-off.
CREATE INDEX pending_pick_fixture_idx ON pending_pick (fixture_id);

COMMENT ON TABLE pending_pick IS
  'A pick made before the member confirmed their e-mail address (T-1740, D-361). Not a prediction: never in a consensus, a settlement or a rating. It becomes one, written by the predictions boundary at the moment of confirmation, only if that is before kick-off.';

-- A pending pick is made waiting, by a member whose address is not confirmed,
-- before kick-off -- on the database's clock, as a prediction's lock is
-- (T-051). The member's row is read FOR SHARE: a confirmation running at the
-- same moment (an UPDATE of that row) waits for this insert to commit and
-- then finds the pick, or commits first and this insert is refused. Either
-- way no pick is left waiting behind a confirmation that never saw it.
CREATE FUNCTION refuse_pending_pick_not_open() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'pending' OR NEW.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'a pending pick is made waiting'
      USING ERRCODE = 'PL023', HINT = 'status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fixture f WHERE f.id = NEW.fixture_id AND f.kickoff_at > now()
  ) THEN
    RAISE EXCEPTION 'picks lock at kick-off'
      USING ERRCODE = 'PL023', HINT = 'kickoff';
  END IF;
  PERFORM 1 FROM user_account u
    WHERE u.id = NEW.user_id AND u.email_verified_at IS NULL
      FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a member whose e-mail address is confirmed predicts; there is nothing to wait for'
      USING ERRCODE = 'PL023', HINT = 'verified';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_pending_pick_not_open() IS
  'A pending pick is inserted waiting, before kick-off, by a member whose e-mail address is not confirmed (T-1740, D-361). SQLSTATE PL023; the hint says which: status, kickoff, verified.';

-- `open` < `volume`: a refused pick is not counted against the ceiling.
CREATE TRIGGER pending_pick_open_guard
  BEFORE INSERT ON pending_pick
  FOR EACH ROW EXECUTE FUNCTION refuse_pending_pick_not_open();

-- What was chosen never changes; what became of it is written once.
CREATE FUNCTION refuse_pending_pick_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.fixture_id IS DISTINCT FROM OLD.fixture_id
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a pending pick is never rewritten; choosing again makes a new one'
      USING ERRCODE = 'PL007';
  END IF;
  IF OLD.status <> 'pending'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
    RAISE EXCEPTION 'what became of a pending pick is recorded once'
      USING ERRCODE = 'PL007';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER pending_pick_fixed
  BEFORE UPDATE ON pending_pick
  FOR EACH ROW EXECUTE FUNCTION refuse_pending_pick_rewrite();

-- The ceiling on choosing, the same mechanism as every member write (T-213,
-- D-103). Each change of mind adds a row, and an account takes a minute to
-- make, so the rows are bounded here. Sixty an hour: a member picking through
-- a full matchday and changing their mind is a few dozen; a script is not.
INSERT INTO rate_limit (action, per_hour) VALUES ('pending_pick', 60);

CREATE TRIGGER pending_pick_volume_guard
  BEFORE INSERT ON pending_pick
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('pending_pick', 'user_id');

-- Down Migration

DROP TRIGGER IF EXISTS pending_pick_volume_guard ON pending_pick;
DELETE FROM rate_window WHERE action = 'pending_pick';
DELETE FROM rate_limit WHERE action = 'pending_pick';
DROP TRIGGER IF EXISTS pending_pick_fixed ON pending_pick;
DROP FUNCTION IF EXISTS refuse_pending_pick_rewrite();
DROP TRIGGER IF EXISTS pending_pick_open_guard ON pending_pick;
DROP FUNCTION IF EXISTS refuse_pending_pick_not_open();
DROP TABLE IF EXISTS pending_pick;
