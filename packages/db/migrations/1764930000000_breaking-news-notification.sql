-- Up Migration
-- T-1005 (blueprint 12.2, D-125): the breaking alert.
--
-- 1. The notification kind `breaking_news`, off by default (the default lives
--    in `NOTIFICATION_DEFAULTS`, not here). Each kind list is read as it stands
--    and widened, as 1764880000000_achievement-unlocked.sql does, and the down
--    migration removes exactly this kind.
--
-- 2. The subject `story`: a breaking alert opens the story page, and its
--    `subject_id` is the story.
--
-- 3. `notification_about` learns what a story is about -- the teams and
--    competitions any of its reports link -- so a member's team and
--    competition mutes silence a breaking alert about them exactly as they
--    silence a match alert (T-331). The fixture branch is unchanged.
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

SELECT pg_temp.widen_check('notification', 'notification_kind_check', ARRAY['breaking_news']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['breaking_news']);
SELECT pg_temp.widen_check('notification', 'notification_subject_kind', ARRAY['story']);

CREATE OR REPLACE FUNCTION notification_about(p_subject_type text, p_subject_id text)
  RETURNS TABLE (team_id uuid, competition_id uuid)
  LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT CASE p_subject_type
             WHEN 'fixture' THEN p_subject_id::uuid
             WHEN 'prediction' THEN (SELECT fixture_id FROM user_prediction WHERE id = p_subject_id::uuid)
             WHEN 'panel_post' THEN (SELECT fixture_id FROM panel_post WHERE id = p_subject_id::uuid)
           END AS fixture_id
     WHERE p_subject_type IN ('fixture', 'prediction', 'panel_post')
       AND p_subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  story AS (
    SELECT CASE WHEN p_subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN p_subject_id::uuid END AS story_id
     WHERE p_subject_type = 'story'
  )
  SELECT p.team_id, s.competition_id
    FROM subject
    JOIN fixture f ON f.id = subject.fixture_id
    JOIN season s ON s.id = f.season_id
    JOIN fixture_participant p ON p.fixture_id = f.id
  UNION ALL
  -- T-1005: a story is about every team and competition any of its reports links.
  SELECT CASE WHEN e.entity_type = 'team' THEN e.entity_id END,
         CASE WHEN e.entity_type = 'competition' THEN e.entity_id END
    FROM story
    JOIN article m ON m.story_id = story.story_id
    JOIN article_entity e ON e.article_id = m.id AND e.entity_type IN ('team', 'competition')
$$;

COMMENT ON FUNCTION notification_about(text, text) IS
  'The teams and competition a notification is about, through its subject; for a story, every team and competition its reports link (T-1005); empty for a subject that is not football (T-331).';

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

CREATE OR REPLACE FUNCTION notification_about(p_subject_type text, p_subject_id text)
  RETURNS TABLE (team_id uuid, competition_id uuid)
  LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT CASE p_subject_type
             WHEN 'fixture' THEN p_subject_id::uuid
             WHEN 'prediction' THEN (SELECT fixture_id FROM user_prediction WHERE id = p_subject_id::uuid)
             WHEN 'panel_post' THEN (SELECT fixture_id FROM panel_post WHERE id = p_subject_id::uuid)
           END AS fixture_id
     WHERE p_subject_type IN ('fixture', 'prediction', 'panel_post')
       AND p_subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT p.team_id, s.competition_id
    FROM subject
    JOIN fixture f ON f.id = subject.fixture_id
    JOIN season s ON s.id = f.season_id
    JOIN fixture_participant p ON p.fixture_id = f.id
$$;

DELETE FROM notification WHERE kind = 'breaking_news' OR subject_type = 'story';
DELETE FROM notification_preference WHERE kind = 'breaking_news';
SELECT pg_temp.narrow_check('notification', 'notification_subject_kind', ARRAY['story']);
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['breaking_news']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check', ARRAY['breaking_news']);
