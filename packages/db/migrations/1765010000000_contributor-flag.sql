-- Up Migration
-- T-1031 (blueprint 9.4, D-137): a contributor below the threshold for a
-- sustained period is flagged to administrators, and never paused by the
-- platform.
--
-- 1. `contributor_flag`: one row per stretch below the threshold, raised by
--    the daily check once the stretch has lasted the period. A stretch is
--    named by the moment it began (`below_since`, the first stored rating of
--    the unbroken run below), so the check raising it twice is one row, and a
--    member who recovers and falls again is a new stretch and a new flag.
--    Everything the flag was decided from is on the row -- the threshold, the
--    period, the rules version and the rating at the time -- so it can be
--    recomputed from `rating_snapshot` alone (rule 8).
--
--    **Nothing here pauses anybody.** A flag is closed by the member's rating
--    coming back above the threshold (`recovered`), by the grant no longer
--    being live because a person paused or withdrew it (`grant_not_live`), or
--    by an administrator dismissing it with a reason (`dismissed`, audited).
--    A flag is closed once and never reopened or edited.
--
-- 2. The notification kind `contributor_below_threshold`, to administrators,
--    once per flag. Widened like 1764790000000_editorial-notifications.sql,
--    and the down migration removes exactly this kind.
--
-- Additive: no existing row changes, no backfill.

CREATE OR REPLACE FUNCTION pg_temp.widen_check(p_table text, p_constraint text, p_values text[])
  RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  def text;
  additions text := '';
  v text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO STRICT def
    FROM pg_constraint c
   WHERE c.conrelid = p_table::regclass AND c.conname = p_constraint;
  FOREACH v IN ARRAY p_values LOOP
    IF position(quote_literal(v) || '::text' IN def) = 0 THEN
      additions := additions || ', ' || quote_literal(v) || '::text';
    END IF;
  END LOOP;
  IF additions = '' THEN RETURN; END IF;
  IF def !~ 'ARRAY\[' THEN
    RAISE EXCEPTION '% on % has no list to widen: %', p_constraint, p_table, def;
  END IF;
  def := regexp_replace(def, '(ARRAY\[[^\]]*)\]', '\1' || additions || ']');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, p_constraint);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, p_constraint, def);
END $$;

SELECT pg_temp.widen_check('notification', 'notification_kind_check',
  ARRAY['contributor_below_threshold']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['contributor_below_threshold']);

CREATE TABLE contributor_flag (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  -- The grant that was live when the flag was raised.
  grant_id        uuid NOT NULL REFERENCES contributor_grant (id) ON DELETE CASCADE,
  -- The first stored rating of the unbroken run below the threshold.
  below_since     timestamptz NOT NULL,
  -- What the flag was decided under, so it can be recomputed (rule 8).
  threshold       numeric(6, 2) NOT NULL,
  period_days     integer NOT NULL,
  rules_version   text NOT NULL,
  -- The member's newest stored rating when the flag was raised.
  rating          numeric(6, 2) NOT NULL,
  raised_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  closed_reason   text,
  -- Set for a dismissal only: the administrator, and why.
  closed_by       uuid REFERENCES user_account (id) ON DELETE SET NULL,
  close_note      text,
  CONSTRAINT contributor_flag_period_positive CHECK (period_days >= 1),
  CONSTRAINT contributor_flag_rating_below CHECK (rating < threshold),
  CONSTRAINT contributor_flag_rules_not_blank CHECK (btrim(rules_version) <> ''),
  CONSTRAINT contributor_flag_one_per_stretch UNIQUE (user_id, below_since),
  CONSTRAINT contributor_flag_closure_is_whole CHECK (
    (closed_at IS NULL AND closed_reason IS NULL AND closed_by IS NULL AND close_note IS NULL)
    OR (closed_at IS NOT NULL AND closed_reason IS NOT NULL
        AND closed_reason IN ('recovered', 'grant_not_live', 'dismissed')
        AND (closed_reason = 'dismissed') = (close_note IS NOT NULL AND btrim(close_note) <> ''))
  )
);

-- At most one open flag per member: the check closes the old stretch before
-- it raises a new one.
CREATE UNIQUE INDEX contributor_flag_one_open ON contributor_flag (user_id)
  WHERE closed_at IS NULL;

COMMENT ON TABLE contributor_flag IS
  'A contributor below the threshold for the sustained period, flagged to administrators and never paused automatically (T-1031, D-137). Closed once: recovered, grant_not_live or dismissed.';

-- A flag is closed once, and nothing else about it changes. The one UPDATE
-- allowed besides the closure is the `closed_by` cascade when that account
-- is deleted.
CREATE FUNCTION refuse_contributor_flag_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.grant_id, NEW.below_since, NEW.threshold, NEW.period_days,
      NEW.rules_version, NEW.rating, NEW.raised_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.grant_id, OLD.below_since, OLD.threshold, OLD.period_days,
      OLD.rules_version, OLD.rating, OLD.raised_at) THEN
    RAISE EXCEPTION 'a contributor flag records what it was raised from and is never edited'
      USING ERRCODE = 'PL007';
  END IF;
  IF OLD.closed_at IS NOT NULL
     AND NOT (NEW.closed_by IS NULL AND OLD.closed_by IS NOT NULL
              AND (NEW.closed_at, NEW.closed_reason, NEW.close_note)
                  IS NOT DISTINCT FROM (OLD.closed_at, OLD.closed_reason, OLD.close_note)) THEN
    RAISE EXCEPTION 'this contributor flag is already closed'
      USING ERRCODE = 'PL007', HINT = 'a new stretch is a new flag';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_contributor_flag_rewrite() IS
  'Allows closing a contributor flag once (and the closed_by cascade), nothing else (T-1031). SQLSTATE PL007.';

CREATE TRIGGER contributor_flag_no_rewrite
  BEFORE UPDATE ON contributor_flag
  FOR EACH ROW EXECUTE FUNCTION refuse_contributor_flag_rewrite();

-- Down Migration

CREATE OR REPLACE FUNCTION pg_temp.narrow_check(p_table text, p_constraint text, p_values text[])
  RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  def text;
  v text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO STRICT def
    FROM pg_constraint c
   WHERE c.conrelid = p_table::regclass AND c.conname = p_constraint;
  FOREACH v IN ARRAY p_values LOOP
    def := replace(def, ', ' || quote_literal(v) || '::text', '');
  END LOOP;
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, p_constraint);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, p_constraint, def);
END $$;

DROP TRIGGER IF EXISTS contributor_flag_no_rewrite ON contributor_flag;
DROP FUNCTION IF EXISTS refuse_contributor_flag_rewrite();
DROP TABLE IF EXISTS contributor_flag;
DELETE FROM notification_preference WHERE kind = 'contributor_below_threshold';
DELETE FROM notification WHERE kind = 'contributor_below_threshold';
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['contributor_below_threshold']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['contributor_below_threshold']);
