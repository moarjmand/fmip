-- Up Migration
-- T-1439 (D-230): coaches -- their own id space, their careers, and the asks.
--
-- 1. The coach id space. API-Football numbers coaches apart from players:
--    coach 4 is Guardiola, player 4 a goalkeeper. Until now a line-up's coach
--    was resolved as `person` under his bare number, the same key a player of
--    that number has, so one `provider_mapping` row could stand for two
--    people. On 2026-10-21 production held 1,967 people named as a coach;
--    532 of them were also named in line-ups as players (Guardiola's row had
--    played one match in goal). From this release the adapter writes a coach's
--    number as `coach:<n>`, and this migration moves what is stored:
--
--    - A person named only as a coach -- never in a line-up, an incident, a
--      player's statistics, an absence, a squad listing, a spell, the
--      provider's season lines or career -- is a coach: his mapping becomes
--      `coach:<n>`. Nothing else changes; his line-ups keep him.
--    - A person named both ways keeps the bare number: that is the provider's
--      player number, and every player job (names, bios, seasons) asks by it.
--      The line-ups that named him as their coach are moved out to
--      `coach_reference_split` (participant, the coach id `coach:<n>`) and
--      their `coach_id` is cleared: those matches name a coach we do not hold
--      yet, which is a gap, not the wrong man. The `coaches` job puts each one
--      back once `coach:<n>` maps to a person (adopted from the queue, D-079).
--      A photo stored for such a person from the provider's coach images is
--      dropped, so the player's own is fetched the next time it is seen.
--
--    Only `api_football` mappings with a bare number are touched: no other
--    provider names coaches apart, and nothing else maps a coach.
--
-- 2. `coach_spell`: a coach's career as the provider lists it, one row per
--    spell at a team `provider_mapping` knows (the others are counted on
--    `coach_fetch`, never kept by name -- rule 1). Each answer replaces the
--    coach's rows from that source. Dates as given; an open spell is the
--    provider's claim, and the reader decides which open spell is current.
--    Not `player_spell`: that is a playing career, and "current team" reads it.
-- 3. `coach_fetch`: per coach, when his profile and career were last written
--    and how many spells came back, were kept, and were left out.
-- 4. `team_coach_fetch`: per team, when its coaches were asked and answered,
--    the coach the answer named as current, and the failures since the last
--    answer (`coaches.ts` gives up after five).
--
-- The derived rows go with the person or team they hang on (ON DELETE
-- CASCADE); the split rows go with the participant.
--
-- `ingest_run_job_check` gains `coaches` by reading the constraint as it is,
-- so jobs another migration of the same release adds are kept.
--
-- Triggers on the tables this touches, listed before writing it:
-- `provider_mapping` has `provider_mapping_set_updated_at` (fires, correctly:
-- the row changed). `fixture_participant` has `fixture_participant_set_updated_at`
-- and `fixture_participant_notify_change` (one NOTIFY per changed match, sent
-- at commit and deduplicated per match; past matches have no subscriber).
-- `entity_media` has `entity_media_set_updated_at` (a delete, not fired).
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is
-- replaced, no row is written). The new tables have none.

DO $$
DECLARE
  jobs text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO jobs
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'ingest_run_job_check';
  IF NOT 'coaches' = ANY (jobs) THEN
    jobs := array_append(jobs, 'coaches');
  END IF;
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  -- Written as `job IN (...)`, which Postgres prints as the quoted list read above.
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ') FROM unnest(jobs) AS j));
END
$$;

CREATE TABLE coach_reference_split (
  participant_id    uuid PRIMARY KEY REFERENCES fixture_participant (id) ON DELETE CASCADE,
  -- The person the reference was taken from: the player with that number.
  person_id         uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  provider          text NOT NULL,
  coach_external_id text NOT NULL,
  split_at          timestamptz NOT NULL DEFAULT now(),
  restored_at       timestamptz,
  CONSTRAINT coach_reference_split_provider_check CHECK (provider IN ('api_football'))
);
CREATE INDEX coach_reference_split_open_idx
  ON coach_reference_split (provider, coach_external_id) WHERE restored_at IS NULL;

CREATE TEMP TABLE named_coach ON COMMIT DROP AS
SELECT DISTINCT fp.coach_id AS person_id, m.external_id
  FROM fixture_participant fp
  JOIN provider_mapping m
    ON m.internal_id = fp.coach_id AND m.entity_type = 'person' AND m.provider = 'api_football'
 WHERE fp.coach_id IS NOT NULL
   AND m.external_id ~ '^[1-9][0-9]*$';

