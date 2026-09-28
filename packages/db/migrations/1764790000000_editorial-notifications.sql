-- Up Migration
-- T-833 (blueprint 18.3, D-100): editorial notifications. Two things:
--
-- 1. Three notification kinds and one subject:
--      founder_analysis_published  the founder's analysis of a followed match
--      analysis_reviewed           a community analysis's review, to its author
--      contributor_eligible        a member newly meets the contributor
--                                  requirements, to administrators
--    and `analysis_draft`, the analyst's own draft (its id is the fixture's),
--    so the answer to a submission opens the editor and no team mute
--    silences it. Like 1764760000000_match-alerts.sql, each list is read as
--    it stands and widened, and the down migration removes exactly these.
--
-- 2. `contributor_eligibility_state`: the last verdict the reputation job saw
--    per member, so administrators are told on the transition to qualifying
--    and not on every recompute. `times_qualified` counts the transitions and
--    names each one in the notification's dedupe key, so a member who drops
--    below and qualifies again is announced again, once.
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
  ARRAY['founder_analysis_published', 'analysis_reviewed', 'contributor_eligible']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['founder_analysis_published', 'analysis_reviewed', 'contributor_eligible']);
SELECT pg_temp.widen_check('notification', 'notification_subject_kind', ARRAY['analysis_draft']);

CREATE TABLE contributor_eligibility_state (
  user_id         uuid PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
  qualifies       boolean NOT NULL,
  -- The rules the verdict was reached under (`privilege-eligibility@...`).
  rules_version   text NOT NULL,
  times_qualified integer NOT NULL DEFAULT 0,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributor_eligibility_state_count CHECK (times_qualified >= 0),
  CONSTRAINT contributor_eligibility_state_rules_not_blank CHECK (btrim(rules_version) <> '')
);

COMMENT ON TABLE contributor_eligibility_state IS
  'The last contributor-eligibility verdict seen per member (T-833, D-100), so administrators are told on the transition to qualifying, once per transition.';

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

DROP TABLE contributor_eligibility_state;
DELETE FROM notification_preference
 WHERE kind IN ('founder_analysis_published', 'analysis_reviewed', 'contributor_eligible');
DELETE FROM notification
 WHERE kind IN ('founder_analysis_published', 'analysis_reviewed', 'contributor_eligible')
    OR subject_type = 'analysis_draft';
SELECT pg_temp.narrow_check('notification', 'notification_subject_kind', ARRAY['analysis_draft']);
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['founder_analysis_published', 'analysis_reviewed', 'contributor_eligible']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['founder_analysis_published', 'analysis_reviewed', 'contributor_eligible']);
