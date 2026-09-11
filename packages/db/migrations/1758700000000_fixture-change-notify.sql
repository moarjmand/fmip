-- Up Migration

-- T-032: the change feed behind the SSE gateway (D-034).
--
-- Every write that changes what a scores card or a match centre shows raises
-- one NOTIFY on the `fixture_change` channel with the fixture id. The API
-- LISTENs and pushes a fresh snapshot to subscribed browsers. Postgres is the
-- source of truth for scores already, so it is also the source of "something
-- changed": no second system to keep in step, and every API instance hears
-- the same notification.
--
-- The payload is deliberately small (fixture id, table, time). Subscribers
-- re-read the fixture; they never trust the payload for content.
CREATE FUNCTION notify_fixture_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changed uuid;
BEGIN
  IF TG_TABLE_NAME = 'fixture' THEN
    changed := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME IN ('lineup', 'fixture_stat') THEN
    SELECT fixture_id INTO changed
      FROM fixture_participant
     WHERE id = COALESCE(NEW.participant_id, OLD.participant_id);
  ELSE
    changed := COALESCE(NEW.fixture_id, OLD.fixture_id);
  END IF;

  IF changed IS NOT NULL THEN
    PERFORM pg_notify(
      'fixture_change',
      json_build_object(
        'fixture_id', changed,
        'table', TG_TABLE_NAME,
        'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )::text
    );
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION notify_fixture_change() IS
  'Raises NOTIFY fixture_change with the fixture id after any write to a fixture or what hangs off it (T-032).';

CREATE TRIGGER fixture_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER fixture_participant_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture_participant
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER fixture_score_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture_score
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER fixture_period_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture_period
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER incident_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON incident
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER lineup_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON lineup
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();
CREATE TRIGGER fixture_stat_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture_stat
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();

-- Down Migration

DROP TRIGGER IF EXISTS fixture_stat_notify_change ON fixture_stat;
DROP TRIGGER IF EXISTS lineup_notify_change ON lineup;
DROP TRIGGER IF EXISTS incident_notify_change ON incident;
DROP TRIGGER IF EXISTS fixture_period_notify_change ON fixture_period;
DROP TRIGGER IF EXISTS fixture_score_notify_change ON fixture_score;
DROP TRIGGER IF EXISTS fixture_participant_notify_change ON fixture_participant;
DROP TRIGGER IF EXISTS fixture_notify_change ON fixture;
DROP FUNCTION IF EXISTS notify_fixture_change();
