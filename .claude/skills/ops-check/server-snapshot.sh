#!/usr/bin/env bash
# Runs ON the production server, fed by ops-check.sh over ssh (T-1682, D-328).
# Read-only: it lists, measures and queries; it never restarts, prunes, deploys or writes.
# Prints no secret: no .env, no key file, no connection string, no address of a person.

cd /opt/fmip || exit 2
psql_ro() {
  docker compose exec -T postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qtA -F " | "'
}

echo "== now"; date -u +%FT%TZ
echo "== deployed commit"; git log --oneline -1
echo "== containers"; docker compose ps --format '{{.Service}} | {{.State}} | {{.Status}}'
echo "== postgres started"; docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q postgres)"
echo "== disk"; df -h / | tail -1
echo "== memory MB (total used free shared cache available)"; free -m | awk 'NR==2{print $2,$3,$4,$5,$6,$7}'
echo "== load"; cut -d' ' -f1-3 /proc/loadavg
echo "== docker disk"; docker system df --format '{{.Type}} | {{.Size}} | reclaimable {{.Reclaimable}}'
echo "== timers (next | left | last | passed | unit | activates)"; systemctl list-timers --all --no-pager 2>/dev/null | grep -i fmip
echo "== origin certificate expiry"
for f in deploy/certs/*; do
  end="$(openssl x509 -enddate -noout -in "$f" 2>/dev/null)" && echo "$(basename "$f") | $end"
done
echo "== site probes (code seconds)"
for path in /health /en /fa /en/scores /en/news /en/model-accuracy; do
  printf '%s | ' "$path"
  curl -s -o /dev/null -m 20 -w '%{http_code} %{time_total}\n' "https://traveltohormuz.ir$path" || echo "no answer"
done
psql_ro <<'SQL'
\echo == watchdog conditions not ok (key | level | since | observed unit | note)
SELECT key, level, to_char(since, 'MM-DD HH24:MI'), coalesce(observed::text, '') || ' ' || unit, note
  FROM watchdog_condition WHERE level <> 'ok' ORDER BY level DESC, key;
\echo == watchdog: request budget and live feed
SELECT key, level, note FROM watchdog_condition WHERE key IN ('request_budget', 'live_feed', 'model_service');
\echo == site e-mail, last 7 days (mail | sent | failed | absent | last sent | last failed | state; FAILING = failed and nothing sent after it)
SELECT m.what, coalesce(o.sent, 0), coalesce(o.failed, 0), coalesce(o.absent, 0),
       coalesce(to_char(o.last_sent, 'MM-DD HH24:MI'), '-'), coalesce(to_char(o.last_failed, 'MM-DD HH24:MI'), '-'),
       CASE WHEN o.last_failed IS NOT NULL AND (o.last_sent IS NULL OR o.last_sent < o.last_failed)
            THEN 'FAILING'
            WHEN coalesce(o.sent, 0) + coalesce(o.failed, 0) + coalesce(o.absent, 0) = 0 THEN 'no attempt'
            ELSE 'ok' END
  FROM (VALUES ('notification'), ('sign-up/verify'), ('reset')) m (what)
  LEFT JOIN (
    SELECT 'notification' AS what, count(*) FILTER (WHERE email = 'sent') AS sent,
           count(*) FILTER (WHERE email = 'failed') AS failed, count(*) FILTER (WHERE email = 'absent') AS absent,
           max(carried_at) FILTER (WHERE email = 'sent') AS last_sent, max(carried_at) FILTER (WHERE email = 'failed') AS last_failed
      FROM notification_delivery WHERE carried_at > now() - interval '7 days'
    UNION ALL
    -- Read through to_jsonb so the line works before migration 1765901896700 too (it reads as no attempt).
    SELECT CASE kind WHEN 'verify_email' THEN 'sign-up/verify' ELSE 'reset' END,
           count(*) FILTER (WHERE outcome = 'sent'), count(*) FILTER (WHERE outcome = 'failed'),
           count(*) FILTER (WHERE outcome = 'absent'),
           max(mailed_at) FILTER (WHERE outcome = 'sent'), max(mailed_at) FILTER (WHERE outcome = 'failed')
      FROM (SELECT kind, to_jsonb(t) ->> 'mail_outcome' AS outcome, (to_jsonb(t) ->> 'mailed_at')::timestamptz AS mailed_at
              FROM email_token t WHERE created_at > now() - interval '8 days') e
     WHERE mailed_at > now() - interval '7 days' GROUP BY kind
  ) o ON o.what = m.what
 ORDER BY 1;
\echo == watchdog: delivery (key | level | since | note)
SELECT key, level, to_char(since, 'MM-DD HH24:MI'), note FROM watchdog_condition WHERE key LIKE 'delivery:%' ORDER BY key;
\echo == backups (kind | last ok | last run ok? | last detail)
SELECT kind, to_char(max(finished_at) FILTER (WHERE ok), 'MM-DD HH24:MI'),
       (array_agg(ok ORDER BY started_at DESC))[1],
       left((array_agg(detail ORDER BY started_at DESC))[1], 160)
  FROM backup_run WHERE started_at > now() - interval '40 days' GROUP BY kind ORDER BY kind;
\echo == ingest runs, last 24 h (job | runs | failed | of which interrupted by a deploy or restart | partial | requests)
SELECT job, count(*), count(*) FILTER (WHERE status = 'failed'),
       count(*) FILTER (WHERE status = 'failed' AND error ILIKE 'interrupted%'),
       count(*) FILTER (WHERE status = 'partial'), coalesce(sum(requests), 0)
  FROM ingest_run WHERE started_at > now() - interval '24 hours' GROUP BY job ORDER BY 3 DESC, 1;
\echo == failed runs, last 24 h, not interrupted (job | started | error)
SELECT job, to_char(started_at, 'MM-DD HH24:MI'), left(error, 200)
  FROM ingest_run WHERE started_at > now() - interval '24 hours' AND status = 'failed'
   AND coalesce(error, '') NOT ILIKE 'interrupted%' ORDER BY started_at DESC LIMIT 8;
\echo == partial share, last 24 h against the 7 days before (job | 24 h % | 7 d %)
SELECT job,
       round(100.0 * count(*) FILTER (WHERE status = 'partial' AND started_at > now() - interval '24 hours')
             / nullif(count(*) FILTER (WHERE started_at > now() - interval '24 hours'), 0)),
       round(100.0 * count(*) FILTER (WHERE status = 'partial' AND started_at <= now() - interval '24 hours')
             / nullif(count(*) FILTER (WHERE started_at <= now() - interval '24 hours'), 0))
  FROM ingest_run WHERE started_at > now() - interval '8 days'
 GROUP BY job HAVING count(*) FILTER (WHERE status = 'partial') > 0 ORDER BY 1;
\echo == HTTP 5xx, last 24 h (route | status | count; "none" when there were none)
SELECT coalesce(route, 'none'), coalesce(status::text, ''), coalesce(sum(count)::text, '')
  FROM (SELECT 1) one LEFT JOIN http_error_count
    ON hour > now() - interval '24 hours' AND status >= 500
 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8;
\echo == failed queue jobs, last 24 h (queue | job | kind | count | last job id; job "*" = the total for the queue)
SELECT coalesce(queue, 'none'), coalesce(job, ''), coalesce(kind, ''), coalesce(sum(count)::text, ''), coalesce(max(last_job_id), '')
  FROM (SELECT 1) one LEFT JOIN job_failure_count ON hour > now() - interval '24 hours'
 GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 8;
\echo == database size
SELECT pg_size_pretty(pg_database_size(current_database()));
SQL
echo "== end"
