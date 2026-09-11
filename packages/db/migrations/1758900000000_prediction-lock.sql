-- Up Migration

-- T-051: predictions lock at kick-off, decided by the database clock.
--
-- The API refuses a submission it can see is late, but its clock is not the
-- authority: a skewed server, a request queued across the kick-off instant,
-- or a script writing straight to the table must all meet the same wall. The
-- fixture's kick-off is read inside the trigger, so a version can only ever
-- be written while the database itself says the match has not started.
CREATE FUNCTION refuse_prediction_after_kickoff() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kickoff timestamptz;
BEGIN
  SELECT f.kickoff_at INTO kickoff
    FROM user_prediction p
    JOIN fixture f ON f.id = p.fixture_id
   WHERE p.id = NEW.prediction_id;

  IF kickoff IS NULL THEN
    RAISE EXCEPTION 'prediction % has no fixture', NEW.prediction_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF now() >= kickoff THEN
    RAISE EXCEPTION 'predictions are locked at kick-off (%)', kickoff
      USING ERRCODE = 'PL001', HINT = 'kick-off has passed by the database clock';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_prediction_after_kickoff() IS
  'Refuses a prediction_version once the fixture has kicked off, by the database clock (T-051). SQLSTATE PL001.';

CREATE TRIGGER prediction_version_lock
  BEFORE INSERT ON prediction_version FOR EACH ROW EXECUTE FUNCTION refuse_prediction_after_kickoff();

-- Down Migration

DROP TRIGGER IF EXISTS prediction_version_lock ON prediction_version;
DROP FUNCTION IF EXISTS refuse_prediction_after_kickoff();
