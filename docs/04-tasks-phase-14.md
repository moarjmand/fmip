# Phase 14 — Model factors

A request from a teammate, forwarded by the maintainer on 2026-10-29: study, test and add
eight factors to the match forecast (coach performance and stability, home advantage by
team, recent form and its quality, head-to-head, key players' injuries and suspensions,
fixture congestion and rotation, table position and motivation, the club's trend over
seasons), plus league strength, tactical matchups, line-ups and the draw. Each factor is
to be weighed by testing against past results, the current model kept as the benchmark
until the results are approved, and the outcome reported: each factor's effect on the
percentages, on accuracy, Brier, log loss and calibration, which factors help, how each
weight was set, and matches the new model forecasts better and worse.

The maintainer's answers the same day (D-303): the shadow route (a candidate beside the
published version, never shown, replaced only on their approval); past seasons' injuries
fetched for training; the domestic cups we do not carry added; phases A and B started at
once.

**Where it starts.** Seven of the eight were built and judged in Phase 11 (D-141 to
D-150, D-171) and none passed, but on a store whose eleven main football-data divisions
begin in 2023/24, and with formulations the data now lets us improve: rest read league
matches alone, the line-up term read player ratings that miss rotation and are not
adjusted for the league. The diagnosis behind each task is in D-303.

**How each factor is judged.** D-139's bar, unchanged: lower log loss with the 95%
paired-bootstrap interval below zero, calibration not demonstrably worse, worse in at most
a third of the divisions, at least 300 matches where it applies. Formulations are written
before a run and not tuned on it. Development window: 2024/25. Holdout: 2025/26 and
2026/27 to date, untouched until the combined candidate's final run (T-1660). Runs read
the lab store (T-1646), never the published model's store.

