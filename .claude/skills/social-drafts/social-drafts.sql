-- The social media agent's daily read (T-1721, D-349), read-only through the data auditor's runner:
-- bash .claude/skills/data-audit/run.sh .claude/skills/social-drafts/social-drafts.sql
-- What the system already posted to the channel (never drafted again), and the founder's analyses
-- published lately (drafted only as his, linking to the match page). No member data is read.
\pset footer off

\echo == the channel's own posts, last 3 days (kind | day | state | matches | with a forecast | model versions)
SELECT kind, day, state, fixtures, forecasts, array_to_string(model_versions, ', ')
  FROM channel_post WHERE day >= current_date - 2 ORDER BY day DESC, kind;

\echo == the newest forecast and results post, as sent (kind | day | first message, first 700 characters)
SELECT DISTINCT ON (kind) kind, day, left(messages[1], 700)
  FROM channel_post WHERE state = 'sent' AND kind IN ('forecast', 'results') AND day >= current_date - 2
 ORDER BY kind, day DESC;

\echo == the founder's analyses published in the last 48 h (match page | kick-off UTC | version | published)
SELECT '/en/match/' || a.fixture_id, f.kickoff_at, v.version_number, v.published_at
  FROM founder_analysis_version v
  JOIN founder_analysis a ON a.id = v.analysis_id
  JOIN fixture f ON f.id = a.fixture_id
 WHERE v.published_at > now() - interval '48 hours'
 ORDER BY v.published_at DESC LIMIT 10;

\echo == matches today and yesterday (UTC) by status
SELECT kickoff_at::date AS day, status, count(*)
  FROM fixture WHERE kickoff_at >= current_date - 1 AND kickoff_at < current_date + 1
 GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
