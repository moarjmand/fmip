-- Up Migration
-- Provider id 0 (T-1600). API-Football writes 0 for a coach, player or venue
-- it does not know, and the adapters took 0 as an id: the first unknown one
-- seen was mapped to `0` (or `coach:0`), and every later unknown one resolved
-- to it. On production (checked 2026-10-26, read-only):
--
-- - person `coach:0` ("Pat Noonan", a second copy; the real one is
--   `coach:16738`) was the coach of 182 match sides from 3 September, River
--   Plate's among them;
-- - person `0` ("Gabri Garcia", a second copy; the real one is 144828) held
--   12,254 player statistic rows from July 2023 and 8 squad places;
-- - venue `0` (a second copy of Elversberg's ground; the real one is 710) was
--   the venue of 577 matches, Sassuolo's and Verona's home games among them.
--
-- T-1600 stops new ones in the adapters. This takes the stored ones back to
-- what we know: no coach, no venue, and no statistics for a player we cannot
-- name (rule 3), then removes the mappings and the copies. Nothing here can
-- be attributed to the right person or ground, so nothing is moved, only
-- un-linked. Settlements, forecasts and ratings never read these columns.
-- No table touched has an immutability trigger (checked: only updated_at and
-- notify triggers).
CREATE TEMP TABLE zero_entity AS
  SELECT entity_type, internal_id
    FROM provider_mapping
   WHERE external_id IN ('0', 'coach:0') AND entity_type IN ('person', 'venue');

UPDATE fixture_participant SET coach_id = NULL
 WHERE coach_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'person');
DELETE FROM fixture_player_stat
 WHERE person_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'person');
DELETE FROM team_squad_member
 WHERE person_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'person');
DELETE FROM person_bio_fetch
 WHERE person_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'person');
DELETE FROM person_name_fetch
 WHERE person_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'person');
UPDATE fixture SET venue_id = NULL
 WHERE venue_id IN (SELECT internal_id FROM zero_entity WHERE entity_type = 'venue');

DELETE FROM provider_mapping
 WHERE external_id IN ('0', 'coach:0') AND entity_type IN ('person', 'venue');

-- The copies themselves, each only if nothing else still names it: a
-- reference this repair did not foresee keeps that row rather than failing
-- the rollout.
DO $$
DECLARE
  z record;
BEGIN
  FOR z IN SELECT entity_type, internal_id FROM zero_entity LOOP
    BEGIN
      IF z.entity_type = 'person' THEN
        DELETE FROM person WHERE id = z.internal_id;
      ELSE
        DELETE FROM venue WHERE id = z.internal_id;
      END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'T-1600: % % is still referenced and stays', z.entity_type, z.internal_id;
    END;
  END LOOP;
END $$;
DROP TABLE zero_entity;

-- Down Migration
-- A repair: nothing to put back.
SELECT 1;
