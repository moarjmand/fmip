---
name: bundle-attribution
description: How to attribute the match centre's first-load JS to modules without a build (Turbopack hoists the live view into one chunk); baseline 17.1 kB gzip live-view chunk
metadata:
  type: reference
---

Turbopack's production build scope-hoists the whole live view (live-match, match-centre-view, match-lineups, formation, score bar, freshness line, cards) into ONE module inside one chunk, so per-module bytes cannot be read from the chunk. Method used 2026-11-13:
- list the route's first-load scripts with `firstLoadScripts(nextDir, '/[locale]/match/[id]')` and `gzipBytes` from `apps/web/scripts/lib/perf-budgets.mjs` (read-only, works on an existing `.next`);
- find the live-view chunk by marker strings (`data-match-sticky`, `lines_unknown`, `absenceReason`);
- apportion by comment-stripped source size of each component/line range (ratio, not exact bytes).
Baseline (build of 2026-11-07, 181.9 kB route total): live-view chunk 17.1 kB gzip / 64.4 kB raw.

**Why:** building writes the tree and takes long; this gives a defensible estimate in minutes.
**How to apply:** for any "what leaves the bundle" question on the match centre; say the build date, and that the engineering task's own `perf:bundle` is the real measure. Related: [[architect-health-baselines]]; D-409 draft in E:/FMIP/ops/reports/architect/2026-11-13-match-live-split.md.
