-- Up Migration

-- ---------------------------------------------------------------------------
-- Duplicate-person candidates (T-1864, D-446 points 2 and 4).
--
-- `person_duplicate_candidates()` lists the pairs of persons that may be one
-- human the provider supplies under two ids: the same `search_key(full_name)`,
-- or one's full name equal to the other's `known_as`, and the same date of
-- birth. Candidates are found, never acted on: a person confirms each merge
-- with `catalog.mjs --merge-people` (D-077, D-079 stand). Left out:
--   * a tombstone (the loser of a live merge): it already redirects;
--   * a pair a person judged to be two humans (`person_not_duplicate`);
--   * a pair whose two rows are both on one match's line-up, or that one
--     incident names together (D-446 point 3): two humans, which
--     `merge_person` refuses too (`person_shared_lineup_fixture`,
--     `person_shared_incident`, the same functions).
-- Each pair carries its signals, for the person who judges it: the same
-- nationality (NULL when either is unknown), the clubs in common through
-- `player_spell` or `team_squad_member`, each row's line-up count and first
-- and last line-up, whether those appearance periods are disjoint (the
-- provider's typical re-issue: one id stops, the other starts; NULL when
-- either has none), and whether a row is a coach's alone (every mapping a
-- `coach:` id, D-230). And the survivor the rule proposes (D-446): the player
-- row of a player and coach pair; else the row with more line-ups; else the
-- older row (`created_at`); else the lower id.
--
-- One statement, one function, read by the data-quality sweep (the check
-- `person_duplicate_candidate`, at most hourly: it reads every person, 3-4 s
-- at production's size, in `apps/api/src/modules/data-quality/`) and by the
-- operator's
-- `catalog.mjs --person-candidates`, so the two never disagree. The join is
-- on the birth date first; only persons with one are compared.
--
-- The data-quality tables' CHECKs gain the new check kind. A finding about a
-- pair of persons has no fixture, team, season or competition: its subject
-- is the two ids, low first.
-- ---------------------------------------------------------------------------

CREATE FUNCTION person_duplicate_candidates()
RETURNS TABLE (
  low_person_id        uuid,
  high_person_id       uuid,
  matched_on           text,
  same_nationality     boolean,
  common_teams         text[],
  low_lineups          integer,
  high_lineups         integer,
  low_first_lineup     timestamptz,
  low_last_lineup      timestamptz,
  high_first_lineup    timestamptz,
  high_last_lineup     timestamptz,
  appearances_disjoint boolean,
  low_coach_only       boolean,
  high_coach_only      boolean,
  proposed_into        uuid,
  proposed_because     text
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT p.id, p.date_of_birth, p.nationality_id, p.created_at,
           search_key(p.full_name) AS name_key, search_key(p.known_as) AS known_key
      FROM person p
     WHERE p.date_of_birth IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM person_merge m
                        WHERE m.from_person_id = p.id AND m.undone_at IS NULL)
  ),
  pairs AS (
    SELECT least(a.id, b.id) AS lo, greatest(a.id, b.id) AS hi,
           bool_or(a.name_key = b.name_key) AS same_name
      FROM live a
      JOIN live b ON b.date_of_birth = a.date_of_birth AND b.id <> a.id
     WHERE a.name_key = b.name_key OR a.name_key = b.known_key
     GROUP BY 1, 2
  ),
  kept AS (
    SELECT pr.*
      FROM pairs pr
     WHERE NOT EXISTS (SELECT 1 FROM person_not_duplicate n
                        WHERE n.low_person_id = pr.lo AND n.high_person_id = pr.hi)
       AND person_shared_lineup_fixture(pr.lo, pr.hi) IS NULL
       AND person_shared_incident(pr.lo, pr.hi) IS NULL
  ),
  signals AS (
    SELECT k.lo, k.hi, k.same_name,
           CASE WHEN pl.nationality_id IS NULL OR ph.nationality_id IS NULL THEN NULL
                ELSE pl.nationality_id = ph.nationality_id END AS same_nationality,
           ARRAY(
             SELECT t.name FROM team t
              WHERE t.id IN (SELECT team_id FROM player_spell WHERE person_id = k.lo
                             UNION SELECT team_id FROM team_squad_member WHERE person_id = k.lo)
                AND t.id IN (SELECT team_id FROM player_spell WHERE person_id = k.hi
                             UNION SELECT team_id FROM team_squad_member WHERE person_id = k.hi)
              ORDER BY t.name) AS common_teams,
           ll.n AS low_lineups, ll.first_at AS low_first, ll.last_at AS low_last,
           hl.n AS high_lineups, hl.first_at AS high_first, hl.last_at AS high_last,
           lc.coach_only AS low_coach_only, hc.coach_only AS high_coach_only,
           pl.created_at AS low_created, ph.created_at AS high_created
      FROM kept k
      JOIN person pl ON pl.id = k.lo
      JOIN person ph ON ph.id = k.hi
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n, min(f.kickoff_at) AS first_at, max(f.kickoff_at) AS last_at
          FROM lineup l
          JOIN fixture_participant fp ON fp.id = l.participant_id
          JOIN fixture f ON f.id = fp.fixture_id
         WHERE l.person_id = k.lo) ll
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n, min(f.kickoff_at) AS first_at, max(f.kickoff_at) AS last_at
          FROM lineup l
          JOIN fixture_participant fp ON fp.id = l.participant_id
          JOIN fixture f ON f.id = fp.fixture_id
         WHERE l.person_id = k.hi) hl
      CROSS JOIN LATERAL (
        SELECT count(*) > 0 AND bool_and(m.external_id LIKE 'coach:%') AS coach_only
          FROM provider_mapping m
         WHERE m.entity_type = 'person' AND m.internal_id = k.lo) lc
      CROSS JOIN LATERAL (
        SELECT count(*) > 0 AND bool_and(m.external_id LIKE 'coach:%') AS coach_only
          FROM provider_mapping m
         WHERE m.entity_type = 'person' AND m.internal_id = k.hi) hc
  ),
  judged AS (
    SELECT s.*,
           CASE
             WHEN s.low_coach_only AND NOT s.high_coach_only THEN s.hi
             WHEN s.high_coach_only AND NOT s.low_coach_only THEN s.lo
             WHEN s.low_lineups > s.high_lineups THEN s.lo
             WHEN s.high_lineups > s.low_lineups THEN s.hi
             WHEN s.low_created < s.high_created THEN s.lo
             WHEN s.high_created < s.low_created THEN s.hi
             ELSE s.lo
           END AS proposed_into,
           CASE
             WHEN s.low_coach_only <> s.high_coach_only THEN 'player_row'
             WHEN s.low_lineups <> s.high_lineups THEN 'more_lineups'
             WHEN s.low_created <> s.high_created THEN 'older_row'
             ELSE 'lower_id'
           END AS proposed_because
      FROM signals s
  )
  SELECT j.lo, j.hi,
         CASE WHEN j.same_name THEN 'full_name' ELSE 'known_as' END,
         j.same_nationality, j.common_teams,
         j.low_lineups, j.high_lineups, j.low_first, j.low_last, j.high_first, j.high_last,
         CASE WHEN j.low_lineups = 0 OR j.high_lineups = 0 THEN NULL
              ELSE j.low_last < j.high_first OR j.high_last < j.low_first END,
         j.low_coach_only, j.high_coach_only, j.proposed_into, j.proposed_because
    FROM judged j
   ORDER BY j.lo, j.hi
