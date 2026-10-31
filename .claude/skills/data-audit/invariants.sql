-- The data audit's invariants (T-1680, D-326): statements that must always hold.
-- Each query prints one row: check | severity | violations | sample (up to five subjects).
-- Run only through run.sh, which opens a READ ONLY session: nothing here may write.
-- A check reads our canonical tables only (rule 2) and says what it found, never the answer.
-- Add a check for every new class of defect found (the golden set, golden.md), with its
-- task id in the comment, and keep each query cheap: the whole file runs in seconds.

\pset footer off
\pset tuples_only on
\pset format unaligned
\pset fieldsep ' | '

-- R1 (D-317): a match that went to extra time stores 90' + extra time = the score after play.
WITH x AS (
  SELECT f.id, c.name || ' ' || s.label || ' ' || f.kickoff_at::date AS label
    FROM fixture f
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score e ON e.fixture_id = f.id AND e.kind = 'extra_time'
    JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
    JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
   WHERE f.status = 'finished'
     AND (cur.home <> ft.home + e.home OR cur.away <> ft.away + e.away))
SELECT 'R1 extra_time_sum', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- R2 (D-317): a shoot-out follows a level score after play, over both legs where the tie had a
-- first leg: the same two clubs, season and round within 45 days before, itself not settled by
-- a shoot-out. A match level by itself is never a finding (MLS's best-of-three games are each
-- settled alone, though two of them may share a round).
WITH sh AS (
  SELECT f.id, f.season_id, f.kickoff_at, f.round, c.name || ' ' || s.label || ' ' || f.kickoff_at::date AS label
    FROM fixture f
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score p ON p.fixture_id = f.id AND p.kind = 'penalties'
    JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
   WHERE f.status = 'finished' AND cur.home <> cur.away),
legs AS (
  SELECT sh.id AS tie, sh.label, g.id AS fixture_id
    FROM sh
    JOIN LATERAL (
      SELECT sh.id UNION ALL
      (SELECT f2.id FROM fixture f2
        WHERE f2.season_id = sh.season_id AND f2.status = 'finished'
          AND f2.kickoff_at < sh.kickoff_at AND f2.kickoff_at > sh.kickoff_at - interval '45 days'
          AND f2.round IS NOT DISTINCT FROM sh.round
          AND NOT EXISTS (SELECT 1 FROM fixture_score p2 WHERE p2.fixture_id = f2.id AND p2.kind = 'penalties')
          AND (SELECT array_agg(team_id ORDER BY team_id) FROM fixture_participant WHERE fixture_id = f2.id)
            = (SELECT array_agg(team_id ORDER BY team_id) FROM fixture_participant WHERE fixture_id = sh.id)
        ORDER BY f2.kickoff_at DESC LIMIT 1)) g(id) ON true),
goals AS (
  SELECT l.tie, l.label, fp.team_id,
         sum(CASE fp.side WHEN 'home' THEN cur.home ELSE cur.away END) AS scored
    FROM legs l
    JOIN fixture_participant fp ON fp.fixture_id = l.fixture_id
    JOIN fixture_score cur ON cur.fixture_id = l.fixture_id AND cur.kind = 'current'
   GROUP BY l.tie, l.label, fp.team_id),
x AS (
  SELECT tie, label || ' ' || string_agg(scored::text, '-') AS label
    FROM goals GROUP BY tie, label HAVING min(scored) <> max(scored))
SELECT 'R2 shootout_after_level', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- R3 (D-322): the marked shoot-out kicks scored per side never exceed the shoot-out score
-- (critical: a kick marked that was not one, or a goal of play hidden); fewer is minor, the
-- kick the feed never stored (the one-short reading, D-318).
WITH k AS (
  SELECT i.fixture_id,
         count(*) FILTER (WHERE i.kind = 'penalty_goal' AND fp.side = 'home') AS home,
         count(*) FILTER (WHERE i.kind = 'penalty_goal' AND fp.side = 'away') AS away
    FROM incident i JOIN fixture_participant fp ON fp.id = i.participant_id
   WHERE i.in_shootout GROUP BY i.fixture_id),
x AS (
  SELECT f.id, k.home > p.home OR k.away > p.away AS over,
         c.name || ' ' || s.label || ' ' || f.kickoff_at::date || ' kicks ' || k.home || '-' || k.away
         || ' score ' || p.home || '-' || p.away AS label
    FROM k JOIN fixture f ON f.id = k.fixture_id
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score p ON p.fixture_id = f.id AND p.kind = 'penalties'
   WHERE k.home <> p.home OR k.away <> p.away)
