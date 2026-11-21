---
name: where-things-are
description: Where the business adviser finds its inputs (register, terms pages that block reads, tables, privacy-notice draft) and tool gotchas
metadata:
  type: reference
---

- Register: `E:/FMIP/ops/licences.md` (Persian). Reports: `E:/FMIP/ops/reports/business-adviser/`. Privacy-notice draft package (EN, FA, facts appendix, cover note with TC-1..TC-22): `.../2026-11-02-privacy-notice/`.
- Decision desk: `E:/FMIP/ops/desk/decisions/*.json` (questions), `E:/FMIP/ops/desk/answers/*.json` (maintainer's choices).
- Terms pages: api-football.com/terms and backblaze.com pricing return 403 to WebFetch (two months running); Sportmonks terms are at sportmonks.com/terms-of-service/ (not /terms-and-conditions or /terms-of-use); pricing at sportmonks.com/football-api/plans-pricing/; gnews.io/pricing works.
- Useful tables: `ingest_run` (provider, job, requests), `backup_run` (detail = bytes), `lineup.created_at` vs `fixture.kickoff_at` for line-up lead (lineup rows are upserted, so min(created_at) = first write), `news_source`, `session`, `highlight_feed`, `console_user` (staff, no email).
- Appending findings: a long multi-line heredoc in `bash -c` failed to parse once (2026-11-02, nothing written). Safer: Write the lines to the scratchpad, then `cat file >> findings`.
- UK cookie law sources that WebFetch reads: legislation.gov.uk/uksi/2003/2426/schedule/A1 (PECR exceptions, in force 2026-02-05) and the ICO "what-are-the-exceptions" page under guidance-on-the-use-of-storage-and-access-technologies. Privacy-notice TC numbers used up to TC-26 (TC-23..26 in the 2026-11-13 cookie note).
- The privacy notice is still unpublished (no privacy page under apps/web/src/app, checked 2026-11-13).
- Provider comparison (console tab): `E:/FMIP/ops/providers/comparison.json`, built by a Python script (facts dict + side text JSON, asserts shape and weights = 100); run Python with `-I -X utf8` or Persian print fails on cp1252.
- Every api-football.com / api-sports.io page (pricing, terms, docs, coverage, tutorials) 403s to WebFetch; web.archive.org is blocked too. Sportmonks coverage page is >10 MB (unreadable); per-league features only in MySportmonks Coverage Finder; xG list is public at docs.sportmonks.com/v3/tutorials-and-guides/tutorials/expected/coverage (60 leagues, no Iran).
- Our own coverage per module: `coverage_profile` (season_id, module, state, provider, note) joined to current seasons gives a measured baseline for any provider comparison.
- football-data.org is a dormant provider (last run 2026-10-22); it is in the register since 2026-11-02.
