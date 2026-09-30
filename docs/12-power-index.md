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
**95%**; competition context is still not modelled (measured by the backtest
and not adopted, T-1123, D-146).

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

**Validated on our own line-ups (T-924, D-122).** The training data holds
results, not line-ups, so the backtest below pairs each of its matches with the
fixture of our records that is the same match (the same two catalogue clubs, a
day apart at most; never by name) and measures both components with the live
functions from what our records held before the kick-off. The XI that started
stands for the announced one. A match that is not a fixture of our records has
neither, and their weight is redistributed. `without-lineup`, `lineup-heavy`
(35%), `without-stability` and `stability-heavy` (15%) ask the question against
the published arithmetic at the usual bar; until the server's run is recorded
in D-122, the blueprint's 20% and 5% stand as published.

---

## Validating the weights (T-113)

The blueprint says the calculation "should use historical performance to
validate or adjust these weights". This is that, arranged so it can only give an
honest answer.

**The method.** Walk a division's stored history in order. For each match, measure both
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

**Rest is scored with the others (T-1111, D-142).** Each side's rest and
congestion are read from the stored schedule: every `training.match` row, clubs
keyed through `training.team_alias` (a bridged club by its catalogue id, else
by its name within its division, never across divisions by name), as the
model's rest input reads it (D-141). Only days strictly before the match count,
and a club with no earlier stored match has no rest value, so its weight is
redistributed as the live index does. The limits are stated with each run:
football-data holds league matches only, so for a club not bridged to our
records a midweek cup or European match is invisible, and a domestic cup we do
not carry is invisible to every club. Two candidates ask the component's own
question: `without-rest` (the blueprint's weights with rest at 0) and
`rest-heavy` (rest at 15%). The component stays `limited` in the live index,
because travel is not modelled until Phase 11's N-1 (ground coordinates) is
answered.

**Competition context is measured, and not adopted (T-1123, D-146).** The
backtest reads a side's stake as a position: its *open places*, the number of
rivals it can still finish level with or on either side of, from the season's
table (results strictly before the match's day, three points a win) and the
season's stored fixture list, read for sides and days only as the
league-stakes input reads it (D-143). A locked side has none. The component is
that count's mid-rank percentile among the division's sides, so a locked side
is lowest and every side sits at 0.5 until the table separates them. A season
whose list is not a complete double round robin (a split, play-offs in the
list, a season still being loaded) gives no stake and the weight is
redistributed. `blueprint` in the table is the published arithmetic with
context unmeasured; `with-context` measures it at the blueprint's 5% and
`context-heavy` at 15%. On ten divisions measuring it changed held-out log loss
by between -0.0036 and +0.0007 and cleared the 0.01 bar nowhere, so
`power-index@1.1.0` stands and the live component stays `not_supplied`. A cup
tie's state (D-144) is not scored: the training store holds no cup ties, and a
tie has no population to rank a side against.

**What a few seasons cannot tell us.** A division's three seasons are still a
small sample, and the verdict wording is deliberately conservative about it.

### To run it

```bash
pnpm --filter @fmip/api build
node apps/api/scripts/power-index-backtest.mjs --division E0
```

On the server, from the deployed api image (it holds the built code; the script
is mounted in), writing the report to a directory instead of the docs, and
scoring only the seasons our line-ups cover:

```bash
docker compose run --rm -T --no-deps -v /opt/fmip/apps/api/scripts:/app/scripts:ro   -v $HOME/reports/power-index:/tmp/reports api   node scripts/power-index-backtest.mjs --division E0 --from 2023-07-01 --out /tmp/reports
```

It needs a loaded training store, which needs the network, so it is run by hand
rather than in continuous integration. Each run replaces the table below and
keeps the full result under `apps/api/backtest/`.

<!-- backtest:start -->
### Results — E0, 2023-08-11 to 2026-09-20

Written by `apps/api/scripts/power-index-backtest.mjs` on 2026-09-29T14:35:31.465Z; do not edit by hand.

1123 matches measured after a 60-match warm-up, split 561 to fit and 562 to score. The season's own outcome frequencies score **1.0837** — a weight set that does not beat that has found nothing.

Rest and congestion from the stored schedule: both sides' rest was read for 1123 of 1130 matches; 0 of the division's clubs are bridged to our records (their cup matches count); the others' schedule is their league matches alone. Travel is not modelled. Removing the rest component changes held-out log-loss by -0.0009 (positive: rest helped).

Competition context (T-1123) from the season's table and stored fixture list: both sides' stake was read for 1080 of 1130 matches (19 with a locked side); complete seasons: 2023/24, 2024/25, 2025/26; not read (the list is not a complete double round robin): 2026/27. `blueprint` is the published arithmetic, context unmeasured. Measuring it at 5% (`with-context`) changes held-out log-loss by +0.0007 (positive: context helped).

| Weights | Held-out log-loss | Fitted log-loss | Higher index won |
|---|---|---|---|
| **strength-heavy** | 1.0279 | 0.9835 | 65.3% |
| without-rest | 1.0281 | 0.9841 | 65.3% |
| with-context | 1.0284 | 0.9846 | 65.9% |
| blueprint | 1.0290 | 0.9854 | 66.0% |
| context-heavy | 1.0301 | 0.9856 | 65.9% |
| venue-heavy | 1.0302 | 0.9864 | 65.3% |
| rest-heavy | 1.0313 | 0.9885 | 65.3% |
| equal | 1.0354 | 0.9943 | 64.3% |
| form-heavy | 1.0357 | 0.9939 | 62.9% |

**Verdict.** Keep the published weights. The best alternative (strength-heavy) improves held-out log-loss by 0.0011, below the 0.01 that would be a finding rather than noise at this sample size.
<!-- backtest:end -->
