-- The growth analyst's weekly read (T-1721, D-349), read-only through the data auditor's runner:
-- bash .claude/skills/data-audit/run.sh .claude/skills/growth-funnel/growth-funnel.sql
-- Aggregates only: no id, name, username, e-mail or message leaves the database. Members (`m`) are
-- active accounts without a staff role (admin, founder, moderator); staff are counted apart. The
-- session is read-only, so `m` is a CTE in every statement rather than a temporary view.
-- Every breakdown keeps only cells of 5 or more and folds the rest into one "fewer than 5 each" row.
\pset footer off

\echo == accounts (members | staff | suspended | deleted)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT (SELECT count(*) FROM m) AS members,
       (SELECT count(DISTINCT user_id) FROM user_role) AS staff,
       (SELECT count(*) FROM user_account WHERE status = 'suspended') AS suspended,
       (SELECT count(*) FROM user_account WHERE status = 'deleted') AS deleted;

\echo == the funnel, all members (registered | e-mail verified | first run done | follows 1+ | predicted 1+ | seen again 1+ day later | push on)
WITH m AS (SELECT u.* FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT count(*) AS registered,
       count(*) FILTER (WHERE m.email_verified_at IS NOT NULL) AS verified,
       count(*) FILTER (WHERE m.first_run_done_at IS NOT NULL) AS first_run,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM followed_entity f WHERE f.user_id = m.id)) AS follows,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_prediction p WHERE p.user_id = m.id)) AS predicted,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s WHERE s.user_id = m.id AND s.last_seen_at > m.created_at + interval '1 day')) AS returned,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM push_subscription ps WHERE ps.user_id = m.id)) AS push
  FROM m;

\echo == weekly cohorts, last 12 ISO weeks (week | joined | verified | predicted in 7 days | seen 7+ days after joining | seen 28+ days after)
WITH m AS (SELECT u.* FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT date_trunc('week', m.created_at)::date AS week, count(*) AS joined,
       count(*) FILTER (WHERE m.email_verified_at IS NOT NULL) AS verified,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_prediction p WHERE p.user_id = m.id AND p.created_at < m.created_at + interval '7 days')) AS predicted_7d,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s WHERE s.user_id = m.id AND s.last_seen_at > m.created_at + interval '7 days')) AS seen_7d,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s WHERE s.user_id = m.id AND s.last_seen_at > m.created_at + interval '28 days')) AS seen_28d
  FROM m WHERE m.created_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1 DESC;

\echo == active members by window (seen in the last 1 | 7 | 28 days, any session)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at > now() - interval '1 day') AS d1,
       count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at > now() - interval '7 days') AS d7,
       count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at > now() - interval '28 days') AS d28
  FROM session s JOIN m ON m.id = s.user_id;

\echo == community predictions by ISO week, last 8 (week | predictions made | members predicting | edited after first save)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)),
     p AS (SELECT p.id, p.user_id, p.created_at, (SELECT count(*) FROM prediction_version v WHERE v.prediction_id = p.id) AS versions
             FROM user_prediction p JOIN m ON m.id = p.user_id WHERE p.created_at > now() - interval '8 weeks')
SELECT date_trunc('week', p.created_at)::date AS week, count(*) AS predictions, count(DISTINCT p.user_id) AS predictors,
       count(*) FILTER (WHERE p.versions > 1) AS edited
  FROM p GROUP BY 1 ORDER BY 1 DESC;

\echo == community predictions, all time (predictions | predictors | in the last 7 days | last prediction day)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT count(*) AS predictions, count(DISTINCT p.user_id) AS predictors,
       count(*) FILTER (WHERE p.created_at > now() - interval '7 days') AS predictions_7d,
       max(p.created_at)::date AS last_day
  FROM user_prediction p JOIN m ON m.id = p.user_id;

