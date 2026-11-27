-- The launch measure (T-1966, T-1968, D-459 point 4): read-only, aggregates only.
-- Run it with launch-measure.sh, which sets the two psql variables and the output format and
-- sends it through .claude/skills/data-audit/run.sh's read-only session:
--   launch    the invitation date, a UTC day (yyyy-mm-dd). Week 1 is its first seven days, week 2
--             the next seven, and so on; the last week is the one still running.
--   internal  the internal accounts' ids as an array literal ('{}' for none), read from a file kept
--             outside the repository; they reach the database and never its output.
-- Members are active accounts that are not internal and hold no staff role (as growth-funnel.sql).
-- A person is counted once in a cell. A weekly cell under 5 prints «کمتر از ۵» (a week with fewer
-- than 5 active members hides its whole prediction breakdown); the «همه» row and the 7-day return
-- are totals and print as they are, as counts, never as a bare percentage (D-459).
-- Each statement prints one text column, the lines of the report: no id, name, username, e-mail
-- or message is selected. Numbers are in Persian digits. apps/api/src/launch-measure.spec.ts
-- runs this file on a seeded fixture.

-- (1) signed up and verified, and (2) active members and their predictions, per invitation week.
WITH params AS (
  SELECT ((:'launch')::date::timestamp AT TIME ZONE 'UTC') AS launch, (:'internal')::uuid[] AS internal
),
m AS (
  SELECT u.id, u.created_at, u.email_verified_at
    FROM user_account u CROSS JOIN params p
   WHERE u.status = 'active'
     AND u.id <> ALL (p.internal)
     AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)
),
weeks AS (
  SELECT g AS wk, p.launch + (g - 1) * interval '7 days' AS starts,
         now() < p.launch + g * interval '7 days' AS running
    FROM params p
   CROSS JOIN generate_series(1, floor(extract(epoch FROM now() - p.launch) / 604800)::int + 1) AS g
),
joined AS (
  SELECT floor(extract(epoch FROM m.created_at - p.launch) / 604800)::int + 1 AS wk,
         count(*) AS signed_up,
         count(*) FILTER (WHERE m.email_verified_at IS NOT NULL) AS verified
    FROM m CROSS JOIN params p
   WHERE m.created_at >= p.launch
   GROUP BY 1
),
-- One row per member and week with at least one prediction made (first saved) that week.
pw AS (
  SELECT floor(extract(epoch FROM up.created_at - p.launch) / 604800)::int + 1 AS wk, up.user_id, count(*) AS n
    FROM user_prediction up JOIN m ON m.id = up.user_id CROSS JOIN params p
   WHERE up.created_at >= p.launch
   GROUP BY 1, 2
),
played AS (
  SELECT wk, count(*) AS active, sum(n) AS predictions FROM pw GROUP BY wk
),
cells AS (
  SELECT w.wk, w.starts, w.running,
         coalesce(j.signed_up, 0) AS signed_up, coalesce(j.verified, 0) AS verified,
         coalesce(a.active, 0) AS active, coalesce(a.predictions, 0) AS predictions
    FROM weeks w LEFT JOIN joined j USING (wk) LEFT JOIN played a USING (wk)
),
totals AS (
  SELECT (SELECT coalesce(sum(signed_up), 0) FROM joined) AS signed_up,
         (SELECT coalesce(sum(verified), 0) FROM joined) AS verified,
         (SELECT count(DISTINCT user_id) FROM pw) AS active,
         (SELECT coalesce(sum(n), 0) FROM pw) AS predictions,
         (SELECT count(*) FROM pw) AS member_weeks
),
lines AS (
  SELECT 0 AS o, '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |' AS line
  UNION ALL
  SELECT 1, '|---|---|---|---|---|---|---|'
  UNION ALL
  SELECT 10 + c.wk, format('| %s%s | %s | %s | %s | %s | %s | %s |',
           translate(c.wk::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN c.running THEN ' (در جریان)' ELSE '' END,
           translate(to_char(c.starts AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN c.signed_up < 5 THEN 'کمتر از ۵' ELSE translate(c.signed_up::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.verified < 5 THEN 'کمتر از ۵' ELSE translate(c.verified::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.active < 5 THEN 'کمتر از ۵' ELSE translate(c.active::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.active < 5 THEN 'کمتر از ۵' ELSE translate(c.predictions::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.active < 5 THEN 'کمتر از ۵'
                ELSE translate(round(c.predictions::numeric / c.active, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫') END)
    FROM cells c
  UNION ALL
  SELECT 1000000, format('| همه | | %s | %s | %s | %s | %s |',
           translate(t.signed_up::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           translate(t.verified::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           translate(t.active::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           translate(t.predictions::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN t.member_weeks = 0 THEN '—'
                ELSE translate(round(t.predictions::numeric / t.member_weeks, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫') END)
    FROM totals t
)
SELECT line FROM lines ORDER BY o;

-- (3) the 7-day return: of the members who signed up since the invitation and at least 7 days
-- ago, how many had a session seen on or after their seventh day (session.last_seen_at, which
-- only moves forward, at most every 5 minutes while a session is used), and, as a stricter
-- floor that an open tab cannot move, how many saved a prediction on or after that day.
WITH params AS (
  SELECT ((:'launch')::date::timestamp AT TIME ZONE 'UTC') AS launch, (:'internal')::uuid[] AS internal
),
m AS (
  SELECT u.id, u.created_at
    FROM user_account u CROSS JOIN params p
   WHERE u.status = 'active'
     AND u.id <> ALL (p.internal)
     AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)
     AND u.created_at >= p.launch
     AND u.created_at <= now() - interval '7 days'
),
r AS (
  SELECT count(*) AS eligible,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s
                                         WHERE s.user_id = m.id
                                           AND s.last_seen_at >= m.created_at + interval '7 days')) AS seen,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_prediction up
                                         WHERE up.user_id = m.id
                                           AND up.created_at >= m.created_at + interval '7 days')) AS predicted
    FROM m
)
SELECT CASE WHEN r.eligible = 0
            THEN 'بازگشت ۷ روزه: هنوز عضوی نیست که دست‌کم ۷ روز از ثبت‌نامش گذشته باشد.'
            ELSE format('بازگشت ۷ روزه: %s از %s عضوی که دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند، در روز هفتم یا پس از آن دوباره دیده شدند؛ %s از همان %s در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
                        translate(r.seen::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.predicted::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'))
       END AS line
  FROM r;
