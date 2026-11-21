---
name: recalibration-d450
description: D-450 draft (2026-11-17, uncommitted) - recalibration of 0.7.0 for finding mod-2026-10-31-03; its pre-set constants, windows and one look at 1,000 paired matches; the goal-level and draw-stretch baselines behind it
metadata:
  type: project
---

D-450 is a DRAFT, written 2026-11-17 and not committed. It waits for the maintainer.
- Path: E:/FMIP/ops/reports/model-scientist/2026-11-17-D-450-recalibration-draft.md
- The recommendation is fixed before any run, so never change it after a screen or a look:
  - the map is `p_k' ∝ p_k^T · exp(β_k)`, with only T and β_draw free;
  - it runs at HALF strength, `T* = 1 + (T̂−1)/2`, `β* = β̂/2`;
  - the development window is matches kicked off 2026-10-10..11-17 (1,035 matches; 0.7.0's forecast where it made one, else 0.6.0's);
  - an in-window screen comes first: fit on the first 2/3, score the last 1/3; it needs T̂>1 and β̂_draw<0;
  - the candidate is dixon-coles-elo@0.9.0 (0.8.0 is not reused);
  - the evaluation is shadow matches kicked off from 2026-11-18;
  - there is ONE D-139 look at 1,000 paired matches, around the 12-28 or 01-04 watch.
- Ledger: when the look comes, record it in `judgements` with rule D-139 and condition paired_improvement. Before 1,000, give the count only.

Baselines measured 2026-11-17 (match-counted):
- The live forecasts said 2.87 goals a match. 3.10 were scored (SE 0.07).
- Main-11 2026/27 averages 3.06 goals a match, against 2.75-2.86 in the three seasons before.
- Scaling xG by 1.08 explains only about 1.2 of the 4.9-point draw deficit.
- Main-11 draws: 25.2% before 10-10 (638 matches), 19.2% since (521). History: 25.8%.
- Favourite: said 51.6, seen 58.4 (n=673). The pattern is under-confidence, not a side bias:
  - home 40-50% is calibrated;
  - away 30-40% goes the other way from away 40-50%.

**Why:** the next watch must not re-fit or re-choose on these windows. On a failure, the follow-up is a faster division goal level (a D-139 term), written as its own draft.

**How to apply:** at each watch, compare the draw and favourite bands on matches from 2026-11-18 with the figures above. That is a fresh measurement, not a test of D-450. Related: [[watch-baselines]].
