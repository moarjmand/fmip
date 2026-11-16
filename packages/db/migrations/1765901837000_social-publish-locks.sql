-- Up Migration

-- ---------------------------------------------------------------------------
-- The social publisher (T-1837, D-427): two rules the store already keeps,
-- held by the database too (review of PR #893, round 2, minors 1 and 2).
--
-- 1. A claim for publishing reads the kill switch under a share lock. The
--    guard of `1765901834000` read it with a plain SELECT, so a claim could
--    pass beside a stop not yet committed. Locked, a claim waits for a stop
--    being written and a stop waits for the claim. This trigger's name sorts
--    before `social_post_guard`, so it runs first.
-- 2. Raising a kind to `automatic` needs a reason of its own, not the reason
--    of the change before it (a fresh time alone was accepted), and also
--    reads the switch under a share lock.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION social_post_claim_switch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_stopped boolean;
BEGIN
  IF NEW.state = 'publishing' AND OLD.state IS DISTINCT FROM 'publishing' THEN
    SELECT s.stopped INTO is_stopped FROM social_switch s FOR SHARE;
    IF is_stopped IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'nothing is claimed for publishing while publishing is stopped (D-427)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_claim_switch
  BEFORE UPDATE ON social_post FOR EACH ROW EXECUTE FUNCTION social_post_claim_switch();

CREATE OR REPLACE FUNCTION social_automation_raise_fresh()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_stopped boolean;
BEGIN
  IF NEW.level = 'automatic' AND OLD.level <> 'automatic' THEN
    IF btrim(coalesce(NEW.level_reason, '')) = btrim(coalesce(OLD.level_reason, '')) THEN
      RAISE EXCEPTION 'a raise to automatic records a reason of its own (D-427)';
    END IF;
    SELECT s.stopped INTO is_stopped FROM social_switch s FOR SHARE;
    IF is_stopped IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'no kind is made automatic while publishing is stopped (D-427)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_automation_raise_fresh
  BEFORE UPDATE ON social_automation FOR EACH ROW EXECUTE FUNCTION social_automation_raise_fresh();

-- Down Migration

DROP TRIGGER social_automation_raise_fresh ON social_automation;
DROP FUNCTION social_automation_raise_fresh();
DROP TRIGGER social_post_claim_switch ON social_post;
DROP FUNCTION social_post_claim_switch();