## A. Data

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1646 | The lab store: a `fmip_lab` database on the server with a copy of the `training` schema (foreign keys to `public` dropped), the eleven main football-data divisions loaded from 2020/21 into it alone; `scripts/model-lab-setup.sh`; the procedure in `docs/15-model.md` | — | `fmip_lab` holds E0 … SC0 from 2020/21 (E0 2,350 matches); the production store unchanged (E0 from 2023/24); the published version's own Elo unmoved |
| `[x]` T-1647 | Team match statistics in the training store: shots, shots on target and expected goals per side from our records (`fixture_stat`, API-Football), keyed as `training.match` | T-1646 | Coverage per division and season reported; xG wherever `fixture_stat` holds it (54–68% of finished matches from 2023). *Done (D-305):* `training.fixture_stat`, one row per finished match with a figure, every competition, keyed by our fixture and team ids and reached from `training.match` through `training.team_alias` and the date; `load records-stats [--into fmip_lab]`; coverage by `python -m fmip_model.training.fixture_detail coverage`, run on production after the deploy |
| `[x]` T-1648 | Line-ups and minutes in the training store: each side's starters and every player's minutes per match from our records, for the regulars index (T-1655) | T-1646 | Coverage per division and season reported; a match without a stored line-up is a gap, never a default. *Done (D-305):* `training.fixture_lineup`, one row per player named on a side's line-up (started, minutes or NULL, position bucket), every competition; a side without a line-up has no rows; `load records-lineups [--into fmip_lab]`; coverage by the same command |
| `[ ]` T-1649 | The domestic cups we do not carry, kept out of the published version's training store (`competition.model_training`, D-304) and added to the catalogue with their past seasons: EFL Cup, KNVB Cup, Taça de Portugal, Turkish Cup, Scottish Cup and League Cup, Belgian Cup, Hazfi Cup, Copa Sudamericana, AFC Champions League Two | — | Each cup's fixtures from 2020/21 stored; the rest input sees their midweek matches |
| `[x]` T-1650 | Past seasons' absences for training: measure how far back the feed's season injury list goes, then backfill it into a training-only table (an exception to D-166's scope, recorded in D-303) | — | Depth per competition reported; rows keyed by person and fixture; nothing shown on the site |

## B. The Phase 11 inputs again, on the longer store

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1651 | Re-run `rest`, `new_coach`, `head_to_head`, `team_home_advantage`, `league_stakes`, `league_stakes_zones`, `second_leg` and the `null` control on the lab store, window 2024/25, history from 2020/21; rest again once T-1649's cups are stored | T-1646 | A table per input in D-303's follow-up entry, each verdict with its interval; the control fails |

## C. New inputs

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1652 | Strength from goals and expected goals: the fit's target blends goals with xG, the blend chosen by the walk-forward | T-1647 | Judged by D-139 against the candidate |
| `[ ]` T-1653 | Time decay: the cross-league fit's half-life (about 3.8 years today) and the untuned divisions'. The cross-league half-life's sweep is built with T-1654 (D-309: `cross_league.xi` 0.00025, 0.001, 0.002, 0.004 beside 0.0005, in `backtest.cross_league variants`); its verdict waits for the lab run; the untuned divisions' are still to do | T-1646 | Judged by D-139; the chosen values with the grid around them |
| `[ ]` T-1654 | The cross-league fit: an Elo prior (none today, so every European forecast is "limited"), home advantage per competition (one shared today), and its confidence at the extremes (Sporting 92% against LASK). Built, off by default (D-309): `cross_league.elo_weight` and `.home_by_competition` in a version file, the published version and 0.7.0 unchanged (`tests/test_cross_league_options.py`); `python -m fmip_model.backtest.cross_league variants` compares D-309's grid with the fit as it is on the same matches (log loss, Brier, calibration, the paired bootstrap, the tail above 85%), the holdout refused. The verdict waits for the lab run on 2024/25 | T-1646 | Judged by D-139 on the `XL` matches |
| `[ ]` T-1655 | The regulars index in place of `xi_strength`: the share of a side's minutes over its last ten matches missing from the XI, the goalkeeper apart; it sees rotation and absence alike | T-1648 | Judged by D-139 on matches with both XIs; Stuttgart v Gladbach (six changes) moves the right way |
| `[ ]` T-1656 | Rest with what comes next: days since the last match, days to the next one and its weight (a Champions League match within four days), the regulars' minutes in the last fortnight. **Module built** (`inputs/rest_next.py`, D-307: D-141's rest and congestion plus a European or domestic cup match in the four days after); **verdict pending** the lab run. The regulars' minutes are left to T-1655 (they need T-1648) | T-1649 | Judged by D-139 |
| `[ ]` T-1657 | The draw: a recalibration of the three probabilities (draws are over-forecast where the sides are 10–25 points apart: 27% said, 19% seen). Built: the harness's second kind of input (`CalibrationInput`, fitted on the candidate's out-of-sample forecasts) and `draw_calibration`, its formulation fixed in D-308 before any run; the lab run and the verdict pending | T-1646 | Judged by D-139 and by the draw's reliability |
| `[ ]` T-1658 | Coach quality: a coach's sides against the model's expectation across his spells, shrunk toward zero, and his time in post. Built: `inputs/coach_quality.py` (D-310: the coach from the club's latest line-up before the day, a goal-rating baseline in place of the model's expectation, pseudo-count 40, tenure capped at 38); the lab run reads line-ups through `MODEL_RECORDS_DATABASE_URL` | T-1646 | Judged by D-139; at least 300 matches (verdict pending the lab run) |
| `[ ]` T-1659 | Late-season stakes: the last eight rounds, by what a side can still win or lose (zones and deductions researched back to 2020/21). Built: `inputs/late_stakes.py` (D-311: up, danger, nothing from the table the day before and the committed zones). The zones list 2024/25 onwards, so the development run is `insufficient` by construction until 2020/21 to 2023/24 are researched | T-1646 | Judged by D-139 on those rounds (verdict pending the earlier zones and the lab run) |

## D–E. Candidate, shadow, report

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1660 | One candidate (0.8.0) of the inputs that passed, judged once on the holdout, then in shadow beside the published version | T-1651–T-1659 | Holdout verdict recorded; at least 300 pre-kick-off shadow forecasts |
| `[ ]` T-1661 | The report, in Persian for the maintainer and the teammate and in English in the docs: each factor's effect on the percentages, its metrics with intervals, its verdict, how its weight was set, ten matches better and ten worse, the teammate's twelve examples forecast again | T-1660 | The five questions answered; promotion only on the maintainer's decision |
