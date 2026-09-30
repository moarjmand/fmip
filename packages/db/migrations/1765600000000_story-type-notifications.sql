-- Up Migration
-- T-1032 (blueprint 12.2, D-166): transfer and availability alerts from typed
-- stories.
--
-- The notification kinds `transfer_news` (a story typed `transfer`) and
-- `availability_news` (a story typed `injury` or `suspension`), both off by
-- default (the defaults live in `NOTIFICATION_DEFAULTS`, not here). Their
-- subject is the story, which 1764930000000_breaking-news-notification.sql
-- already admits, and `notification_about` already says which teams and
-- competitions a story is about, so the mutes apply unchanged. Each kind list
-- is read as it stands and widened, and the down migration removes exactly
-- these kinds.
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
  ARRAY['transfer_news', 'availability_news']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['transfer_news', 'availability_news']);

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

DELETE FROM notification WHERE kind IN ('transfer_news', 'availability_news');
DELETE FROM notification_preference WHERE kind IN ('transfer_news', 'availability_news');
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['transfer_news', 'availability_news']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['transfer_news', 'availability_news']);
