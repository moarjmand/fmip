---
name: baselines
description: Monthly comparison figures for the business adviser - API-Football usage, backup size, member counts, news sources, line-up lead time (as of 2026-11-02)
metadata:
  type: project
---

Baselines from the 2026-11-02 monthly review (compare next month against these):

- API-Football (Ultra, 75,000/day; our cap 70,000): 7-day avg 26,396/day (35%), weekday ~16k, Saturday peak 42,899 (57%) on 2026-10-31. Top jobs: people_names ~13.8k, post_match ~9.8k a day. Source: `ingest_run` sum(requests) per UTC day, provider `api_football`.
- Highlightly requests are NOT in `ingest_run`; use `highlight_feed` rows (199 clips in 7 days) as the usage proxy.
- Backup off-provider copy: 1,019,693,846 bytes on 2026-11-02 (0.52 GB on 10-25), growth ~20 MB/day after the backfill. Source: `backup_run.detail`.
- Members: 3 active, 1 deleted, 9 sessions (all expired/revoked, oldest 2026-09-25, never purged), 0 push, 0 messages, 9 predictions.
- News: 11 direct feeds (4 with CC BY 4.0 images), 1 GNews row + 313 GNews publishers; no source added after 2026-10-30.
- Line-up lead (API-Football): median 27 min before kick-off, 0 of 318 earlier than 30 min (5 days to 2026-11-02). Cups (Turkiye Kupasi, KNVB Beker, ACL Two) missing or after full time.

**Why:** the skill asks for trend and next threshold, which needs last month's figure.
**How to apply:** rerun the same queries (scratchpad SQL shape in [[where-things-are]]) and state the delta.
