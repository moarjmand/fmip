-- The model scientist's weekly read (T-1684, D-328): the live record of every version, pre-kick-off only.
-- Run through the data auditor's read-only runner: bash .claude/skills/data-audit/run.sh <this file>.
-- Intervals here are normal approximations (mean ± 1.96 sd/√n), good for a watch; D-139's paired
-- bootstrap is the lab's (apps/model/fmip_model/backtest), used for a promotion verdict.
-- T-1772: every block counts each MATCH once per version and role, by that version's last forecast
-- computed before kick-off (D-209) -- the agents console's rule (D-371). Before, the blocks counted every
-- evaluated forecast, so n was about three times the matches and every interval too narrow.
\pset footer off

\echo == versions: matches, each once (version | role | matches | log loss | Brier | RPS | accuracy | first kick-off | last kick-off)
-- The counted matches, one row per match, version and role: a psql variable, since the runner is read-only.
\set counted 'SELECT DISTINCT ON (e.fixture_id, f.role, mv.model_id) e.fixture_id, f.role, mv.model_id, mv.id AS model_version_id, e.log_loss, e.brier, e.correct, e.outcome, e.evaluated_at, f.p_home::float AS p_home, f.p_draw::float AS p_draw, f.p_away::float AS p_away, f.computed_at, fx.kickoff_at, s.competition_id, ((f.p_home - (e.outcome = ''home'')::int) ^ 2 + (f.p_home + f.p_draw - (e.outcome <> ''away'')::int) ^ 2) / 2 AS rps FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = f.model_version_id JOIN fixture fx ON fx.id = e.fixture_id JOIN season s ON s.id = fx.season_id WHERE e.pre_kickoff AND mv.model_id <> ''none@0.0.0'' ORDER BY e.fixture_id, f.role, mv.model_id, f.computed_at DESC, f.id DESC'
-- Versions whose decision fixes ONE look (T-1876, D-450): the version, the first kick-off its paired
-- record counts, and the paired count the look is taken at. Until then, while in shadow, the watch
-- gives counts only: no log loss, Brier, accuracy, difference or interval, and D-140's 300 does not apply.
\set one_look 'VALUES (''dixon-coles-elo@0.9.0'', TIMESTAMPTZ ''2026-11-18 00:00:00+00'', 1000)'
WITH one_look(model_id, from_at, look_at) AS (:one_look), counted AS (:counted), v AS (
  SELECT c.model_id, c.role, count(*) AS n, avg(c.log_loss) AS ll, avg(c.brier) AS b, avg(c.rps) AS rps,
         avg(c.correct::int) AS acc, min(c.kickoff_at)::date AS first_ko, max(c.kickoff_at)::date AS last_ko,
         bool_or(c.role = 'shadow' AND o.model_id IS NOT NULL) AS withheld
    FROM counted c LEFT JOIN one_look o ON o.model_id = c.model_id
   GROUP BY 1, 2)
SELECT model_id, role, n,
       CASE WHEN withheld THEN 'withheld (one look)' ELSE round(ll, 4)::text END,
       CASE WHEN withheld THEN 'withheld' ELSE round(b, 4)::text END,
       CASE WHEN withheld THEN 'withheld' ELSE round(rps::numeric, 4)::text END,
       CASE WHEN withheld THEN 'withheld' ELSE round(100.0 * acc, 1)::text END,
       first_ko, last_ko
  FROM v ORDER BY 2, 1;

\echo == the current published version (the one of the newest published forecast)
SELECT mv.id AS cur_id, mv.model_id AS cur_model
  FROM forecast f JOIN model_version mv ON mv.id = f.model_version_id
 WHERE f.role = 'published' AND f.status = 'available' AND mv.model_id <> 'none@0.0.0'
 ORDER BY f.computed_at DESC, f.id DESC LIMIT 1 \gset
\echo :cur_model

\echo == paired: each shadow version against the current published one on the same matches (shadow | n | identical % | published LL | shadow LL | diff [95%] | published Brier | shadow Brier)
\echo == !! a version being judged under D-336 gets ONE look per condition (T-1720): before its count, report the count only
\echo == !! dixon-coles-elo@0.9.0 (D-450) gets ONE look, by the three conditions of D-139, at 1,000 paired matches kicked off from 2026-11-18: counted from that day only, figures withheld below the count; the 300 of D-140 does not apply
WITH one_look(model_id, from_at, look_at) AS (:one_look), counted AS (:counted), d AS (
  SELECT s.model_id, s.log_loss - p.log_loss AS diff, p.log_loss AS pll, s.log_loss AS sll,
         p.brier AS pb, s.brier AS sb,
         (s.p_home = p.p_home AND s.p_draw = p.p_draw AND s.p_away = p.p_away) AS same,
         o.look_at
    FROM counted s JOIN counted p ON p.fixture_id = s.fixture_id
    LEFT JOIN one_look o ON o.model_id = s.model_id
   WHERE s.role = 'shadow' AND p.role = 'published' AND p.model_id = :'cur_model'
     AND (o.model_id IS NULL OR s.kickoff_at >= o.from_at)), g AS (
  SELECT model_id, count(*) AS n, max(look_at) AS look_at, avg(same::int) AS same, avg(pll) AS pll, avg(sll) AS sll,
         avg(diff) AS diff, coalesce(stddev_samp(diff), 0) AS sd, avg(pb) AS pb, avg(sb) AS sb
    FROM d GROUP BY 1)
