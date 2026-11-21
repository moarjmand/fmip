---
name: architect-health-baselines
description: Monthly health baselines (module fan-out, big files, migrations, crossings) and the boundary-check.sh fan-out miscount to correct for
metadata:
  type: project
---

Baselines as of 2026-11-02 (main 503fc6fa):
- Boundary crossings: 1 known (conversations -> fixtures/internal/change-feed, TD-01). Report as open, not new.
- Module fan-out, resolved, non-spec: watchdog 11, reputation 9, ingestion 7, news/moments 6. 128 module edges, 0 cycles in production code.
- Files over 1,500 lines: match-centre-view.tsx 1716, ingestion-jobs.service.ts 1713, ingestion/internal/ingest-store.ts 1665.
- Migrations: 168, none share a timestamp. TODO without task id: 0.

**Why:** boundary-check.sh's fan-out section counts spec files (grep -h drops names, so its spec filter never applies) and misses `../../` imports from internal/ — it printed watchdog 8 / ingestion 9. Counting with specs also shows ~21 fake module cycles. Reported as arc-2026-11-02-01 (TD-03 b).
**How to apply:** until TD-03 is paid, recount fan-out with `grep -rnoE "from ['\"](\.\./)+[a-z0-9-]+/"` with filenames, dropping .spec/.test and keeping targets that are module folders.

Debt register E:/FMIP/ops/tech-debt.md uses TD-nn ids (TD-01..TD-15 so far); never renumber. The 2026-10-31 run was a trial; 2026-11-02 is the first monthly. [[architect-decisions]]
