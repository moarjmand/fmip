-- Up Migration
-- T-832 (blueprint 8.1 and 12.2, D-100): three notification kinds.
--
--   match_availability  a player the provider says will miss a followed match
--   match_lineups       both line-ups of a followed match announced
--   friend_predicted    a friend predicted a match the member follows or predicted
--
-- The first two are match alerts: each event is a `match_alert` row whose key
-- is also the notification's dedupe key, exactly as D-098's, so their kinds
-- join that table's list too. The third dedupes on
-- `friend_predicted:<fixture>:<friend>` and needs no table.
--
-- Like 1764760000000_match-alerts.sql, this reads each kind list as it stands
-- and appends its own values, and the down migration removes exactly those,
-- so whatever another migration added before or after this one is kept.
-- Additive: no existing row changes, no backfill. The helpers are `CREATE OR
-- REPLACE` because one migration run is one session, and the match-alerts
-- migration may have defined the same `pg_temp` functions in it already.

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
  ARRAY['match_availability', 'match_lineups', 'friend_predicted']);
SELECT pg_temp.widen_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['match_availability', 'match_lineups', 'friend_predicted']);
SELECT pg_temp.widen_check('match_alert', 'match_alert_kind_check',
  ARRAY['match_availability', 'match_lineups']);

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

DELETE FROM notification_preference
 WHERE kind IN ('match_availability', 'match_lineups', 'friend_predicted');
DELETE FROM notification
 WHERE kind IN ('match_availability', 'match_lineups', 'friend_predicted');
DELETE FROM match_alert WHERE kind IN ('match_availability', 'match_lineups');
SELECT pg_temp.narrow_check('match_alert', 'match_alert_kind_check',
  ARRAY['match_availability', 'match_lineups']);
SELECT pg_temp.narrow_check('notification_preference', 'notification_preference_kind_check',
  ARRAY['match_availability', 'match_lineups', 'friend_predicted']);
SELECT pg_temp.narrow_check('notification', 'notification_kind_check',
  ARRAY['match_availability', 'match_lineups', 'friend_predicted']);
