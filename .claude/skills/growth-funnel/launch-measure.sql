-- The launch measure (T-1966, T-1968, D-459 point 4): read-only, aggregates only.
-- Run it with launch-measure.sh, which sets the two psql variables and the output format and
-- sends it through .claude/skills/data-audit/run.sh's read-only session:
--   launch    the invitation date, a UTC day (yyyy-mm-dd). Week 1 is its first seven days, week 2
--             the next seven, and so on; the last week is the one still running.
--   internal  the internal accounts' ids as an array literal ('{}' for none), read from a file kept
--             outside the repository; they reach the database and never its output.
-- Members are active accounts today that are not internal and hold no staff role (as
-- growth-funnel.sql): an account deleted or suspended later leaves its sign-up week.
--
-- Small counts (D-459, the marketing wing's minimum cell of 5):
--   - a weekly cell under 5 prints «کمتر از ۵»; a week with fewer than 5 active members hides its
--     whole prediction block (active, predictions, per active member);
--   - no hidden cell may come back by subtraction: for each column, the total minus the weekly
--     cells shown is the hidden remainder, and while it is 1 to 4 the smallest shown cell of that
--     column is hidden too, as «پنهان» (it is 5 or more, so «کمتر از ۵» would be false). For the
--     prediction block the remainders are the predictions, the member-weeks, and the active
--     members' total (people, counted once) minus the shown weeks' active members, which is what
--     a reader can subtract; the block is hidden whole;
--   - a total under 5 prints «کمتر از ۵»; the totals' per-active figure (predictions per
--     member-week, which gives away the member-weeks) prints «پنهان» when the predictions' total
--     is under 5 or the hidden member-weeks are 1 to 4;
--   - the 7-day return is printed only when 5 or more members are eligible, as counts, never as
--     a bare percentage.
-- Each statement prints one text column, the lines of the report: no id, name, username, e-mail
-- or message is selected. Numbers are in Persian digits. Times are UTC whatever the server's
-- setting. apps/api/src/launch-measure.spec.ts runs this file on seeded fixtures.
SET TIME ZONE 'UTC';

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
         coalesce(j.signed_up, 0) AS s, coalesce(j.verified, 0) AS v,
         coalesce(a.active, 0) AS a, coalesce(a.predictions, 0) AS p
    FROM weeks w LEFT JOIN joined j USING (wk) LEFT JOIN played a USING (wk)
),
totals AS (
  SELECT (SELECT coalesce(sum(signed_up), 0) FROM joined) AS s,
         (SELECT coalesce(sum(verified), 0) FROM joined) AS v,
         (SELECT count(DISTINCT user_id) FROM pw) AS a,
         (SELECT coalesce(sum(n), 0) FROM pw) AS p,
         (SELECT count(*) FROM pw) AS mw
),
-- Signed up and verified: each column on its own.
sv AS (
  SELECT 's' AS col, wk, s AS val FROM cells
  UNION ALL
  SELECT 'v', wk, v FROM cells
),
sv_ranked AS (  -- the cells shown at first, smallest first, and their running sum
  SELECT col, wk, row_number() OVER w AS k,
         sum(val) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
    FROM sv WHERE val >= 5
  WINDOW w AS (PARTITION BY col ORDER BY val, wk DESC)
),
sv_rest AS (  -- each column's total minus the cells shown at first
  SELECT c.col, c.total - coalesce((SELECT sum(val) FROM sv WHERE sv.col = c.col AND sv.val >= 5), 0) AS rest
    FROM (SELECT 's' AS col, t.s AS total FROM totals t UNION ALL SELECT 'v', t.v FROM totals t) c
),
sv_cut AS (  -- the fewest smallest shown cells to hide besides, so that no remainder of 1 to 4 is left
  SELECT r.col, min(x.k) AS k
    FROM sv_rest r
    JOIN (SELECT col, 0::bigint AS k, 0::numeric AS cum FROM sv_rest
          UNION ALL
          SELECT col, k, cum FROM sv_ranked) x ON x.col = r.col
   WHERE r.rest + x.cum NOT BETWEEN 1 AND 4
      OR x.k = (SELECT count(*) FROM sv_ranked z WHERE z.col = r.col)
   GROUP BY r.col
),
sv_hidden AS (
  SELECT z.col, z.wk FROM sv_ranked z JOIN sv_cut c ON c.col = z.col AND z.k <= c.k
),
-- The prediction block (active, predictions, per active member) of a week is hidden whole.
pb_ranked AS (
  SELECT wk, row_number() OVER w AS k,
         sum(a) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_a,
         sum(p) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_p
    FROM cells WHERE a >= 5
  WINDOW w AS (ORDER BY a, p, wk DESC)
),
pb_rest AS (
  SELECT t.a - coalesce((SELECT sum(a) FROM cells WHERE a >= 5), 0) AS rest_a,
         t.p - coalesce((SELECT sum(p) FROM cells WHERE a >= 5), 0) AS rest_p,
         t.mw - coalesce((SELECT sum(a) FROM cells WHERE a >= 5), 0) AS rest_mw
    FROM totals t
),
pb_steps AS (
  SELECT 0::bigint AS k, 0::numeric AS cum_a, 0::numeric AS cum_p
  UNION ALL
  SELECT k, cum_a, cum_p FROM pb_ranked
),
pb_cut AS (
  SELECT x.k, r.rest_mw + x.cum_a AS hidden_mw
    FROM pb_rest r CROSS JOIN pb_steps x
   WHERE (r.rest_a + x.cum_a NOT BETWEEN 1 AND 4
          AND r.rest_p + x.cum_p NOT BETWEEN 1 AND 4
          AND r.rest_mw + x.cum_a NOT BETWEEN 1 AND 4)
      OR x.k = (SELECT count(*) FROM pb_ranked)
   ORDER BY x.k
   LIMIT 1
),
pb_hidden AS (
  SELECT z.wk FROM pb_ranked z CROSS JOIN pb_cut c WHERE z.k <= c.k
),
shown AS (
  SELECT c.wk, c.starts, c.running,
         CASE WHEN c.s < 5 THEN 'کمتر از ۵'
              WHEN EXISTS (SELECT 1 FROM sv_hidden h WHERE h.col = 's' AND h.wk = c.wk) THEN 'پنهان'
              ELSE translate(c.s::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END AS s,
         CASE WHEN c.v < 5 THEN 'کمتر از ۵'
              WHEN EXISTS (SELECT 1 FROM sv_hidden h WHERE h.col = 'v' AND h.wk = c.wk) THEN 'پنهان'
              ELSE translate(c.v::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END AS v,
         CASE WHEN c.a < 5 THEN 'کمتر از ۵'
              WHEN c.wk IN (SELECT wk FROM pb_hidden) THEN 'پنهان' END AS block,
         c.a, c.p
    FROM cells c
),
lines AS (
  SELECT 0 AS o, '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |' AS line
  UNION ALL
  SELECT 1, '|---|---|---|---|---|---|---|'
  UNION ALL
  SELECT 10 + x.wk, format('| %s%s | %s | %s | %s | %s | %s | %s |',
           translate(x.wk::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN x.running THEN ' (در جریان)' ELSE '' END,
           translate(to_char(x.starts, 'YYYY-MM-DD'), '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           x.s, x.v,
           coalesce(x.block, translate(x.a::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')),
           coalesce(x.block, translate(x.p::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')),
           coalesce(x.block, translate(round(x.p::numeric / x.a, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫')))
    FROM shown x
  UNION ALL
  SELECT 1000000, format('| همه | | %s | %s | %s | %s | %s |',
           CASE WHEN t.s < 5 THEN 'کمتر از ۵' ELSE translate(t.s::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.v < 5 THEN 'کمتر از ۵' ELSE translate(t.v::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.a < 5 THEN 'کمتر از ۵' ELSE translate(t.a::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.p < 5 THEN 'کمتر از ۵' ELSE translate(t.p::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.p < 5 OR c.hidden_mw BETWEEN 1 AND 4 THEN 'پنهان'
                ELSE translate(round(t.p::numeric / t.mw, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫') END)
    FROM totals t CROSS JOIN pb_cut c
)
SELECT line FROM lines ORDER BY o;

-- (3) the 7-day return: of the members who signed up since the invitation and at least 7 days
-- ago, how many had a session seen on or after their seventh day (session.last_seen_at, which
-- only moves forward, at most every 5 minutes while a session is used), and, as a stricter
-- floor that an open tab cannot move, how many saved a prediction on or after that day.
-- Printed only when 5 or more members are eligible.
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
SELECT CASE WHEN r.eligible < 5
            THEN 'بازگشت ۷ روزه: کمتر از ۵ عضو دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند؛ تا ۵ نشوند نشان داده نمی‌شود.'
            ELSE format('بازگشت ۷ روزه: %s از %s عضوی که دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند، در روز هفتم یا پس از آن دوباره دیده شدند؛ %s از همان %s در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
                        translate(r.seen::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.predicted::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'))
       END AS line
  FROM r;
