-- The model scientist's weekly read (T-1684, D-328): the live record of every version, pre-kick-off only.
-- Run through the data auditor's read-only runner: bash .claude/skills/data-audit/run.sh <this file>.
-- Intervals here are normal approximations (mean ± 1.96 sd/√n), good for a watch; D-139's paired
-- bootstrap is the lab's (apps/model/fmip_model/backtest), used for a promotion verdict.
\pset footer off

\echo == versions: pre-kick-off evaluations (version | role | n | log loss | Brier | accuracy | first | last)
SELECT mv.model_id, f.role, count(*), round(avg(e.log_loss), 4), round(avg(e.brier), 4),
       round(100.0 * avg(e.correct::int), 1), min(e.evaluated_at)::date, max(e.evaluated_at)::date
  FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = e.model_version_id
 WHERE e.pre_kickoff GROUP BY 1, 2 ORDER BY 2, 1;

\echo == the current published version (the newest with a published pre-kick-off evaluation)
SELECT mv.id AS cur_id, mv.model_id AS cur_model FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = e.model_version_id
 WHERE e.pre_kickoff AND f.role = 'published' ORDER BY e.evaluated_at DESC LIMIT 1 \gset
\echo :cur_model

\echo == paired: shadow against published on the same fixtures (shadow | n | identical % | published LL | shadow LL | diff [95%] | published Brier | shadow Brier)
WITH p AS (
  SELECT DISTINCT ON (e.fixture_id) e.fixture_id, e.log_loss, e.brier
    FROM evaluation e JOIN forecast f ON f.id = e.forecast_id
   WHERE e.pre_kickoff AND f.role = 'published' ORDER BY e.fixture_id, f.computed_at DESC),
s AS (
  SELECT DISTINCT ON (mv.model_id, e.fixture_id) mv.model_id, e.fixture_id, e.log_loss, e.brier
    FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = e.model_version_id
   WHERE e.pre_kickoff AND f.role = 'shadow' ORDER BY mv.model_id, e.fixture_id, f.computed_at DESC),
d AS (SELECT s.model_id, s.log_loss - p.log_loss AS diff, p.log_loss AS pll, s.log_loss AS sll, p.brier AS pb, s.brier AS sb
        FROM s JOIN p USING (fixture_id))
SELECT model_id, count(*), round(100.0 * avg((abs(diff) < 1e-9)::int), 1),
       round(avg(pll), 4), round(avg(sll), 4),
       round(avg(diff), 5) || ' [' || round(avg(diff) - 1.96 * coalesce(stddev_samp(diff), 0) / sqrt(count(*))::numeric, 5)
         || ', ' || round(avg(diff) + 1.96 * coalesce(stddev_samp(diff), 0) / sqrt(count(*))::numeric, 5) || ']',
       round(avg(pb), 4), round(avg(sb), 4)
  FROM d GROUP BY 1;

\echo == coverage: finished fixtures a shadow version forecast that the published one did not (shadow | fixtures)
SELECT mv.model_id, count(DISTINCT e.fixture_id)
  FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = e.model_version_id
 WHERE e.pre_kickoff AND f.role = 'shadow'
   AND NOT EXISTS (SELECT 1 FROM evaluation e2 JOIN forecast f2 ON f2.id = e2.forecast_id
                    WHERE e2.fixture_id = e.fixture_id AND e2.pre_kickoff AND f2.role = 'published')
 GROUP BY 1;

\echo == drift of the current published version: last 28 days against the 28 before (window | n | log loss | Brier | accuracy; "none" when a window is empty)
SELECT w.win, count(e.id), coalesce(round(avg(e.log_loss), 4)::text, 'none'), coalesce(round(avg(e.brier), 4)::text, 'none'),
       coalesce(round(100.0 * avg(e.correct::int), 1)::text, 'none')
  FROM (VALUES ('last 28 d', 0), ('previous 28 d', 28)) w(win, back)
  LEFT JOIN evaluation e ON e.pre_kickoff AND e.model_version_id = :'cur_id'::uuid
   AND e.evaluated_at > now() - make_interval(days => w.back + 28) AND e.evaluated_at <= now() - make_interval(days => w.back)
 GROUP BY w.win, w.back ORDER BY w.back;

\echo == the current published version by competition, its whole record, 20 matches or more (competition | n | log loss [95%] | Brier | accuracy)
SELECT c.name, count(*),
       round(avg(e.log_loss), 4) || ' [' || round(avg(e.log_loss) - 1.96 * stddev_samp(e.log_loss) / sqrt(count(*))::numeric, 3)
         || ', ' || round(avg(e.log_loss) + 1.96 * stddev_samp(e.log_loss) / sqrt(count(*))::numeric, 3) || ']',
       round(avg(e.brier), 4), round(100.0 * avg(e.correct::int), 1)
  FROM evaluation e JOIN fixture fx ON fx.id = e.fixture_id JOIN season s ON s.id = fx.season_id JOIN competition c ON c.id = s.competition_id
 WHERE e.pre_kickoff AND e.model_version_id = :'cur_id'::uuid
 GROUP BY 1 HAVING count(*) >= 20 ORDER BY avg(e.log_loss) DESC;

\echo == calibration of the current published version, each outcome in 10-point bands (outcome | band | n | said % | seen % [95%])
WITH x AS (
  SELECT o.outcome, o.p, (e.outcome = o.outcome)::int AS seen
    FROM evaluation e JOIN forecast f ON f.id = e.forecast_id
   CROSS JOIN LATERAL (VALUES ('home', f.p_home::float), ('draw', f.p_draw::float), ('away', f.p_away::float)) o(outcome, p)
   WHERE e.pre_kickoff AND e.model_version_id = :'cur_id'::uuid AND o.p IS NOT NULL)
SELECT outcome, (width_bucket(p, 0, 1, 10) - 1) * 10 || '-' || width_bucket(p, 0, 1, 10) * 10 || '%', count(*),
       round((avg(p) * 100)::numeric, 1),
       round((avg(seen) * 100)::numeric, 1) || ' [' || round(((avg(seen) - 1.96 * sqrt(avg(seen) * (1 - avg(seen)) / count(*))) * 100)::numeric, 1)
         || ', ' || round(((avg(seen) + 1.96 * sqrt(avg(seen) * (1 - avg(seen)) / count(*))) * 100)::numeric, 1) || ']'
  FROM x GROUP BY outcome, width_bucket(p, 0, 1, 10) HAVING count(*) >= 20 ORDER BY 1, width_bucket(p, 0, 1, 10);

\echo == extreme draws: forecasts above 45% (role | finished | upcoming)
SELECT f.role, count(*) FILTER (WHERE fx.status = 'finished'), count(*) FILTER (WHERE fx.status = 'scheduled')
  FROM forecast f JOIN fixture fx ON fx.id = f.fixture_id WHERE f.p_draw > 0.45 GROUP BY 1;