$$;

COMMENT ON FUNCTION person_duplicate_candidates() IS
  'T-1864, D-446: pairs of persons with the same normalised full name (or one''s full name the other''s known_as) and birth date; neither a tombstone, not judged different, not on one line-up nor named together by one incident; with their signals and the survivor the rule proposes (player row, more line-ups, older row). Read by the data-quality check person_duplicate_candidate and catalog.mjs --person-candidates. Never acts.';

ALTER TABLE data_quality_finding DROP CONSTRAINT data_quality_finding_check_kind;
ALTER TABLE data_quality_finding ADD CONSTRAINT data_quality_finding_check_kind CHECK (
  check_kind IN (
    'finished_without_score', 'goals_disagree', 'live_overrun',
    'lineup_not_eleven', 'fixture_mapped_twice', 'duplicate_fixture',
    'table_disagrees', 'person_duplicate_candidate'
  )
);

ALTER TABLE data_quality_check_run DROP CONSTRAINT data_quality_check_run_check_kind;
ALTER TABLE data_quality_check_run ADD CONSTRAINT data_quality_check_run_check_kind CHECK (
  check_kind IN (
    'finished_without_score', 'goals_disagree', 'live_overrun',
    'lineup_not_eleven', 'fixture_mapped_twice', 'duplicate_fixture',
    'table_disagrees', 'person_duplicate_candidate'
  )
);

-- Down Migration

-- The check's findings and its run are derived from the stored persons and
-- found again by the next sweep after an up; nothing else refers to them.
DELETE FROM data_quality_finding WHERE check_kind = 'person_duplicate_candidate';
DELETE FROM data_quality_check_run WHERE check_kind = 'person_duplicate_candidate';

ALTER TABLE data_quality_check_run DROP CONSTRAINT data_quality_check_run_check_kind;
ALTER TABLE data_quality_check_run ADD CONSTRAINT data_quality_check_run_check_kind CHECK (
  check_kind IN (
    'finished_without_score', 'goals_disagree', 'live_overrun',
    'lineup_not_eleven', 'fixture_mapped_twice', 'duplicate_fixture',
    'table_disagrees'
  )
);

ALTER TABLE data_quality_finding DROP CONSTRAINT data_quality_finding_check_kind;
ALTER TABLE data_quality_finding ADD CONSTRAINT data_quality_finding_check_kind CHECK (
  check_kind IN (
    'finished_without_score', 'goals_disagree', 'live_overrun',
    'lineup_not_eleven', 'fixture_mapped_twice', 'duplicate_fixture',
    'table_disagrees'
  )
);

DROP FUNCTION person_duplicate_candidates();
