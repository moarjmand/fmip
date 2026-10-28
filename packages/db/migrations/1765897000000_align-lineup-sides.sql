-- Up Migration
-- Line-ups filed under the other team (T-1628, D-294). For some matches
-- API-Football's archive puts each side's players under the other side's team
-- id: the `lineups` blocks keep their team, coach and formation but carry the
-- opponent's starters and bench, and the substitution events follow them. The
-- adapter matches the blocks to home and away by team id, as it must, so the
-- stored line-up was the opponent's. On production (checked 2026-10-28,
-- read-only) 200 matches were so, 8,480 line-up rows, among them Spain v
-- France of 5 June 2025, where Mbappé and Olise were listed for Spain: 128
-- Conference League and 11 Europa League qualifiers of July and August 2025,
-- 29 Libertadores, 12 MLS play-off, 6 Greek, 5 Argentine, 3 Coppa Italia, 2
-- Nations League finals matches, 2 friendlies, and one each in Iran and
-- Poland. The player page counts a season per team of the line-up, so each of
-- those 5,390 players had a match "for" the opponent. Their 1,799
-- substitutions sat on the same wrong side; one more match (Ecuador v Italy,
-- 24 March 2024) had right line-ups and its 31 minutes rows turned round.
--
-- `align_lineup_sides` decides from our own records, never from the answer
-- alone (an answer whose two parts disagree cannot say which is wrong: in
-- Ecuador v Italy of 24 March 2024 the line-ups were right and the per-player
-- statistics were the ones turned round):
--
-- 1. Each listed player votes for the side the line-up names or for the
--    other one: by his other line-ups (more with one of the two teams than
--    with the other), else, between national teams, by his nationality, else
--    by where this match's per-player minutes put him. A match whose every
--    listed side has at least two votes for the other side and more than four
--    times as many as for its own has its two line-ups exchanged. A moved
--    starter loses his place in the shape (`grid_row`, `grid_col`): it was a
--    place in the other team's formation, which stays with its team. The
--    captain's mark goes too: it named the other team's captain.
-- 2. Per-player statistics follow the line-ups when a side's rows are, by the
--    same majority, players the other side lists.
-- 3. A substitution follows the line-up that names the player going off,
--    when only the other side's does.
--
-- The ingestion calls it after every line-up and player-statistics write, so
-- a re-ask cannot bring the swap back. Here it runs once over every match
-- with a line-up (about 25 seconds and a minute on production for steps 1
-- and 2). Formation, coach and kit colour stay where they are: they were
-- filed under the right team (156 of 180 coached sides coach that team in
-- other matches, 6 the opponent). No table touched is immutable (lineup,
-- fixture_player_stat and incident carry only updated_at and notify
-- triggers); no forecast, prediction or summary exists for any match moved.
CREATE FUNCTION align_lineup_sides(fixtures uuid[])
  RETURNS TABLE (turned integer, lineup_rows integer, stat_rows integer, substitutions integer)
  LANGUAGE plpgsql AS $$
DECLARE
  swapped uuid[];
  restat uuid[];
  moved lineup[];
