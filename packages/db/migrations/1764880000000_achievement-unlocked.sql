-- Up Migration
-- T-946 (blueprint 12.2, D-117): an achievement unlock is a notification.
--
-- 1. The notification kind `achievement_unlocked`. Its subject is the member
--    (`member`, already a subject), so it opens their own profile. Like
--    1764790000000_editorial-notifications.sql, each list is read as it
--    stands and widened, and the down migration removes exactly this kind.
--
-- 2. `achievement_unlocked`: the first moment the reputation job derived each
--    achievement for a member (D-091 keeps achievements derived; this table
--    is not read by the profile, a board, the rating or any privilege). One
--    row per member per kind, never deleted by a recomputation, so an
--    achievement that a correction removes and a later one restores is not
--    told twice. `told` says whether a notification was asked for: an achievement
--    first derived long after it was earned -- every achievement earned
--    before this migration, on the job's first pass -- is recorded without a
--    notification.
--
-- Additive: no existing row changes, no backfill. The helpers are `CREATE OR
-- REPLACE` because one migration run is one session.

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
  ARRAY['achievement_unlocked']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['achievement_unlocked']);

CREATE TABLE achievement_unlocked (
  user_id          uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  -- An `AchievementKind` (`achievements@1.0.0`, D-091).
  kind             text NOT NULL,
  -- The stored time of what earned it, as derived when first seen.
  earned_at        timestamptz NOT NULL,
  -- When the reputation job first derived it.
  first_derived_at timestamptz NOT NULL DEFAULT now(),
  rules_version    text NOT NULL,
  -- Whether a notification was asked for: false when it was earned too long
  -- before it was first seen. The member's own switch and mutes still decide.
  told             boolean NOT NULL,
  PRIMARY KEY (user_id, kind),
  CONSTRAINT achievement_unlocked_kind_not_blank CHECK (btrim(kind) <> ''),
  CONSTRAINT achievement_unlocked_rules_not_blank CHECK (btrim(rules_version) <> '')
);

COMMENT ON TABLE achievement_unlocked IS
  'The first moment each achievement was derived for a member (T-946, D-117), so an unlock is told once. Read by nothing but the job that writes it.';

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

DROP TABLE achievement_unlocked;
DELETE FROM notification_preference WHERE kind = 'achievement_unlocked';
DELETE FROM notification WHERE kind = 'achievement_unlocked';
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['achievement_unlocked']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['achievement_unlocked']);
