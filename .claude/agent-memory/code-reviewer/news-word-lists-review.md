---
name: news-word-lists-review
description: How to review changes to the news other-sport word lists (other-code.ts, football-only.ts): the GNews write path, Persian football metaphors, local DB has no news rows
metadata:
  type: project
---

`otherCodeOf` (packages/ingestion/src/news/other-code.ts) is also the GNews write-path filter
(apps/api/src/modules/news/gnews-ingestion.service.ts, skips writing when non-null). A new marker
there is irreversible for GNews items, unlike the read-path rules (D-290, D-426, D-429).

**Why:** PR #901 (T-1841, 2026-11-16) added 'slalom', 'high jump', 'grandmasters?' which drop
English football stories at ingest; and bare «شطرنج»/«کبدی» which hide filed Persian football
(chess metaphor, «بیماری کبدی», Croatia's nickname «شطرنجی‌پوشان»).

**How to apply:** for any marker change, probe football headlines that use the word as a metaphor,
in English and Persian, through both `otherCodeOf` and `notFootballOf` (build ingestion dist, import
it from a scratchpad .mjs). The local fmip-postgres-1 DB has 0 article_version rows, so frequency
cannot be measured locally; http specs seed their own rows.

Persian markers in other-code.ts have no word boundary (substring match) and `[‌ ]?` accepts a
space, so «شطرنج باز» also matches «شطرنج بازی کردند». Check both the boundary-less other-code
form and football-only.ts's \p{L}-bounded headline form. PORTUGUESE_OTHER_SPORT runs on Tehran
Times' English headlines too. Fixed in 9801e093; two minor leftovers noted 2026-11-16.

D-449 (PR #934, 2026-11-17) added `notFootballPageOf(url, headline)` (URL path directories, step 0 of
`notFootballOf`, also the GNews write skip). Leads: `VIDEO_SECTIONS` exempts `tv` at any depth, so
independent.co.uk/arts-entertainment/tv/ passes (noted minor); MIAA = Manila airport too. Filters run in JS
on fetched rows (fetchSize = limit*2+10, feed/search LIMIT 100), so no SQL cost question arises.