BEGIN
  turned := 0;
  lineup_rows := 0;
  stat_rows := 0;
  substitutions := 0;

  -- 1. Line-ups that name the other side's players.
  WITH asked AS (
    SELECT DISTINCT a.id FROM unnest(fixtures) AS a(id)
  ), side AS (
    SELECT fp.id AS pid, fp.fixture_id, fp.team_id, o.id AS oid, o.team_id AS oteam
      FROM fixture_participant fp
      JOIN asked ON asked.id = fp.fixture_id
      JOIN fixture_participant o ON o.fixture_id = fp.fixture_id AND o.id <> fp.id
  ), listed AS (
    SELECT s.pid, s.fixture_id, s.team_id, s.oid, s.oteam, l.person_id
      FROM side s
      JOIN lineup l ON l.participant_id = s.pid
  ), history AS (
    SELECT l.person_id, p.team_id, count(*)::integer AS n
      FROM lineup l
      JOIN fixture_participant p ON p.id = l.participant_id
     WHERE l.person_id IN (SELECT person_id FROM listed)
       AND p.team_id IN (SELECT team_id FROM side)
     GROUP BY l.person_id, p.team_id
  ), vote AS (
    SELECT x.pid, x.fixture_id,
           CASE
             -- His other matches: this one names him once for the side
             -- listing him, and for the other only if both lists do.
             WHEN COALESCE(ht.n, 0) - (b.person_id IS NOT NULL)::integer > COALESCE(hm.n, 0) - 1
               THEN 'opp'
             WHEN COALESCE(hm.n, 0) - 1 > COALESCE(ht.n, 0) - (b.person_id IS NOT NULL)::integer
               THEN 'own'
             WHEN t.kind = 'national' AND ot.kind = 'national'
                  AND pe.nationality_id = ot.country_id
                  AND pe.nationality_id IS DISTINCT FROM t.country_id
               THEN 'opp'
             WHEN t.kind = 'national' AND ot.kind = 'national'
                  AND pe.nationality_id = t.country_id
                  AND pe.nationality_id IS DISTINCT FROM ot.country_id
               THEN 'own'
             WHEN mo.person_id IS NOT NULL AND ms.person_id IS NULL THEN 'opp'
             WHEN ms.person_id IS NOT NULL AND mo.person_id IS NULL THEN 'own'
           END AS vote
      FROM listed x
      JOIN person pe ON pe.id = x.person_id
      JOIN team t ON t.id = x.team_id
      JOIN team ot ON ot.id = x.oteam
      LEFT JOIN history hm ON hm.person_id = x.person_id AND hm.team_id = x.team_id
      LEFT JOIN history ht ON ht.person_id = x.person_id AND ht.team_id = x.oteam
      LEFT JOIN lineup b ON b.participant_id = x.oid AND b.person_id = x.person_id
      LEFT JOIN fixture_player_stat ms
        ON ms.participant_id = x.pid AND ms.person_id = x.person_id AND ms.metric = 'minutes'
      LEFT JOIN fixture_player_stat mo
        ON mo.participant_id = x.oid AND mo.person_id = x.person_id AND mo.metric = 'minutes'
  ), tally AS (
    SELECT fixture_id, pid,
           count(*) FILTER (WHERE vote = 'opp') AS opp,
           count(*) FILTER (WHERE vote = 'own') AS own
      FROM vote
     GROUP BY fixture_id, pid
  )
  SELECT array_agg(q.fixture_id) INTO swapped
    FROM (SELECT fixture_id FROM tally
           GROUP BY fixture_id
          HAVING bool_and(opp >= 2 AND own * 4 < opp)) q;

  IF swapped IS NOT NULL THEN
    turned := cardinality(swapped);
    -- Both lists leave and come back exchanged: moved one row at a time, a
    -- shirt number would meet its twin on the other side.
    SELECT array_agg(l) INTO moved
      FROM lineup l
      JOIN fixture_participant fp ON fp.id = l.participant_id
     WHERE fp.fixture_id = ANY(swapped);
    DELETE FROM lineup l
     USING fixture_participant fp
     WHERE fp.id = l.participant_id AND fp.fixture_id = ANY(swapped);
    INSERT INTO lineup (id, participant_id, person_id, role, shirt_number, position, is_captain,
                        grid_row, grid_col, created_at, updated_at)
    SELECT m.id, o.id, m.person_id, m.role, m.shirt_number, m.position, false,
           NULL, NULL, m.created_at, now()
      FROM unnest(moved) AS m
      JOIN fixture_participant s ON s.id = m.participant_id
      JOIN fixture_participant o ON o.fixture_id = s.fixture_id AND o.id <> s.id;
    GET DIAGNOSTICS lineup_rows = ROW_COUNT;
  END IF;

  -- 2. Per-player statistics filed under the other side.
  WITH asked AS (
    SELECT DISTINCT a.id FROM unnest(fixtures) AS a(id)
  ), side AS (
    SELECT fp.id AS pid, fp.fixture_id, o.id AS oid
      FROM fixture_participant fp
      JOIN asked ON asked.id = fp.fixture_id
      JOIN fixture_participant o ON o.fixture_id = fp.fixture_id AND o.id <> fp.id
  ), played AS (
    SELECT s.fixture_id, s.pid,
           (mine.person_id IS NOT NULL) AS own,
           (theirs.person_id IS NOT NULL AND mine.person_id IS NULL) AS opp
      FROM side s
      JOIN fixture_player_stat m ON m.participant_id = s.pid AND m.metric = 'minutes'
      LEFT JOIN lineup mine ON mine.participant_id = s.pid AND mine.person_id = m.person_id
      LEFT JOIN lineup theirs ON theirs.participant_id = s.oid AND theirs.person_id = m.person_id
  )
  SELECT array_agg(q.fixture_id) INTO restat
    FROM (SELECT fixture_id
            FROM (SELECT fixture_id, pid,
                         count(*) FILTER (WHERE opp) AS opp,
                         count(*) FILTER (WHERE own) AS own
                    FROM played
                   GROUP BY fixture_id, pid) per_side
           GROUP BY fixture_id
          HAVING bool_and(opp >= 2 AND own * 4 < opp)) q;

  IF restat IS NOT NULL THEN
    UPDATE fixture_player_stat m
       SET participant_id = o.id
      FROM fixture_participant s, fixture_participant o
     WHERE s.id = m.participant_id
       AND s.fixture_id = ANY(restat)
       AND o.fixture_id = s.fixture_id AND o.id <> s.id
       AND EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = o.id AND l.person_id = m.person_id)
       AND NOT EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = s.id AND l.person_id = m.person_id)
       AND NOT EXISTS (SELECT 1 FROM fixture_player_stat c
                        WHERE c.participant_id = o.id AND c.person_id = m.person_id
                          AND c.metric = m.metric);
    GET DIAGNOSTICS stat_rows = ROW_COUNT;
  END IF;

  -- 3. A substitution goes with the line-up of the player going off.
  UPDATE incident i
     SET participant_id = o.id
    FROM fixture_participant o
   WHERE i.kind = 'substitution'
     AND i.fixture_id IN (SELECT unnest(fixtures))
     AND o.fixture_id = i.fixture_id AND o.id <> i.participant_id
     AND EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = o.id AND l.person_id = i.person_id)
     AND NOT EXISTS (SELECT 1 FROM lineup l
                      WHERE l.participant_id = i.participant_id AND l.person_id = i.person_id);
  GET DIAGNOSTICS substitutions = ROW_COUNT;

  RETURN NEXT;
END
$$;

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r
    FROM align_lineup_sides(ARRAY(
      SELECT DISTINCT fp.fixture_id
        FROM lineup l
        JOIN fixture_participant fp ON fp.id = l.participant_id));
  RAISE NOTICE 'T-1628: % matches turned round (% line-up rows), % statistic rows and % substitutions moved',
    r.turned, r.lineup_rows, r.stat_rows, r.substitutions;
END
$$;

-- Down Migration
-- The repair stays: the rows it moved were wrong where they were.
DROP FUNCTION align_lineup_sides(uuid[]);