\echo == other participation (follows | member follows | group memberships | community analyses | members with notification switches set)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id))
SELECT (SELECT count(*) FROM followed_entity f JOIN m ON m.id = f.user_id) AS follows,
       (SELECT count(*) FROM member_follow mf JOIN m ON m.id = mf.follower_id) AS member_follows,
       (SELECT count(*) FROM group_member g JOIN m ON m.id = g.user_id) AS group_memberships,
       (SELECT count(*) FROM community_analysis c JOIN m ON m.id = c.author_id) AS community_analyses,
       (SELECT count(DISTINCT n.user_id) FROM notification_preference n JOIN m ON m.id = n.user_id) AS members_with_switches;

\echo == members by preferred language (cells under 5 folded)
WITH m AS (SELECT u.* FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)),
     c AS (SELECT m.preferred_language AS k, count(*) AS n FROM m GROUP BY 1)
SELECT k, n FROM c WHERE n >= 5
UNION ALL
SELECT 'fewer than 5 each (' || count(*) || ' languages)', coalesce(sum(n), 0) FROM c WHERE n < 5 HAVING count(*) > 0
ORDER BY 2 DESC;

\echo == members by country (cells under 5 folded)
WITH m AS (SELECT u.* FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)),
     c AS (SELECT co.name AS k, count(*) AS n FROM m JOIN country co ON co.id = m.country_id GROUP BY 1)
SELECT k, n FROM c WHERE n >= 5
UNION ALL
SELECT 'fewer than 5 each (' || count(*) || ' countries)', coalesce(sum(n), 0) FROM c WHERE n < 5 HAVING count(*) > 0
ORDER BY 2 DESC;

\echo == members by device of their newest session (cells under 5 folded)
WITH m AS (SELECT u.id FROM user_account u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)),
     newest AS (SELECT DISTINCT ON (s.user_id) s.user_agent FROM session s JOIN m ON m.id = s.user_id ORDER BY s.user_id, s.last_seen_at DESC),
     c AS (SELECT CASE WHEN user_agent IS NULL THEN 'unknown'
                       WHEN user_agent ~* 'ipad|tablet' THEN 'tablet'
                       WHEN user_agent ~* 'mobile|android|iphone' THEN 'phone'
                       ELSE 'desktop' END AS k, count(*) AS n
             FROM newest GROUP BY 1)
SELECT k, n FROM c WHERE n >= 5
UNION ALL
SELECT 'fewer than 5 each (' || count(*) || ' kinds)', coalesce(sum(n), 0) FROM c WHERE n < 5 HAVING count(*) > 0
ORDER BY 2 DESC;

\echo == the channel's own posts, last 28 days (kind | sent | refused or failed); output, not reach: subscribers are not stored
SELECT kind, count(*) FILTER (WHERE state = 'sent') AS sent, count(*) FILTER (WHERE state IN ('refused', 'failed')) AS not_sent
  FROM channel_post WHERE day > current_date - 28 GROUP BY 1 ORDER BY 1;

\echo == sign-ups by where they started, all months since T-1821 (entry | referring host; cells under 5 folded)
-- D-415: the kind of page where "Create account" was clicked and the other site that linked straight
-- to the register page; an aggregate counted at registration, never beside an account. Staff sign-ups
-- are in it too (the count has no account to tell them apart). Months before the table are not counted.
WITH c AS (SELECT entry || ' | ' || CASE WHEN referrer_host = '' THEN '(none)' ELSE referrer_host END AS k,
                  sum(sign_ups) AS n
             FROM signup_source_monthly GROUP BY 1)
SELECT k, n FROM c WHERE n >= 5
UNION ALL
SELECT 'fewer than 5 each (' || count(*) || ' sources)', coalesce(sum(n), 0) FROM c WHERE n < 5 HAVING count(*) > 0
ORDER BY 2 DESC;

\echo == sign-ups by entry page alone, by month (cells under 5 folded per month)
WITH c AS (SELECT to_char(month, 'YYYY-MM') AS m, entry AS k, sum(sign_ups) AS n
             FROM signup_source_monthly GROUP BY 1, 2)
SELECT m, k, n FROM c WHERE n >= 5
UNION ALL
SELECT m, 'fewer than 5 each (' || count(*) || ' kinds)', sum(n) FROM c WHERE n < 5 GROUP BY m
ORDER BY 1 DESC, 3 DESC;
