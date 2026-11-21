---
name: shootout-and-news-text-leads
description: Review leads from package 9 - INCIDENT_KEY is shared by in-play rows and shoot-out kick rows; in_shootout is not always set; news text cleaners at ingestion are permanent
metadata:
  type: project
---

- `lib/match.ts` `INCIDENT_KEY` is read by the client timeline's shoot-out kick rows (`IncidentText`), by
  `lib/panel-link.ts` and indirectly by alerts-like surfaces: changing a kind's word there renames shoot-out
  kicks too (rev-2026-11-12-01, "Goal (penalty)" on kicks).
- `in_shootout` is set by the API-Football adapter from the feed's comment and by a one-off migration; other
  adapters always write false. Web code finds kicks with `shootoutStart` (flag first, then score readings).
  Any new reader that skips kicks by the flag alone diverges from the page's own split (rev-2026-11-12-03).
- A text cleaner applied in `packages/ingestion` before storage (e.g. `stripPhotoCredit`) loses text for good;
  probe it with real-looking inputs (truncated "…" endings, "PA Wire/PA Images", "Getty Images for X")
  (rev-2026-11-12-02).
- `after_extra_time` in contracts (`catalog.ts`) means "an extra-time score is held", so a straight-to-penalties
  tie (EFL Cup all rounds but the final, Libertadores) has it false with `penalties` set. Any status text that
  shows pens only under the AET branch drops the shoot-out (rev-2026-11-16-02, social result card).

**Why:** the first three came out of the 2026-11-12 p9-single-fixes review; each looked right in its own file.
**How to apply:** on any change to incident words, kick handling or news text normalisation, grep every
consumer and ask what a shoot-out / an unflagged kick / a stored row gets.
