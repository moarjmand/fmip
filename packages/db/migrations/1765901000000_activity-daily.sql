-- Up Migration
-- T-1727 (D-353): the Activity page's sign-ins and active members, kept per
-- day before the retention purge deletes the sessions they are counted from.
--
-- The purge (T-1715, D-345) deletes a session 30 days after it expires, and a
-- session lives 14 days, so without this the page's sign-ins and active
-- members read low for days more than about 44 days back (the window goes to
-- 90). Before it deletes, the purge now has the Activity report keep, for
-- every day up to the latest creation day among the sessions about to go,
-- the two numbers with the report's own definitions
-- (apps/api/src/modules/activity/internal/activity-store.ts):
--
--   sign_ins        count(*) of `session` rows created that UTC day;
--   active_members  count(DISTINCT user_id) over the sessions created and the
--                   prediction versions submitted that UTC day.
--
-- Days are kept contiguously, a quiet day as zeros, so the last kept day is
-- the boundary: the report reads these rows for days up to and including it
-- and the live rows for later days, never both. A kept day is never written
-- again. Aggregate counts only: no member, session or prediction is named.
--
-- The backfill below applies the purge's own rule once, as of the moment
-- this migration runs: every day from the first day either source has a row
-- for, through the latest creation day among the sessions that expired more
-- than 30 days ago (RETENTION_DAYS.expiredSession). It counts what still
-- exists. The purge first ran on 2026-11-03, so the sessions of days before
-- about 2026-09-20 (expired before about 2026-10-04) are already gone: those
-- days keep the prediction-only active members and whatever sessions remain,
-- the same figures the page showed for them just before this migration, and
-- nothing lost can be recovered. Later days are kept by the purge itself.

CREATE TABLE activity_daily (
  day            date PRIMARY KEY,
  sign_ins       integer NOT NULL,
  active_members integer NOT NULL,
  kept_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_daily_sign_ins_non_negative CHECK (sign_ins >= 0),
  CONSTRAINT activity_daily_active_members_non_negative CHECK (active_members >= 0)
);

COMMENT ON TABLE activity_daily IS
  'Anonymous per-UTC-day sign-ins and active members for the Activity page, kept before the retention purge deletes the sessions they were counted from (T-1727, D-353). No member is kept.';

WITH bounds AS (
  SELECT (least((SELECT min(created_at) FROM session),
                (SELECT min(submitted_at) FROM prediction_version))
            AT TIME ZONE 'UTC')::date AS first_day,
         ((SELECT max(created_at) FROM session WHERE expires_at < now() - interval '30 days')
            AT TIME ZONE 'UTC')::date AS last_day
),
days AS (
  SELECT d::date AS day
    FROM bounds, generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') d
),
sign_ins AS (
  SELECT (s.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
    FROM session s, bounds b
   WHERE (s.created_at AT TIME ZONE 'UTC')::date <= b.last_day
   GROUP BY 1
),
active AS (
  SELECT seen.d AS day, count(DISTINCT seen.uid)::int AS n
    FROM (SELECT user_id AS uid, (created_at AT TIME ZONE 'UTC')::date AS d FROM session
          UNION ALL
          SELECT p.user_id, (v.submitted_at AT TIME ZONE 'UTC')::date
            FROM prediction_version v JOIN user_prediction p ON p.id = v.prediction_id) seen,
         bounds b
   WHERE seen.d <= b.last_day
   GROUP BY 1
)
INSERT INTO activity_daily (day, sign_ins, active_members)
SELECT days.day, coalesce(sign_ins.n, 0), coalesce(active.n, 0)
  FROM days
  LEFT JOIN sign_ins USING (day)
  LEFT JOIN active USING (day);

-- Down Migration

DROP TABLE activity_daily;
