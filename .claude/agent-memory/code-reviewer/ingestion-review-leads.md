---
name: ingestion-review-leads
description: Leads for reviewing ingestion-job changes - one BullMQ worker at concurrency 1, 30 s run caps for the live tick, alert dispatch at tick end, budget ceilings, list-vs-detail score regress
metadata:
  type: reference
---

- **One worker, concurrency 1** (`ingestion-scheduler.service.ts`): no two ingestion jobs ever run at once, so
  "two jobs write the same match" is not a race there; but anything added to a job delays the next `live`
  tick. The convention is a 30 s cap per run "so the live tick queued behind it waits that long at most";
  check that new work has a deadline. Provider request timeout is 30 s (`REQUEST_TIMEOUT_MS`).
- **Live tick dispatches alerts at its end** (`alerts.dispatch([...raised])`); work added before it delays
  goal pushes (T-1419 was about exactly that in post_match). PR #867 / rev-2026-11-08-01.
- **Budget ceilings (D-183 shares 90/70):** D-417 (2026-11-13) cites a 75,000/day cap (was 70,000 on Ultra, D-197);
  read the current figure from the decision, not this note. Tiers: `live`/`lineups`/`post_match` runs critical,
  fixtures/standings standard, rest bulk (`tierOfRun`); D-382 live statistics and D-417 line-up re-asks are explicit
  `standard`. `post_match` has NO deadline (only a 0.5 s pacer for non-recent asks) and holds the one worker at :00/:30. Budget refusal happens before sending (no request spent) but marks the run
  `partial` and logs `ingest.failed`. Ultra active to 2026-11-21.
- **List vs detail:** `ingestDetail` rewrites score/status/minute via `saveFixture`; alerts derive
  `goal_void` from any score drop, so a detail answer older than the live list would push "goal disallowed"
  then the goal again (rev-2026-11-08-02, unmeasured).
- `fixture_detail_fetch` row excludes a match from the post_match backlog forever; any in-play detail ask marks it.
- **Store write semantics:** `saveIncidents` replaces the whole list (empty answer deletes nothing), so the live
  list owns in-play incidents each tick; `saveStatistics` only upserts (empty answer keeps old rows). Any
  freshness stamp tied to `fixture_detail_fetch.fetched_at` can therefore claim "updated" over frozen figures
  (rev-2026-11-08-04).
- **Freshness reaching open pages:** `fixture_detail_fetch` has no NOTIFY trigger; a page gets a new snapshot
  only via fixture/score/incident/lineup/fixture_stat triggers or `noteLiveAnswered` (clock-stopped matches).
- **Grounds (D-229, D-451/T-1875):** only api-football implements `getSeasonTeams`/`getVenue`; venue rows are adopted
  from a fixture payload's city (`catalog.mjs --adopt-venues`), and from T-1875 the per-ground answer replaces the city
  (`venue_detail_fetch.city` records it). The seed's venue upsert never runs on production (DEMONSTRATION_DATA off).
- **`live=all` drops finished matches** (api-football adapter), so full time is written by the T-830
  left-the-list detail ask, not by the list.
