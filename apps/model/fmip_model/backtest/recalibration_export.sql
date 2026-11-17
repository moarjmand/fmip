-- D-450 (T-1876): the development window of the recalibration, exported read-only from production.
--
-- Every finished match kicked off from 2026-10-10 00:00 to 2026-11-17 23:59 UTC with a pre-kick-off
-- forecast, each once, by its last forecast before kick-off (D-209, D-371): dixon-coles-elo@0.7.0's
-- where it made one (shadow until D-410, published after; the same constants, so either role), else
-- dixon-coles-elo@0.6.0's published one. Written as CSV to stdout for
-- `python -m fmip_model.backtest.recalibration`.
--
--     bash .claude/skills/data-audit/run.sh apps/model/fmip_model/backtest/recalibration_export.sql > window.csv
--
-- The runner's session is read-only already; the transaction says so again, and is rolled back.
BEGIN READ ONLY;
\copy (WITH last AS (SELECT DISTINCT ON (e.fixture_id, mv.model_id) e.fixture_id, fx.kickoff_at, s.competition_id, mv.model_id, f.role, f.id AS forecast_id, f.computed_at, f.p_home::float AS p_home, f.p_draw::float AS p_draw, f.p_away::float AS p_away, e.outcome FROM evaluation e JOIN forecast f ON f.id = e.forecast_id JOIN model_version mv ON mv.id = f.model_version_id JOIN fixture fx ON fx.id = e.fixture_id JOIN season s ON s.id = fx.season_id WHERE e.pre_kickoff AND f.status = 'available' AND f.p_home IS NOT NULL AND fx.kickoff_at >= TIMESTAMPTZ '2026-10-10 00:00:00+00' AND fx.kickoff_at < TIMESTAMPTZ '2026-11-18 00:00:00+00' AND (mv.model_id = 'dixon-coles-elo@0.7.0' OR (mv.model_id = 'dixon-coles-elo@0.6.0' AND f.role = 'published')) ORDER BY e.fixture_id, mv.model_id, f.computed_at DESC, f.id DESC) SELECT DISTINCT ON (l.fixture_id) l.fixture_id, to_char(l.kickoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS kickoff_at, l.competition_id, l.model_id, l.role, l.forecast_id, to_char(l.computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS computed_at, l.p_home, l.p_draw, l.p_away, l.outcome FROM last l ORDER BY l.fixture_id, (l.model_id = 'dixon-coles-elo@0.7.0') DESC) TO STDOUT WITH (FORMAT csv, HEADER)
ROLLBACK;
