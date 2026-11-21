---
name: person-merge-review-leads
description: Leads for reviewing person-merge work (T-1863..T-1867, D-446: the merge engine and T-1866's every-id asks) and any trigger flag or archive design - session-level GUCs, FK-less person references, member data in immutable archives
metadata:
  type: reference
---

- **Custom GUC flags** (`fmip.*`): any role can `SET` one at session level without privilege, and it then
  persists across transactions (proved 2026-11-17 on `fmip.keep_updated_at`). `set_config(..., true)` itself
  does not leak (reverted on savepoint rollback and at commit). Ask for the flag to be bound to the transaction id.
- **Person references with no FK** (the FK guard cannot see them): `followed_entity`, `entity_alias`,
  `entity_media`, `article_entity`, `provider_mapping.internal_id` (moved by the merge); `unresolved_entity.resolved_internal_id`,
  `audit_log`/`console_audit.target_*`, `message.card_id`, `notification`/`report`/`moderation_decision.subject_*`
  (kept); `training.fixture_lineup`, `training.absence` (reloaded whole). `key_players` columns are free text.
- **Account deletion** deletes `followed_entity` rows and keeps `user_account` anonymised: any immutable archive
  of follows outlives deletion, and a restore passes the FK (rev-2026-11-17-07).
- Only `set_updated_at` stamps `updated_at` on catalogue/fixture tables; readers use it as a displayed
  "last updated", so keeping it on re-pointed rows is correct for rule 4.
- **T-1866 (every provider id asked) leads**, reconstructed 2026-11-17 from the index line only: a parallel
  review's note here was overwritten by mistake, so its detail is lost. Per-person saves that replace rows
  (coach_spell was still open), `min(external_id)` asks left somewhere, a photo-flip lead. Re-derive from
  `E:/FMIP/ops/reports/code-reviewer/2026-11-17-t-1866-person-all-ids.md` before relying on these.
- **T-1868 (PR #930) leads:** coach_spell has no provider-id column, so a person with several `coach:` ids
  gets a keyed (team, start) replace: dropped/re-dated spells are never pruned (rev-2026-11-17-10). Bio/name
  fetch rows are terminal once `answered_at` is set, so a `name_differs` blocks re-asks after a merge fix
  (rev-2026-11-17-11). Check T-1867 merges + T-1869 photo flip before relying on merged persons' pages.
- Unresolved at the PR #928 review: a tombstone write guard, duplicates in non-unique history tables, and
  substitution incidents pairing both ids (rev-2026-11-17-08/09). Check whether T-1864/T-1867 took them up.
- **T-1869 (PR #940, D-452) photo rule** (round 1, replaced at 66eb8a73 by noteIfEmpty: several ids fill only an empty or 24 h-old not_supplied/failed row, never available/pending; one shared PersonPhotos): `min(external_id)` is *text* order (en_US.utf8: `100 < 7 < 99 < coach:10 < coach:5`;
  every bare id before every `coach:` id). Other ids only `noteFirst` (any existing row counts as held, `not_supplied` too).
  Merge collision keeps the survivor's `entity_media` row whatever its state (`person-merge.sql:458`), so a dead lowest id can
  freeze a silhouette/old photo (rev-2026-11-18-01). Three separate `PersonPhotos` caches (10 min) per process.
- **T-1865a/b (PRs #939/#942, D-453):** tombstone reads = 200 + survivor page + `moved_to`; web 308s (`no-store`). After review
  round 2 news/`?player=`/transfers/provider-seasons resolve via `person_merged_into`, and search maps a tombstone hit to its
  survivor (loser spelling as alias). Still not resolved by id: `/media/*`, follow writes. Player/coach pages are not in Caddy's
  `@guest_html` edge cache (`deploy/Caddyfile:125`). Web never displays search `alias`/`matched_on`.
- `news-dedupe.http.spec.ts` "files another publisher's copy" fails on builders' local DBs but passes in CI Verify (main and
  PR heads, 2026-11-18): environment, not a PR, unless the PR touches `news-store.ts`.
- **T-1864 (PR #941) leads:** `person_duplicate_candidates()` cost is `search_key` (unaccent) over every person: ~3.5 s and
  ~14 MB temp at 111k persons (prod size 2026-11-18); measure with synthetic `generate_series` persons in a rolled-back txn
  on `fmip_t1864`. Fetch jobs ask only `answered_at IS NULL`, so any answered survivor row (`no_profile`, `name_kept` = ids
  disagree) blocked re-asks; fixed at 109c1230 (hourly check via checksToSweep, watchdog sweptAt excludes it; askProfilesAgain).
  A builder's "watchdog concurrent deliveries fails locally" was environment: green for me and in Verify.
- **T-1882 (PR #946):** coach page answers on `coach_spell` alone (`limited`); merge marks survivor's current-season teams
  `team_coach_fetch.failures = 1` (re-ask in ~1 day, one try fewer, loses lineup_change priority, no reader of failures).
  Team answers list current coaches only (fixture), so former teams' re-asks are wasted; suggested `end_date IS NULL`.