CREATE TEMP TABLE named_player ON COMMIT DROP AS
SELECT person_id FROM lineup
UNION SELECT person_id FROM incident WHERE person_id IS NOT NULL
UNION SELECT related_person_id FROM incident WHERE related_person_id IS NOT NULL
UNION SELECT person_id FROM fixture_player_stat
UNION SELECT person_id FROM fixture_absence
UNION SELECT person_id FROM team_squad_member
UNION SELECT person_id FROM player_spell
UNION SELECT person_id FROM player_season_stat
UNION SELECT person_id FROM player_career_season
UNION SELECT person_id FROM fixture_player_expected;

-- Named both ways: the line-ups' coach references move out.
INSERT INTO coach_reference_split (participant_id, person_id, provider, coach_external_id)
SELECT fp.id, c.person_id, 'api_football', 'coach:' || c.external_id
  FROM named_coach c
  JOIN fixture_participant fp ON fp.coach_id = c.person_id
 WHERE c.person_id IN (SELECT person_id FROM named_player);

UPDATE fixture_participant fp
   SET coach_id = NULL
  FROM coach_reference_split s
 WHERE s.participant_id = fp.id AND fp.coach_id = s.person_id;

DELETE FROM entity_media e
 USING (SELECT DISTINCT person_id FROM coach_reference_split) s
 WHERE e.entity_type = 'person' AND e.entity_id = s.person_id
   AND e.source_provider = 'api_football'
   AND e.source_url LIKE '%/football/coachs/%';

-- Named only as a coach: the mapping moves to the coach id space.
UPDATE provider_mapping m
   SET external_id = 'coach:' || m.external_id
  FROM named_coach c
 WHERE m.provider = 'api_football' AND m.entity_type = 'person'
   AND m.internal_id = c.person_id AND m.external_id = c.external_id
   AND c.person_id NOT IN (SELECT person_id FROM named_player);

CREATE TABLE coach_spell (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source     text NOT NULL,
  person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  start_date date,
  end_date   date,
  fetched_at timestamptz NOT NULL,
  CONSTRAINT coach_spell_source_check CHECK (source IN ('api_football')),
  CONSTRAINT coach_spell_ordered CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX coach_spell_person_idx ON coach_spell (person_id);
CREATE INDEX coach_spell_team_idx ON coach_spell (team_id) WHERE end_date IS NULL;

CREATE TABLE coach_fetch (
  source         text NOT NULL,
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  fetched_at     timestamptz NOT NULL,
  spells_listed  integer NOT NULL,
  spells_kept    integer NOT NULL,
  spells_unmapped integer NOT NULL,
  PRIMARY KEY (source, person_id),
  CONSTRAINT coach_fetch_source_check CHECK (source IN ('api_football')),
  CONSTRAINT coach_fetch_counts CHECK (
    spells_kept >= 0 AND spells_unmapped >= 0 AND spells_kept + spells_unmapped <= spells_listed)
);

CREATE TABLE team_coach_fetch (
  source           text NOT NULL,
  team_id          uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  asked_at         timestamptz NOT NULL,
  answered_at      timestamptz,
  failures         integer NOT NULL DEFAULT 0,
  coaches_listed   integer,
  coaches_kept     integer,
  -- The coaches the answer listed that `provider_mapping` does not know yet:
  -- each is in the review queue (D-079) until adopted.
  coaches_unmapped integer,
  PRIMARY KEY (source, team_id),
  CONSTRAINT team_coach_fetch_source_check CHECK (source IN ('api_football')),
  CONSTRAINT team_coach_fetch_failures CHECK (failures >= 0)
);

-- Down Migration

DROP TABLE team_coach_fetch;
DROP TABLE coach_fetch;
DROP TABLE coach_spell;

UPDATE provider_mapping
   SET external_id = substr(external_id, 7)
 WHERE provider = 'api_football' AND entity_type = 'person'
   AND external_id ~ '^coach:[1-9][0-9]*$'
   AND NOT EXISTS (
     SELECT 1 FROM provider_mapping o
      WHERE o.provider = 'api_football' AND o.entity_type = 'person'
        AND o.external_id = substr(provider_mapping.external_id, 7));

UPDATE fixture_participant fp
   SET coach_id = s.person_id
  FROM coach_reference_split s
 WHERE s.participant_id = fp.id AND s.restored_at IS NULL AND fp.coach_id IS NULL;
DROP TABLE coach_reference_split;

DELETE FROM ingest_run WHERE job = 'coaches';
DO $$
DECLARE
  jobs text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO jobs
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'ingest_run_job_check';
  ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
  EXECUTE format('ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check CHECK (job IN (%s))',
                 (SELECT string_agg(quote_literal(j), ', ')
                    FROM unnest(array_remove(jobs, 'coaches')) AS j));
END
$$;
