-- The content and community agent's daily read (T-1694, D-339), read-only through the data auditor's runner:
-- bash .claude/skills/data-audit/run.sh .claude/skills/content-watch/content-watch.sql
\pset footer off

\echo == news sources: active, dropped, by kind and language
SELECT kind, language, count(*) FILTER (WHERE dropped_at IS NULL) AS active, count(*) FILTER (WHERE dropped_at IS NOT NULL) AS dropped
  FROM news_source GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15;

\echo == news fetches, last 24 h (status | fetches | sources | items written)
SELECT status, count(*), count(DISTINCT source_id), coalesce(sum(items_written), 0)
  FROM news_fetch WHERE started_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC;

\echo == sources failing every fetch in the last 24 h (source | fetches | last error)
SELECT s.name, count(*), left(max(f.error), 120)
  FROM news_fetch f JOIN news_source s ON s.id = f.source_id
 WHERE f.started_at > now() - interval '24 hours' AND s.dropped_at IS NULL
 GROUP BY s.id, s.name HAVING bool_and(f.status <> 'succeeded') ORDER BY 2 DESC LIMIT 15;

\echo == feeds fetched directly (rss) silent for 7 days (no item written; GNews publishers are read through GNews)
SELECT s.name, s.language, max(f.started_at)::date AS last_fetch
  FROM news_source s LEFT JOIN news_fetch f ON f.source_id = s.id AND f.items_written > 0 AND f.started_at > now() - interval '7 days'
 WHERE s.dropped_at IS NULL AND s.kind = 'rss' GROUP BY s.id, s.name, s.language HAVING count(f.id) = 0 ORDER BY 1 LIMIT 20;

\echo == feeds fetched directly without an image licence record (name | rights)
SELECT name, rights FROM news_source WHERE dropped_at IS NULL AND kind = 'rss' AND image_licence IS NULL ORDER BY 1 LIMIT 20;

\echo == articles written, last 24 h, by source (source | kind | articles | share %)
SELECT s.name, s.kind, count(*), round(100.0 * count(*) / sum(count(*)) OVER (), 1)
  FROM article a JOIN news_source s ON s.id = a.source_id
 WHERE a.fetched_at > now() - interval '24 hours' GROUP BY s.name, s.kind ORDER BY 3 DESC LIMIT 10;

\echo == moderation: open reports by subject and age (subject | open | oldest)
SELECT subject_type, count(*), min(created_at)::date FROM report WHERE decision_id IS NULL GROUP BY 1 ORDER BY 2 DESC;

\echo == moderation: decisions and active sanctions, last 30 days
SELECT (SELECT count(*) FROM moderation_decision WHERE created_at > now() - interval '30 days') AS decisions,
       (SELECT count(*) FROM sanction WHERE lifted_at IS NULL AND (permanent OR ends_at > now())) AS active_sanctions;
