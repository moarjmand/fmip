---
name: data-quality-review-leads
description: Data-quality check and watchdog-count facts for reviews - lineup_not_eleven means other than eleven (over too), line-up writes replace, coverage_profile one row per season+module
metadata:
  type: reference
---

- `lineup_not_eleven` (`data-quality/internal/checks.ts` lineupNotEleven, D-097) fires on **other than** eleven starters,
  over eleven included; a finding row stores no starters count (only `detail` text and `subject_key` `<fixture>:<side>`).
  Any rule worded "short line-up" that keys on the check kind alone is wider than its words (PR #932, rev-2026-11-17-12).
- Line-up writes replace the side's set with the feed's list (`ingestion/internal/ingest-store.ts` DELETE ... NOT ANY),
  so an over-eleven line-up is the feed's own answer, never parts arriving.
- `coverage_profile` is `UNIQUE (season_id, module)`; no row is documented as "treat as not_supplied".
- The watchdog's only production caller of `DataQualityService.liveContradictions` is `watchdog/internal/probes.ts`
  (`liveContradictions(now)`); test-only optional params are safe when that call passes none.
- A launching agent may cite a "note in the PR" that is not there: check body, comments, reviews and the commit
  (`gh pr view <n> --json body,comments,reviews`) and say so ([[review-toolbox]]).
