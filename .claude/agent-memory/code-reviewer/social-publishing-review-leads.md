---
name: social-publishing-review-leads
description: Leads for reviewing the social-publishing module (D-427, T-1834..T-1838): freshness gate semantics, verdict called-vs-correct, edit validation, own goals, #894 overlap
metadata:
  type: project
---

Leads found reviewing PR #893 and #895 (2026-11-15/16); check whether they were fixed before re-raising.

- **Fixture `last_updated_at` is the last change, not the last read.** Scores list computes
  `GREATEST(fixture/score/incident updated_at)`; ingestion updates `fixture` only `IS DISTINCT FROM`.
  Any gate saying "read within N hours" on it fails for unchanged matches (forecast posts mostly never
  drafted/approved). Fixed in #895 round 2: forecast freshness = IngestRunsService.lastGlobalSuccess('fixtures') (succeeded, no scope) within 6 h; production had 9/70 fresh by updated_at.
- **Verdict `called` vs stored `correct`:** `correct` = actual outcome's raw prob equals the raw max
  (`forecast/internal/scoring.ts`); anything recomputing the pick from rounded percents can contradict it
  on near-ties (rev-2026-11-16-04, fixed: calledFrom).
- **Edits:** `PostgresSocialPostStore.edit` now caption-only (checkCaptionEdit), but the header line and digit-free
  opinions ("My pick: X") still pass; re-check when T-1836 (console tab) lands.
- **Own goals:** the site and alerts list no scorers when an own goal exists (side uncertain from feed);
  social `goalsOf` diverged (minor).
- **Local DB has no `social_*` tables** (schema behind): confirm the DB spec ran with
  `gh run view <run> --log --job <id> | grep social-` (the `gh api .../logs` call needs `--allow-escape-sequences`).

- **PR #896 (T-1837, round 1, 2026-11-16):** blockers were the Instagram cap (rules 2,200 code points vs Buffer 2,196
  UTF-16 with newline = 2; rev-2026-11-16-07) and person-approved posts published after turning sensitive at publishing
  (`checkAtPublishing` only withdraws automation approvals; rev-2026-11-16-08, decide). Verified sound: secret box, claim
  race, unknown handling, 429 pause, app+DB kill switch. Round 2 (3bf86699) fixed both: APPROVE. Open lead
  rev-2026-11-16-09: pre-send refusals reset the clean run. Fixed by PR #897 (T-1839, APPROVE): `SocialRefusal.beforeSend`,
  `finish(... notSent)` keeps the run; its job-approved "stopped" back-to-person branch has no DB spec yet.
- **When `git fetch` resets** (this PC): `gh` still works; `gh api repos/moarjmand/fmip/compare/main...<sha>` plus
  comparing commit tree SHAs proves the base; `gh api .../tarball/<sha>` gives the head to run (junction node_modules,
  vitest config in the extracted apps/api aliasing contracts to its `src`).
- **PR #898 (T-1836, 2026-11-16, APPROVE with notes, Verify pending at verdict):** owner checks are in the controller (403 before kind/body) plus the DB trigger for levels; caption names matched with `iu` lock lines holding common words when a team code is one (Newcastle NEW: "A new week" -> figures_changed); opinions without listed words ("I fancy the hosts") still pass; key-set audit reason is a fixed sentence; `setOwner` has no DB spec; key rejection is per-process memory; typed `UnauthorizedError` stays a post refusal (judged OK vs D-427 wording).

**Why:** these are reading-looks-right traps specific to this module. **How to apply:** open them first
when a social-publishing PR (T-1835/T-1836/T-1837) comes for review. Related: [[review-toolbox]],
[[forecast-placeholder-versions]].
