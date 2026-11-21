---
name: score-copies-outside-read-model
description: Stored scores have copies outside the fixtures read model (forecast_evaluation.actual, settlement.actual, form/H2H, catalog lists) - withholding/hiding a score in fixtures does not reach them
metadata:
  type: project
---

Any change that withholds or hides a match's score in the fixtures read model (`scores-store.toRow`,
`FixturesService.matchCentre`) leaves these copies printing it:
- `forecast_evaluation.actual_home/away` -> `forecast-panel.tsx` `Evaluation` (on the match page) and
  `ModelExpected` (`result ?? evaluation?.actual`, news story page); channel post `evaluation?.actual ?? full_time`.
- `settlement.actual` -> member prediction history and prediction share card (`share-card.ts` ~401).
- `model-upset/internal/upset-store.ts` (the day's upset, reads `full_time` itself); the admin POST evaluate
  response is built in the controller, not from `EvaluationService.evaluations`.
- form / head-to-head entries (`match-centre-store`), catalog team/competition/player stores, standings, bracket:
  each queries `fixture_score` itself (grep `fixture_score` in apps/api/src lists ~20 stores).

**Why:** PR #884 (T-1819, D-414, 2026-11-13) nulled conflicting scores in the read model but the match page's
evaluation block still printed `actual` (rev-2026-11-13-01).

**How to apply:** for any "don't show this score" change, grep web for `.actual` and `full_time` and ask what each
copy prints on the same page. Settlement/evaluation reading `fixture_score` directly is what keeps rule 8 safe.