SELECT 'R3a shootout_kicks_over_score', 'critical', count(*) FILTER (WHERE over),
       string_agg(label, '; ') FILTER (WHERE over AND rn <= 5)
  FROM (SELECT x.*, row_number() OVER (PARTITION BY over) AS rn FROM x) y
UNION ALL
SELECT 'R3b shootout_kicks_short', 'minor', count(*) FILTER (WHERE NOT over),
       string_agg(label, '; ') FILTER (WHERE NOT over AND rn <= 5)
  FROM (SELECT x.*, row_number() OVER (PARTITION BY over) AS rn FROM x) y;

-- R4 (D-322, T-1679): penalties at 120' or later in a shoot-out match, none marked: they count as goals.
WITH x AS (
  SELECT f.id, c.name || ' ' || s.label || ' ' || f.kickoff_at::date AS label, s.is_current
    FROM fixture f
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score p ON p.fixture_id = f.id AND p.kind = 'penalties'
   WHERE f.status = 'finished'
     AND EXISTS (SELECT 1 FROM incident i WHERE i.fixture_id = f.id
                  AND i.kind IN ('penalty_goal', 'penalty_missed') AND i.minute >= 120)
     AND NOT EXISTS (SELECT 1 FROM incident i WHERE i.fixture_id = f.id AND i.in_shootout))
SELECT 'R4 shootout_kicks_unmarked', CASE WHEN bool_or(is_current) THEN 'major' ELSE 'minor' END,
       count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER (ORDER BY is_current DESC) AS rn FROM x) y;

-- R6 (D-326, the first audit): a shoot-out has a winner, so its score is never level; a 0-0 row is
-- a period the feed reported as zeros that never happened, and the match page shows "Pens 0-0".
WITH x AS (
  SELECT f.id, c.name || ' ' || s.label || ' ' || f.kickoff_at::date || ' ' || f.status AS label
    FROM fixture f
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score p ON p.fixture_id = f.id AND p.kind = 'penalties'
   WHERE p.home = p.away)
SELECT 'R6 level_shootout_score', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- R7 (D-317, the first audit): the score after 90 minutes never exceeds the score after play.
WITH x AS (
  SELECT f.id, c.name || ' ' || s.label || ' ' || f.kickoff_at::date || ' 90min ' || ft.home || '-' || ft.away
         || ' final ' || cur.home || '-' || cur.away AS label
    FROM fixture f
    JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
    JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
    JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
   WHERE f.status = 'finished' AND (ft.home > cur.home OR ft.away > cur.away))
SELECT 'R7 ninety_exceeds_final', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- R5: a score no football match has (negative, or above 20 a side).
WITH x AS (
  SELECT f.id, sc.kind || ' ' || sc.home || '-' || sc.away || ' ' || f.id AS label
    FROM fixture_score sc JOIN fixture f ON f.id = sc.fixture_id
   WHERE sc.home < 0 OR sc.away < 0 OR sc.home > 20 OR sc.away > 20)
SELECT 'R5 impossible_score', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- S1 (rule 4): a match still live four hours after kick-off.
WITH x AS (
  SELECT f.id, c.name || ' ' || f.kickoff_at || ' minute ' || coalesce(f.minute::text, '?') AS label
    FROM fixture f JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
   WHERE f.status = 'live' AND f.kickoff_at < now() - interval '4 hours')
SELECT 'S1 live_too_long', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- S2 (rule 4): a current-season match still scheduled six hours after its kick-off.
WITH x AS (
  SELECT f.id, c.name || ' ' || f.kickoff_at AS label
    FROM fixture f JOIN season s ON s.id = f.season_id AND s.is_current
    JOIN competition c ON c.id = s.competition_id
   WHERE f.status = 'scheduled' AND f.kickoff_at < now() - interval '6 hours')
SELECT 'S2 scheduled_in_the_past', 'major', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- S3: a match finished before it kicked off.
WITH x AS (
  SELECT f.id, f.id || ' ' || f.kickoff_at AS label FROM fixture f
   WHERE f.status = 'finished' AND f.kickoff_at > now())