SELECT model_id,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN n || ' of ' || look_at || ' (counts only)' ELSE n::text END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld' ELSE round(100.0 * same, 1)::text END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld' ELSE round(pll, 4)::text END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld' ELSE round(sll, 4)::text END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld'
            ELSE round(diff, 5) || ' [' || round(diff - 1.96 * sd / sqrt(n)::numeric, 5)
                 || ', ' || round(diff + 1.96 * sd / sqrt(n)::numeric, 5) || ']' END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld' ELSE round(pb, 4)::text END,
       CASE WHEN look_at IS NOT NULL AND n < look_at THEN 'withheld' ELSE round(sb, 4)::text END
  FROM g ORDER BY 1;

\echo == coverage: finished matches a shadow version forecast that no published version did (shadow | matches)
WITH counted AS (:counted)
SELECT s.model_id, count(*)
  FROM counted s
 WHERE s.role = 'shadow'
   AND NOT EXISTS (SELECT 1 FROM counted p WHERE p.fixture_id = s.fixture_id AND p.role = 'published')
 GROUP BY 1;

\echo == drift of the current published version: matches kicked off in the last 28 days against the 28 before (window | n | log loss | Brier | accuracy; "none" when a window is empty)
WITH counted AS (:counted)
SELECT w.win, count(c.fixture_id), coalesce(round(avg(c.log_loss), 4)::text, 'none'),
       coalesce(round(avg(c.brier), 4)::text, 'none'), coalesce(round(100.0 * avg(c.correct::int), 1)::text, 'none')
  FROM (VALUES ('last 28 d', 0), ('previous 28 d', 28)) w(win, back)
  LEFT JOIN counted c ON c.role = 'published' AND c.model_id = :'cur_model'
   AND c.kickoff_at > now() - make_interval(days => w.back + 28) AND c.kickoff_at <= now() - make_interval(days => w.back)
 GROUP BY w.win, w.back ORDER BY w.back;

\echo == the current published version by competition, 20 matches or more (competition | n | log loss [95%] | Brier | accuracy)
WITH counted AS (:counted)
SELECT co.name, count(*),
       round(avg(c.log_loss), 4) || ' [' || round(avg(c.log_loss) - 1.96 * stddev_samp(c.log_loss) / sqrt(count(*))::numeric, 3)
         || ', ' || round(avg(c.log_loss) + 1.96 * stddev_samp(c.log_loss) / sqrt(count(*))::numeric, 3) || ']',
       round(avg(c.brier), 4), round(100.0 * avg(c.correct::int), 1)
  FROM counted c JOIN competition co ON co.id = c.competition_id
 WHERE c.role = 'published' AND c.model_id = :'cur_model'
 GROUP BY 1 HAVING count(*) >= 20 ORDER BY avg(c.log_loss) DESC;

\echo == calibration of the current published version, each outcome in 10-point bands (outcome | band | n | said % | seen % [95%])
WITH counted AS (:counted), x AS (
  SELECT o.outcome, o.p, (c.outcome = o.outcome)::int AS seen
    FROM counted c
   CROSS JOIN LATERAL (VALUES ('home', c.p_home), ('draw', c.p_draw), ('away', c.p_away)) o(outcome, p)
   WHERE c.role = 'published' AND c.model_id = :'cur_model' AND o.p IS NOT NULL)
SELECT outcome, (width_bucket(p, 0, 1, 10) - 1) * 10 || '-' || width_bucket(p, 0, 1, 10) * 10 || '%', count(*),
       round((avg(p) * 100)::numeric, 1),
       round((avg(seen) * 100)::numeric, 1) || ' [' || round(((avg(seen) - 1.96 * sqrt(avg(seen) * (1 - avg(seen)) / count(*))) * 100)::numeric, 1)
         || ', ' || round(((avg(seen) + 1.96 * sqrt(avg(seen) * (1 - avg(seen)) / count(*))) * 100)::numeric, 1) || ']'
  FROM x GROUP BY outcome, width_bucket(p, 0, 1, 10) HAVING count(*) >= 20 ORDER BY 1, width_bucket(p, 0, 1, 10);

\echo == extreme draws: forecasts above 45% (role | finished | upcoming)
SELECT f.role, count(*) FILTER (WHERE fx.status = 'finished'), count(*) FILTER (WHERE fx.status = 'scheduled')
  FROM forecast f JOIN fixture fx ON fx.id = f.fixture_id WHERE f.p_draw > 0.45 GROUP BY 1;
