-- Up Migration
-- T-830 (blueprint 12.2, D-096): match alerts. Two things:
--
-- 1. Five notification kinds and one mute category, `match`. The kind lists
--    are CHECK constraints that several tasks widen, so this migration does
--    not restate them: it reads each constraint as it stands and appends its
--    own values, and the down migration removes exactly those. Whatever
--    another migration added before or after this one is kept.
--
-- 2. `match_alert`, one row per match event the live ingestion saw: the key
--    that makes it the same event on a retry or a feed correction, and the
--    line a member reads, written once with the teams and the score as they
--    were. A notification about it carries the key as its dedupe key, so
--    "one per member per event" is the existing unique index, and the inbox
--    reads the line through that key. Append-only: a disallowed goal is a
--    new row that names the goal it withdraws, never an edit of the goal.
--    Additive: no existing row changes, no backfill.

CREATE FUNCTION pg_temp.widen_check(p_table text, p_constraint text, p_values text[])
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
  -- The first list in the constraint is the one to widen: a kind list is the
  -- only list in its constraint, and the category list is the only list in
  -- the mute's shape (its id pattern is a regular expression, not a list).
  IF def !~ 'ARRAY\[' THEN
    RAISE EXCEPTION '% on % has no list to widen: %', p_constraint, p_table, def;
  END IF;
  def := regexp_replace(def, '(ARRAY\[[^\]]*)\]', '\1' || additions || ']');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, p_constraint);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, p_constraint, def);
END $$;

SELECT pg_temp.widen_check('notification', 'notification_kind_check',
  ARRAY['match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time']);
SELECT pg_temp.widen_check('notification_mute', 'notification_mute_target_shape',
  ARRAY['match']);

CREATE TABLE match_alert (
  -- `<fixture>:kickoff`, `<fixture>:goal:home:2#1`, `<fixture>:goal-void:home:2#1`,
  -- `<fixture>:red:<person>`, `<fixture>:half-time`, `<fixture>:full-time`.
  event_key  text PRIMARY KEY,
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  -- For a correction, the goal it withdraws; null for everything else.
  withdraws  text REFERENCES match_alert (event_key) ON DELETE CASCADE,
  line       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_alert_kind_check CHECK (
    kind IN ('match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time')
  ),
  CONSTRAINT match_alert_key_names_fixture CHECK (starts_with(event_key, fixture_id::text || ':')),
  CONSTRAINT match_alert_withdraws_a_goal CHECK (withdraws IS NULL OR kind = 'match_goal'),
  CONSTRAINT match_alert_line_not_blank CHECK (btrim(line) <> '')
);

CREATE INDEX match_alert_fixture_idx ON match_alert (fixture_id);

COMMENT ON TABLE match_alert IS
  'Match events the live ingestion saw (T-830, D-096): the key a notification dedupes on, and the line it reads. Append-only; a correction is a row naming the goal it withdraws.';

-- Down Migration

CREATE FUNCTION pg_temp.narrow_check(p_table text, p_constraint text, p_values text[])
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

DROP TABLE match_alert;
DELETE FROM notification_mute WHERE scope = 'category' AND target = 'match';
DELETE FROM notification_preference
 WHERE kind IN ('match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time');
DELETE FROM notification
 WHERE kind IN ('match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time');
SELECT pg_temp.narrow_check('notification_mute', 'notification_mute_target_shape', ARRAY['match']);
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['match_kickoff', 'match_goal', 'match_red_card', 'match_half_time', 'match_full_time']);