SELECT 'S3 finished_in_the_future', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- S4 (rule 4): a job of the last week whose latest run failed, or that has not run for 26 hours
-- (the daily jobs' interval and two hours). `partial` is a run that worked and found disagreements.
-- A job run fewer than three times in the week is an operator's command (absence_history), not a schedule.
WITH latest AS (
  SELECT DISTINCT ON (job) job, status, started_at
    FROM ingest_run
   WHERE started_at > now() - interval '7 days'
     AND job IN (SELECT job FROM ingest_run WHERE started_at > now() - interval '7 days'
                  GROUP BY job HAVING count(*) >= 3)
   ORDER BY job, started_at DESC),
x AS (
  SELECT job, job || ' ' || status || ' ' || to_char(started_at, 'MM-DD HH24:MI') AS label
    FROM latest WHERE status = 'failed' OR started_at < now() - interval '26 hours')
SELECT 'S4 job_failing_or_stopped', 'major', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- T1 (D-325): in an ended league season, every club played as many regular-season matches.
WITH played AS (
  SELECT f.season_id, fp.team_id, count(*) AS n
    FROM fixture f
    JOIN season s ON s.id = f.season_id AND NOT s.is_current
    JOIN competition c ON c.id = s.competition_id AND c.kind = 'league'
    JOIN fixture_participant fp ON fp.fixture_id = f.id
   WHERE f.status IN ('finished', 'awarded') AND f.round ILIKE 'Regular Season%'
   GROUP BY 1, 2),
x AS (
  SELECT p.season_id, c.name || ' ' || s.label || ' ' || min(p.n) || '..' || max(p.n) AS label
    FROM played p JOIN season s ON s.id = p.season_id JOIN competition c ON c.id = s.competition_id
   GROUP BY p.season_id, c.name, s.label
  HAVING max(p.n) - min(p.n) > 1 AND count(*) >= 8)
SELECT 'T1 uneven_league_season', 'minor', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- T2 (D-319): a season with conferences names one for every club that played its league matches.
WITH conf AS (SELECT DISTINCT season_id FROM season_conference),
clubs AS (
  SELECT DISTINCT f.season_id, fp.team_id
    FROM fixture f JOIN conf ON conf.season_id = f.season_id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
   WHERE f.round ILIKE 'Regular Season%'),
x AS (
  SELECT cl.season_id, c.name || ' ' || s.label || ' ' || t.name AS label
    FROM clubs cl
    JOIN season s ON s.id = cl.season_id JOIN competition c ON c.id = s.competition_id
    JOIN team t ON t.id = cl.team_id
   WHERE NOT EXISTS (SELECT 1 FROM season_conference sc
                      WHERE sc.season_id = cl.season_id AND sc.team_id = cl.team_id))
SELECT 'T2 club_without_conference', 'major', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- N1 (D-320, T-1676): a current-season match with neither a stage nor a round has no name to show.
WITH x AS (
  SELECT f.id, c.name || ' ' || f.kickoff_at::date AS label
    FROM fixture f JOIN season s ON s.id = f.season_id AND s.is_current
    JOIN competition c ON c.id = s.competition_id
   WHERE f.stage_id IS NULL AND coalesce(f.round, '') = '' AND f.status <> 'cancelled')
SELECT 'N1 match_without_stage_or_round', 'minor', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- I1 (rule 1): two club entities with one name that both played in one competition: a likely
-- duplicate. (Clubs carry no country yet, I4, so a name shared across leagues -- Valencia of Spain
-- and of the AFC Champions League Two -- is not a finding.)
WITH played AS (
  SELECT DISTINCT fp.team_id, s.competition_id
    FROM fixture_participant fp JOIN fixture f ON f.id = fp.fixture_id
    JOIN season s ON s.id = f.season_id),
x AS (
  SELECT DISTINCT LEAST(t1.id, t2.id), t1.name || ' (' || c.name || ')' AS label
    FROM team t1 JOIN team t2 ON t2.name = t1.name AND t2.id <> t1.id AND t2.kind = 'club'
         AND t2.gender = t1.gender AND t2.age_group IS NOT DISTINCT FROM t1.age_group
    JOIN played p1 ON p1.team_id = t1.id
    JOIN played p2 ON p2.team_id = t2.id AND p2.competition_id = p1.competition_id
    JOIN competition c ON c.id = p1.competition_id
   WHERE t1.kind = 'club')
SELECT 'I1 duplicate_club_in_competition', 'major', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 8)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- I4 (rule 3): active clubs with no country: a same-name club cannot be told apart, and a page
-- cannot say where a club is from. Counted for triage; filling it is a task of its own.
SELECT 'I4 club_without_country', 'info', count(*), ''
  FROM team WHERE kind = 'club' AND is_active AND country_id IS NULL;

