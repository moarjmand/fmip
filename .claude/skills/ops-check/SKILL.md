---
name: ops-check
description: Production health and release checks for FMIP / Stadiomind - containers, disk, memory, build cache, watchdog conditions, backups, ingestion runs, request budget, HTTP 5xx, site probes, certificate - by a read-only snapshot, compared with the previous one; plus the pre- and post-deploy release checklist. Use for the daily ops check, before and after a deploy, or when the site misbehaves.
---

# Ops check and release (T-1682, D-328)

The method of the `ops-release` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## Daily check

1. `bash .claude/skills/ops-check/ops-check.sh`. It prints a snapshot and saves it under
   `E:/FMIP/ops/reports/ops-release/snapshots/`. A line `OPS-ERROR` is itself a critical
   finding (the server or ssh is unreachable).
2. Compare with the newest snapshot from an earlier UTC day, and for trends (disk, build cache,
   database size) with the snapshots of the last 7 days in the same folder (`grep -h '^/dev/' ...`).
   **On a first run, or when the last snapshot is older than 3 days,** judge levels only and say so;
   rules that need a baseline ("restarted since", "full within 14 days") are reported as not judged.
3. Judge each section against the thresholds below; one finding per problem, in the charter's
   format, appended to `E:/FMIP/ops/findings/<date>.jsonl`; a finding seen before keeps its id.
4. Write `E:/FMIP/ops/reports/ops-release/<date>.md` in Persian: a traffic light (green, amber,
   red) first, then the findings, then what was not checked.

| Section | Amber (major) | Red (critical) |
|---|---|---|
| containers | any not `healthy`, or restarted since the last snapshot | api, web, postgres or caddy not running |
| postgres started | changed since the last snapshot (it should not restart, T-1472) | down |
| disk | above 80%, or full within 14 days at the week's rate | above 90% |
| memory available | below 600 MB | below 250 MB |
| build cache | reclaimable above 15 GB (`rollout.sh` prunes only what is older than 72 h) | disk red because of it |
| site probes | any above 2.5 s, or `/en` above 1.5 s | any non-200 |
| watchdog | any condition `degraded`; `data_quality` failing (unreviewed findings of the platform's own checks: a triage task for the data auditor, not an outage) | any other condition `failing` |
| request budget | above 80% before 18:00 UTC | above 95% |
| backups | last ok `backup` older than 30 h | older than 54 h, or the last run not ok |
| restore drill | older than 35 days | the last drill not ok |
| ingest runs | a failed run that was not interrupted (the snapshot lists them with their error) | a job with every run failed, or `live` failing |
| HTTP 5xx | any route with 10 or more | the home, scores or match route with any |
| certificate | expires within 60 days | within 14 days |

Runs failed with "interrupted: the process running it was stopped" were cut by a deploy or a
restart: count them as info, not as failures. `partial` ingest runs are runs that worked and found disagreements (the standings check, line-ups
not yet announced): count them, do not flag them, unless their share jumps against the last week.

## Practicalities

- Paths: Git Bash uses `/e/FMIP/...`, Node and Windows tools `E:/FMIP/...`; both name the same folder.
- JSON: `python3` is not on this machine; validate a findings line with
  `node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" <<< '<line>'`.
- `ingest_run` columns: `id`, `provider`, `job`, `scope`, `status` (succeeded, partial, failed,
  running), `started_at`, `finished_at`, `items_seen`, `items_written`, `error`, `requests`.
- Docker: `docker system df` and `docker builder du` work over ssh; reading `/var/lib/docker`
  does not (no permission). Do not try `sudo`.
- The final message gives one line per finding; the evidence lives in the findings file and the report.

## Proposals, never actions

The agent proposes; the engineering session acts with the maintainer's approval. Each proposal
names the exact command and what it changes. Never propose restarting Postgres; never propose
`docker compose down`, a volume removal, or anything touching `/opt/fmip/.env`. Typical
proposals: prune build cache (`docker builder prune --filter until=72h`), re-run a failed job,
look at a failed run's error (`ingest_run.error` via a read-only query).

## Release checklist

**Before a deploy** (asked by the engineering session; report PASS or the blocking items):
- the PR's checks are green (`gh pr checks <n>`), and it is merged to `main`;
- a migration in it: it is new (never an edited shipped one), its down section exists, and its
  data changes were tried on a copy;
- a visible change: real-data screenshots were shown to the maintainer and approved
  (bug and data fixes are exempt);
- the rollback: the previous commit is known (`git log --oneline -2` on the server).

**The deploy itself** stays with the engineering session:
`ssh fmip-prod 'cd /opt/fmip && timeout 60 git pull -q --ff-only'`, then `deploy/rollout.sh` in a
tmux session, ending with `ROLLOUT_EXIT=<code>`.

**After a deploy** (the agent runs these, read-only):
- `ROLLOUT_EXIT=0` in the rollout log;
- Postgres's start time unchanged; every container healthy;
- `bash deploy/check-setup.sh` ends with `PASS`;
- the site probes all 200;
- the data auditor's invariants show nothing new (`bash .claude/skills/data-audit/run.sh`).

## Incidents (the golden set)

| Date | What happened | What must catch it |
|---|---|---|
| 2026-10 (T-1472) | a rollout recreated Postgres | postgres started changed |
| 2026-10-25 (#649) | backups near the remote's 10 GB free limit | backups section, remote size in the backup's detail |
| 2026-10-28 | line-ups late because our job asked too late | ingest runs (`lineups`), and the data auditor |
| 2026-10-31 | 25.6 GB of build cache, 23.9 GB reclaimable, on a 75 GB disk at 71% | build cache, disk |
| 2026-10-31 | 3 failed `post_match` runs in 24 h | ingest runs |
