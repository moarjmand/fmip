-- Up Migration
-- T-1673 (D-322): a penalty shoot-out's kicks are marked on the incident.
--
-- The feeds file each kick of a shoot-out as a penalty scored or missed at a
-- minute past the end of play (API-Football numbers them 120+1, 120+2, ...),
-- so every reader that counted `penalty_goal` counted the kicks as goals: the
-- top scorers and the assists boards, the player page's goals, the boards'
-- coverage tally, the player page's "events short" test and the alerts'
-- scorer. On production (2026-10-31, read-only) 3,568 penalty goals at minute
-- 120 or later sat in 613 matches with a shoot-out score.
--
-- `in_shootout` is true for a kick of the shoot-out and false for everything
-- else, a penalty of play included. The ingestion writes it from the feed's
-- own mark (API-Football's "Penalty Shootout" on the event, read by the
-- adapter into `NormalisedIncident.inShootout`; rule 2: our word, never the
-- provider's text). Readers that count goals leave the marked rows out.
--
-- Rows stored before this migration carry no mark, so they are read here
-- once with the web's readings of a shoot-out (`shootoutStart`, T-1477,
-- D-318, D-322), for every match with a shoot-out score above nought:
--
-- 1. The candidates are the trailing run of penalty incidents (scored or
--    missed), after the last incident of any other kind by `sequence`.
-- 2. Exact: the kicks start at the earliest row of the run from which the
--    scored kicks per side equal the shoot-out score (the longest such run,
--    so an opening miss belongs to it).
-- 3. Else, a kick missing from the feed (D-318): among the run's rows from
--    the first one at the last incident's minute (every kick is filed at one
--    minute, 120+1, 120+2, ...), the kicks start at the first row before
--    which the goals of play recorded (goal, penalty goal, own goal; a total,
--    as own goals are filed under either side) add up to the score after
--    play (`current`, else `full_time`; the shoot-out is never in it), and
--    only when the scored kicks from there pass the shoot-out score on
--    neither side and fall short of it by one goal at most.
-- 4. Else, the provider's own numbering of the kicks (the coordinator's
--    decision, 2026-10-31): API-Football numbers a shoot-out's kicks 1, 2,
--    3, ... in `added_time` at one minute. The kicks start at the run's last
--    row numbered 1 at the last incident's minute (rows before it, an
--    in-play penalty at 120+1 among them, stay play), when every row from
--    there is at that minute, the numbers go up by one row to row, or by two
--    where `sequence` also skips one place (a kick the provider listed and
--    the ingestion did not write: on production every gap in the numbering
--    of an unread run matched a gap in `sequence` of the same size, 1,029 of
--    1,033 steps, the other four repeated numbers), there are two kicks at
--    least, and the scored kicks pass the shoot-out score on neither side.
--    A kick past 120+30 has no number (T-538), so a run that long is not
--    read this way.
-- 5. Otherwise nothing is marked (rule 3): the run is left as recorded, and
--    the readers count it as before.
--
-- Read on production the same day (the SELECT alone, read-only): 3,746 rows
-- in 398 matches, 2,710 of them penalty goals (exact: 2,482 rows in 246
-- matches; a kick short: 529 in 61; by the numbering: 735 in 91). 908
-- penalty goals at 120 or later in 228 matches with a shoot-out score stay
-- unmarked: too many of their kicks are missing from the store (gaps in
-- `sequence`, players the ingestion could not resolve; in 149 the kick
-- numbered 1 itself), so no reading holds (D-322).
--
-- A side is the participant's (`fixture_participant.side`); a penalty with no
-- participant scores for neither side, as on the page. A match that already
-- has a marked row is left alone (the feed's mark is better than a reading),
-- and a row already marked is not written again, so the statement can run
-- twice to the same effect.
--
-- Triggers on the table this touches, listed before writing it: `incident`
-- has `incident_set_updated_at` (BEFORE UPDATE) and `incident_notify_change`
-- (AFTER, NOTIFY fixture_change). The update raises one notification per
-- marked row; Postgres folds identical payloads within the transaction (the
-- payload is the fixture id, the table and the transaction's time), so about
-- one per match reaches the API's listener at commit. No table touched is
-- immutable; no forecast, prediction or rating reads incidents.

ALTER TABLE incident ADD COLUMN in_shootout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN incident.in_shootout IS
  'A kick of a penalty shoot-out (T-1673, D-322): never a goal of the match. Written from the feed''s own mark; rows stored before T-1673 were read once from the shoot-out score.';

CREATE VIEW incident_shootout_reading AS
WITH shootout AS (
  SELECT f.id AS fixture_id, pen.home AS pen_home, pen.away AS pen_away,
         COALESCE(cur.home + cur.away, ft.home + ft.away) AS after_play
    FROM fixture f
    JOIN fixture_score pen ON pen.fixture_id = f.id AND pen.kind = 'penalties'
    LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
    LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
   WHERE pen.home + pen.away > 0
     AND NOT EXISTS (SELECT 1 FROM incident m WHERE m.fixture_id = f.id AND m.in_shootout)
), timeline AS (
  SELECT i.id, i.fixture_id, i.sequence, i.kind, i.minute, i.added_time, p.side,
         s.pen_home, s.pen_away, s.after_play,
         i.kind IN ('penalty_goal', 'penalty_missed') AS penalty,
         COALESCE(count(*) FILTER (WHERE i.kind IN ('goal', 'penalty_goal', 'own_goal'))
                    OVER (PARTITION BY i.fixture_id ORDER BY i.sequence
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS goals_before,
         last_value(i.minute) OVER (PARTITION BY i.fixture_id ORDER BY i.sequence
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
           AS last_minute
    FROM incident i
    JOIN shootout s ON s.fixture_id = i.fixture_id
    LEFT JOIN fixture_participant p ON p.id = i.participant_id
), play_end AS (
  SELECT fixture_id, COALESCE(max(sequence) FILTER (WHERE NOT penalty), 0) AS last_play
    FROM timeline
   GROUP BY fixture_id
), run AS (
  SELECT t.*,
         count(*) FILTER (WHERE t.kind = 'penalty_goal' AND t.side = 'home')
           OVER (PARTITION BY t.fixture_id ORDER BY t.sequence DESC
                 ROWS UNBOUNDED PRECEDING) AS home_from,
         count(*) FILTER (WHERE t.kind = 'penalty_goal' AND t.side = 'away')
           OVER (PARTITION BY t.fixture_id ORDER BY t.sequence DESC
                 ROWS UNBOUNDED PRECEDING) AS away_from
    FROM timeline t
    JOIN play_end e ON e.fixture_id = t.fixture_id
   WHERE t.sequence > e.last_play
), exact AS (
  SELECT fixture_id, min(sequence) AS kicks_from
    FROM run
   WHERE home_from = pen_home AND away_from = pen_away
   GROUP BY fixture_id
), last_minute_from AS (
  SELECT fixture_id, min(sequence) AS seq
    FROM run
   WHERE minute = last_minute
   GROUP BY fixture_id
), short_start AS (
  SELECT DISTINCT ON (r.fixture_id) r.fixture_id, r.sequence AS kicks_from,
         r.home_from, r.away_from, r.pen_home, r.pen_away
    FROM run r
    JOIN last_minute_from l ON l.fixture_id = r.fixture_id AND r.sequence >= l.seq
   WHERE r.after_play IS NOT NULL AND r.goals_before = r.after_play
   ORDER BY r.fixture_id, r.sequence
), short AS (
  SELECT fixture_id, kicks_from
    FROM short_start
   WHERE home_from <= pen_home AND away_from <= pen_away
     AND pen_home + pen_away - home_from - away_from <= 1
), numbered_from AS (
  SELECT fixture_id, max(sequence) AS seq
    FROM run
   WHERE added_time = 1 AND minute = last_minute
   GROUP BY fixture_id
), numbered_kicks AS (
  SELECT r.*, n.seq AS numbered_seq,
         r.added_time - lag(r.added_time) OVER w AS number_step,
         r.sequence - lag(r.sequence) OVER w AS place_step
    FROM run r
    JOIN numbered_from n ON n.fixture_id = r.fixture_id AND r.sequence >= n.seq
  WINDOW w AS (PARTITION BY r.fixture_id ORDER BY r.sequence)
), numbered AS (
  -- COALESCE: a kick past 120+30 has no added time, and bool_and would skip
  -- the NULL its step makes.
  SELECT fixture_id, min(sequence) AS kicks_from
    FROM numbered_kicks
   GROUP BY fixture_id
  HAVING count(*) >= 2
     AND bool_and(minute = last_minute)
     AND bool_and(COALESCE(sequence = numbered_seq OR number_step = 1
                           OR (number_step = 2 AND place_step = 2), false))
     AND count(*) FILTER (WHERE kind = 'penalty_goal' AND side = 'home') <= max(pen_home)
     AND count(*) FILTER (WHERE kind = 'penalty_goal' AND side = 'away') <= max(pen_away)
), start AS (
  SELECT d.fixture_id, COALESCE(x.kicks_from, s.kicks_from, n.kicks_from) AS kicks_from,
         CASE WHEN x.kicks_from IS NOT NULL THEN 'exact'
              WHEN s.kicks_from IS NOT NULL THEN 'short'
              ELSE 'numbered' END AS reading
    FROM (SELECT fixture_id FROM exact UNION SELECT fixture_id FROM short
          UNION SELECT fixture_id FROM numbered) d
    LEFT JOIN exact x ON x.fixture_id = d.fixture_id
    LEFT JOIN short s ON s.fixture_id = d.fixture_id
    LEFT JOIN numbered n ON n.fixture_id = d.fixture_id
)
SELECT r.id, r.fixture_id, r.sequence, r.kind, st.reading
  FROM run r
  JOIN start st ON st.fixture_id = r.fixture_id AND r.sequence >= st.kicks_from;

COMMENT ON VIEW incident_shootout_reading IS
  'Kicks of a shoot-out read from the shoot-out score, else from the provider''s numbering of the kicks, for matches with no marked row (T-1673, D-322; the web''s shootoutStart, T-1477, D-318). Read by mark_shootout_kicks(); kept for checks and for a re-run after a repair.';

CREATE FUNCTION mark_shootout_kicks(fixtures uuid[] DEFAULT NULL) RETURNS integer
  LANGUAGE plpgsql AS $$
DECLARE
  marked integer;
BEGIN
  UPDATE incident i
     SET in_shootout = true
    FROM incident_shootout_reading k
   WHERE k.id = i.id AND NOT i.in_shootout
     AND (fixtures IS NULL OR k.fixture_id = ANY (fixtures));
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END
$$;

COMMENT ON FUNCTION mark_shootout_kicks(uuid[]) IS
  'Marks the kicks incident_shootout_reading finds (T-1673, D-322) in the given matches, every match when NULL; returns how many rows it marked. Run once by its migration over every match; running it again marks nothing new.';

DO $$
BEGIN
  RAISE NOTICE 'T-1673: % incidents marked as shoot-out kicks', mark_shootout_kicks();
END
$$;

-- Down Migration
DROP FUNCTION IF EXISTS mark_shootout_kicks(uuid[]);
DROP VIEW IF EXISTS incident_shootout_reading;
ALTER TABLE incident DROP COLUMN IF EXISTS in_shootout;