-- I2: one person on both sides' line-ups of a match.
WITH x AS (
  SELECT fp1.fixture_id, 'fixture ' || fp1.fixture_id || ' person ' || p.full_name AS label
    FROM lineup l1 JOIN fixture_participant fp1 ON fp1.id = l1.participant_id
    JOIN fixture_participant fp2 ON fp2.fixture_id = fp1.fixture_id AND fp2.side <> fp1.side
    JOIN lineup l2 ON l2.participant_id = fp2.id AND l2.person_id = l1.person_id
    JOIN person p ON p.id = l1.person_id
   WHERE fp1.side = 'home')
SELECT 'I2 person_on_both_sides', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- I3: a match whose two sides are one club, or with other than one home and one away side.
WITH x AS (
  SELECT f.id, c.name || ' ' || f.kickoff_at::date AS label
    FROM fixture f JOIN season s ON s.id = f.season_id AND s.is_current
    JOIN competition c ON c.id = s.competition_id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
   GROUP BY f.id, c.name, f.kickoff_at
  HAVING count(*) <> 2 OR count(DISTINCT fp.team_id) <> 2
      OR count(*) FILTER (WHERE fp.side = 'home') <> 1)
SELECT 'I3 sides_malformed', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- M1 (rule 5): a published forecast's three probabilities do not sum to one.
WITH x AS (
  SELECT fc.id, fc.fixture_id || ' ' || (fc.p_home + fc.p_draw + fc.p_away) AS label
    FROM forecast fc
   WHERE fc.role = 'published' AND fc.p_home IS NOT NULL
     AND abs(fc.p_home + fc.p_draw + fc.p_away - 1) > 0.002)
SELECT 'M1 forecast_not_summing', 'critical', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- M2: a match of a modelled league kicking off in the next 24 hours with no published forecast row.
WITH x AS (
  SELECT f.id, c.name || ' ' || f.kickoff_at AS label
    FROM fixture f JOIN season s ON s.id = f.season_id AND s.is_current
    JOIN competition c ON c.id = s.competition_id AND c.football_data_division IS NOT NULL
   WHERE f.status = 'scheduled' AND f.kickoff_at BETWEEN now() AND now() + interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM forecast fc WHERE fc.fixture_id = f.id AND fc.role = 'published'))
SELECT 'M2 forecast_missing_24h', 'major', count(*), string_agg(label, '; ') FILTER (WHERE rn <= 5)
  FROM (SELECT x.*, row_number() OVER () AS rn FROM x) y;

-- P1 (the provider watch, T-1684): today's request budget against the plan, from the watchdog.
SELECT 'P1 request_budget', CASE WHEN coalesce(observed, 0) >= 80 THEN 'major' ELSE 'info' END,
       round(coalesce(observed, 0))::int, note
  FROM watchdog_condition WHERE key = 'request_budget';

-- P2 (rule 1): provider entities waiting for an identity (players and clubs the ingestion could not resolve).
SELECT 'P2 unresolved_pending', CASE WHEN coalesce(sum(n), 0) > 2000 THEN 'major' ELSE 'info' END,
       coalesce(sum(n), 0)::int, string_agg(entity_type || ' ' || n, '; ')
  FROM (SELECT entity_type, count(*) AS n FROM unresolved_entity WHERE status = 'pending' GROUP BY 1) u;

-- P3 (coverage, rule 3): matches finished in the last 26 hours with no line-up stored, by competition.
WITH x AS (
  SELECT c.name, count(*) AS played,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fixture_participant fp JOIN lineup l ON l.participant_id = fp.id
                                             WHERE fp.fixture_id = f.id)) AS without
    FROM fixture f JOIN season s ON s.id = f.season_id JOIN competition c ON c.id = s.competition_id
   WHERE f.status = 'finished' AND f.kickoff_at BETWEEN now() - interval '26 hours' AND now() - interval '2 hours'
   GROUP BY c.name)
SELECT 'P3 finished_without_lineup', CASE WHEN sum(without) * 10 > sum(played) * 3 THEN 'major' ELSE 'info' END,
       coalesce(sum(without), 0)::int,
       string_agg(name || ' ' || without || '/' || played, '; ' ORDER BY without DESC) FILTER (WHERE without > 0)
  FROM x;

-- Q1: the platform's own checks (T-820): open findings by kind, for the agent to triage.
SELECT 'Q1 open_findings', 'info', coalesce(sum(n), 0),
       string_agg(check_kind || ' ' || n, '; ' ORDER BY n DESC)
  FROM (SELECT check_kind, count(*) AS n FROM data_quality_finding
         WHERE resolved_at IS NULL AND reviewed_at IS NULL GROUP BY 1) q;
