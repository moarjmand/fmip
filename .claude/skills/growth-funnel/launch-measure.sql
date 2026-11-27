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
-- Small counts (D-459, the marketing wing's minimum cell of 5). Nothing printed may give a hidden
-- cell back, by subtraction or by bounds:
--   - a weekly cell under 5 prints «کمتر از ۵»; a week with fewer than 5 active members hides its
--     whole prediction block (active, predictions, per active member);
--   - a column with a hidden weekly cell never prints its exact total: the «همه» row says
--     «دست‌کم N», N the sum of its shown cells (for active members, the people in the shown
--     weeks, counted once); a column with no hidden cell prints its total;
--   - the «همه» row's per-active figure is over the shown weeks only, and says so when a week is
--     hidden; with no week shown it is «کمتر از ۵»;
--   - the 7-day return counts the members of whole invitation weeks that ended at least 7 days
--     ago and whose sign-up cell is shown, so its denominator is a sum of shown cells; it prints
--     as counts, never as a bare percentage.
-- Since verified never exceeds signed up and no exact total is left, a verified cell under 5
-- beside a shown sign-up cell stays anywhere from 0 to 4.
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
  SELECT count(*) FILTER (WHERE c.s < 5) AS s_hidden,
         coalesce(sum(c.s) FILTER (WHERE c.s >= 5), 0) AS s_shown, coalesce(sum(c.s), 0) AS s_all,
         count(*) FILTER (WHERE c.v < 5) AS v_hidden,
         coalesce(sum(c.v) FILTER (WHERE c.v >= 5), 0) AS v_shown, coalesce(sum(c.v), 0) AS v_all,
         count(*) FILTER (WHERE c.a < 5) AS b_hidden,
         coalesce(sum(c.a) FILTER (WHERE c.a >= 5), 0) AS mw_shown,
         coalesce(sum(c.p) FILTER (WHERE c.a >= 5), 0) AS p_shown, coalesce(sum(c.p), 0) AS p_all,
         (SELECT count(DISTINCT pw.user_id) FROM pw JOIN cells x ON x.wk = pw.wk WHERE x.a >= 5) AS people_shown,
         (SELECT count(DISTINCT pw.user_id) FROM pw JOIN cells x ON x.wk = pw.wk) AS people_all
    FROM cells c
),
lines AS (
  SELECT 0 AS o, '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |' AS line
  UNION ALL
  SELECT 1, '|---|---|---|---|---|---|---|'
  UNION ALL
  SELECT 10 + c.wk, format('| %s%s | %s | %s | %s | %s | %s | %s |',
           translate(c.wk::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN c.running THEN ' (در جریان)' ELSE '' END,
           translate(to_char(c.starts, 'YYYY-MM-DD'), '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
           CASE WHEN c.s < 5 THEN 'کمتر از ۵' ELSE translate(c.s::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.v < 5 THEN 'کمتر از ۵' ELSE translate(c.v::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.a < 5 THEN 'کمتر از ۵' ELSE translate(c.a::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.a < 5 THEN 'کمتر از ۵' ELSE translate(c.p::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN c.a < 5 THEN 'کمتر از ۵'
                ELSE translate(round(c.p::numeric / c.a, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫') END)
    FROM cells c
  UNION ALL
  SELECT 1000000, format('| همه | | %s | %s | %s | %s | %s |',
           CASE WHEN t.s_hidden > 0 THEN 'دست‌کم ' || translate(t.s_shown::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')
                WHEN t.s_all < 5 THEN 'کمتر از ۵'
                ELSE translate(t.s_all::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.v_hidden > 0 THEN 'دست‌کم ' || translate(t.v_shown::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')
                WHEN t.v_all < 5 THEN 'کمتر از ۵'
                ELSE translate(t.v_all::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.b_hidden > 0 THEN 'دست‌کم ' || translate(t.people_shown::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')
                WHEN t.people_all < 5 THEN 'کمتر از ۵'
                ELSE translate(t.people_all::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.b_hidden > 0 THEN 'دست‌کم ' || translate(t.p_shown::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹')
                WHEN t.p_all < 5 THEN 'کمتر از ۵'
                ELSE translate(t.p_all::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹') END,
           CASE WHEN t.mw_shown = 0 THEN 'کمتر از ۵'
                ELSE translate(round(t.p_shown::numeric / t.mw_shown, 2)::text, '0123456789.', '۰۱۲۳۴۵۶۷۸۹٫')
                     || CASE WHEN t.b_hidden > 0 THEN ' (روی هفته‌های نشان‌داده)' ELSE '' END END)
    FROM totals t
)
SELECT line FROM lines ORDER BY o;

-- (3) the 7-day return: of the members who joined in whole invitation weeks that ended at least
-- 7 days ago and whose sign-up cell is shown (5 or more), how many had a session seen on or
-- after their seventh day (session.last_seen_at, which only moves forward, at most every 5
-- minutes while a session is used), and, as a stricter floor that an open tab cannot move, how
-- many saved a prediction on or after that day. Every such member is 7 days old or more.
WITH params AS (
  SELECT ((:'launch')::date::timestamp AT TIME ZONE 'UTC') AS launch, (:'internal')::uuid[] AS internal
),
m AS (
  SELECT u.id, u.created_at, floor(extract(epoch FROM u.created_at - p.launch) / 604800)::int + 1 AS wk
    FROM user_account u CROSS JOIN params p
   WHERE u.status = 'active'
     AND u.id <> ALL (p.internal)
     AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)
     AND u.created_at >= p.launch
),
done AS (
  SELECT m.wk
    FROM m CROSS JOIN params p
   GROUP BY m.wk, p.launch
  HAVING count(*) >= 5 AND p.launch + (m.wk + 1) * interval '7 days' <= now()
),
r AS (
  SELECT count(*) AS eligible,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s
                                         WHERE s.user_id = m.id
                                           AND s.last_seen_at >= m.created_at + interval '7 days')) AS seen,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_prediction up
                                         WHERE up.user_id = m.id
                                           AND up.created_at >= m.created_at + interval '7 days')) AS predicted,
         (SELECT string_agg(translate(wk::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'), '، ' ORDER BY wk) FROM done) AS weeks
    FROM m WHERE m.wk IN (SELECT wk FROM done)
)
SELECT CASE WHEN r.eligible = 0
            THEN 'بازگشت ۷ روزه: هنوز هفته‌ای نیست که دست‌کم ۷ روز پیش تمام شده و ثبت‌نامش نشان داده شده باشد.'
            ELSE format('بازگشت ۷ روزه، اعضای هفتهٔ %s: %s از %s در روز هفتم یا پس از آن دوباره دیده شدند؛ %s از همان %s در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
                        r.weeks,
                        translate(r.seen::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.predicted::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
                        translate(r.eligible::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'))
       END AS line
  FROM r;
