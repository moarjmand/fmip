# The Power Index

**What it is.** The 0–100 number beside each team in a match centre (blueprint
6.1), and the components it was built from. It is an *explanation* of team
strength, not a forecast: the probabilities are the model's job (6.2), and the
footer of the panel says so, because 0–100 sitting beside three percentages
invites exactly the wrong reading.

**Where the pieces live.**

| Piece | File |
|---|---|
| The published weights and labels | `packages/contracts/src/power-index.ts` |
| The combination rule | `apps/api/src/modules/forecast/internal/power-index.ts` |
| Measuring the components | `.../internal/power-index-measure.ts` |
| The SQL | `.../internal/power-index-store.ts` |
| Computing and storing | `.../power-index.service.ts` |
| The endpoint | `.../power-index.controller.ts` |
| The panel | `apps/web/src/components/power-index-panel.tsx` |
| This validation | `.../internal/power-index-backtest.ts`, `apps/api/scripts/power-index-backtest.mjs` |

---

## The two rules it is built on

**A component is a position in a distribution, never a bag of points.** The
blueprint is explicit that the index is "not created by adding arbitrary fixed
points", so 0.8 means "ahead of eight in ten of this competition" — a claim that
can be checked against results, which is what the backtest below does.

**A component nothing measured is absent, and its weight is redistributed.**
Substituting a neutral 0.5 would be inventing a value (rule 3), and it would
drag every index towards the middle by an amount nobody could see. Instead the
weight goes to the components that did arrive, and the share of the formula's
weight actually covered is published beside the number as `completeness`. On the
free data of D-049 that was **70%**: line-up quality, managerial stability and
competition context were not measurable, and the panel says which. With the paid
feed's line-ups and player ratings (T-101) the first two are measured from our
own match records (T-112, below), so a match of a covered league reaches
**95%**; competition context is still not modelled.

## Line-up quality and stability (T-112, D-081)

Both are measured from our own tables, not the training store, and both are
positions among the teams of the same season, measured from only what was
recorded before the kick-off.

- **Line-up quality (20%).** A player's rating is the mean of the provider's
  0-10 match ratings this season in matches they played at least 20 minutes of.
  The team's XI is the announced one when the line-up is confirmed, otherwise
  its last XI less the players reported out (T-103). Its strength is the mean
  rating of its rated starters, measurable when at least seven are rated; the
  component is the share of the other teams' latest XIs below it, ties at half,
  with at least five teams to rank against. `available` only for a confirmed XI
  with all eleven rated; an expected XI is `limited` and says so.
- **Managerial and team stability (5%).** Two readings, each placed among the
  season's teams and then averaged: the share of the team's matches this season
  led by its current coach, and the share of starters kept from one match to the
  next over its last three pairs. Either alone is used, as `limited`, when the
  other cannot be read.

Neither can be validated by the backtest below: the training data holds results,
not line-ups or ratings, so the blueprint's 20% and 5% stand as published, and
this section says so rather than claiming a fit it never had.

---

## Validating the weights (T-113)

The blueprint says the calculation "should use historical performance to
validate or adjust these weights". This is that, arranged so it can only give an
honest answer.

**The method.** Walk a division's season in order. For each match, measure both
teams from **only the matches played before that day**, combine under each
candidate weight set, and record the index gap against what happened. Fit an
ordered logistic — one slope, two thresholds — on the first half of those
observations, and score the weights by log-loss on the second half, which the
fit never saw.

**Why log-loss, and against what.** The index is not a probability, so it cannot
be scored as one directly; turning the gap into probabilities and scoring those
is the honest way to ask whether the gap carries information. Log-loss punishes
confident mistakes, which is what an overfitted weight set produces. The
baseline is the season's own outcome frequencies: a weight set that does not
beat *that* has found nothing at all, however good its table position looks.

**Why the candidates are few.** A grid fine enough to overfit 380 matches would
find a winner every time, and the winner would be noise. Each candidate is a
position somebody could argue for out loud: the blueprint's own weights,
strength-heavy, form-heavy, venue-heavy, and equal.

**The bar for changing anything.** A candidate has to beat the blueprint's
held-out log-loss by more than **0.01** before it is treated as a finding.
Below that, the published weights stay and the run says so. Replacing them is a
new formula version (`power-index@x.y.z`), never an edit: two stored indexes must
never be comparable across different arithmetic.

**What one season cannot tell us.** Rest is excluded from the backtest — the
training store holds results, not schedules — so this validates the three
components that history supports and is silent on the fourth. And a single
division for a single season is a small sample; the verdict wording is
deliberately conservative about it.

### To run it

```bash
pnpm --filter @fmip/api build
node apps/api/scripts/power-index-backtest.mjs --division E0
```

It needs a loaded training store, which needs the network, so it is run by hand
rather than in continuous integration. Each run replaces the table below and
keeps the full result under `apps/api/backtest/`.

<!-- backtest:start -->
### Results — E0, 2024-08-15 to 2025-05-24

Written by `apps/api/scripts/power-index-backtest.mjs` on 2026-09-13T04:20:19.462Z; do not edit by hand.

320 matches measured after a 60-match warm-up, split 160 to fit and 160 to score. The season's own outcome frequencies score **1.0667** — a weight set that does not beat that has found nothing.

| Weights | Held-out log-loss | Fitted log-loss | Higher index won |
|---|---|---|---|
| **equal** | 1.0064 | 1.0234 | 63.8% |
| blueprint | 1.0064 | 1.0228 | 65.4% |
| form-heavy | 1.0074 | 1.0266 | 63.8% |
| strength-heavy | 1.0076 | 1.0221 | 63.8% |
| venue-heavy | 1.0077 | 1.0229 | 64.6% |

**Verdict.** Keep the published weights. The best alternative (equal) improves held-out log-loss by 0.0000, below the 0.01 that would be a finding rather than noise at this sample size.
<!-- backtest:end -->
