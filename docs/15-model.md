# The forecast model: how it works, and how to propose a change

Written for a collaborator who knows football and wants to improve the
forecasts, without having to be a programmer (T-1368, D-186). It explains
the model in plain words, what is stored and measured, how a new version
goes from an idea to the site, and the one command that tests an idea.

Everything here is checked against the code; the file named beside each
statement is where to look when in doubt. Code lives in `apps/model/`.

## 1. What the model does

For every match it gives three probabilities (home win, draw, away win), the
expected goals of each side and the most likely scorelines. It is one
product, the **statistical model**; the founder's analysis and the
community's consensus are separate products and are never blended with it
(rule 6 in `CLAUDE.md`).

**The idea in one paragraph.** Each club has two hidden numbers: how well it
attacks and how leaky its defence is. Home goals are expected to be
`exp(home attack + away defence + home advantage)`, away goals
`exp(away attack + home defence)`, and each side's goals follow a Poisson
distribution around that. This is the Dixon–Coles model (1997), the standard
starting point for football scores. Every probability on the site is read off
the resulting table of scorelines from 0–0 to 10–10
(`fmip_model/model/poisson.py`).

The pieces, all in `fmip_model/model/dixon_coles.py` unless named otherwise:

| Piece | What it means for a football reader |
|---|---|
| **Attack and defence per club** | Fitted from results, never typed in. A club that scores a lot against good defences gets a high attack. |
| **Home advantage** | One number per league, fitted afresh at every refit from that league's own results (so it is lower in a league where home teams win less). Not a constant anyone sets. Typically 0.2 to 0.35 on the log scale, i.e. home sides score about 25 to 40% more. |
| **Low-score correction, `rho`** | Plain Poisson gets 0–0, 1–0, 0–1 and 1–1 slightly wrong; Dixon and Coles add a correction for those four scores only. Fitted, not set. |
| **Time decay, `xi`** | Recent matches count more. A match `t` days old gets weight `exp(-xi × t)`, so its *half-life* is `0.693 / xi` days: `xi = 0.0065` means a match from 107 days ago counts half as much as yesterday's. Small `xi` = long memory; large `xi` = reacts fast to form. |
| **Ridge** | A gentle pull of every club toward the league average, so a club with few matches does not get an extreme rating from a lucky run. Bigger ridge = more caution. |
| **Elo prior and its weight** | Elo is a long-run strength rating. The fit pulls each club's *net* strength (attack minus defence) toward what its Elo implies (`(Elo − league mean) / 400`), with strength `elo_weight`. 0 ignores Elo; large values make the model mostly Elo. 0.1.0 read Club Elo, now retired (D-162); the published 0.6.0 reads our own Elo, computed from the stored results with the World Football Elo rules (K 20, home 60, start 1500; `fmip_model/model/own_elo.py`, D-111). |
| **History window** | How many days back a fit reads (`history_days`). Long enough that the decay, not the window, forgets old matches. |
| **Per-division constants** | `xi` and `ridge` can differ by league, where tuning on one season and testing on the next showed it helps (T-532). |
| **Cross-league fit** | For cup matches between clubs of different leagues: one joint fit over every league, where a club's strength is its league's plus its own (`fmip_model/model/cross_league.py`, D-085). 0.6.0 carries it, but the site does not yet publish a match between leagues (D-191). |
| **Line-up term** | Optional: moves expected goals by the difference in the two starting XIs' ratings (`lineup_beta`, T-534). No version uses it yet. |

**How often it is fitted.** The service fits once per league per day, on
every match before that day (`fmip_model/service/forecaster.py`); the
backtest refits at most weekly. A club the fit has never seen is answered
`unavailable`, never guessed.

## 2. What is stored, and how it is measured

**Every forecast is kept, unchanged, forever** (rule 5). A forecast row
(`forecast`, migration `packages/db/migrations/1758500000000_forecast.sql`)
records the model version, the time it was computed and an input snapshot
(what the model was asked and what it read). A newer forecast is a new
version beside the old one, never an edit.

**Every forecast is compared with the result.** When a match finishes, each
of its forecast versions gets an `evaluation` row (migration
`1758600000000_evaluation.sql`): the score, the probability the forecast gave
the actual outcome, its log loss and Brier score, whether its favourite
outcome happened (`correct`) and whether the most likely scoreline was exact
(`scoreline_hit`). These rows are immutable too.

**Only forecasts made before kick-off count** (D-031). A forecast computed
after the result was known proves nothing, so the published performance
figures read `pre_kickoff = true` only, and say beside them how many matches
had no such forecast.

**Where to see the numbers.** Per competition, `GET
/competitions/:id/model-performance` and the model notes page; for the
candidates in shadow, the admin page *Model candidates* (`/admin/model-candidates`,
T-1103), which shows each candidate's pre-kick-off record as "N of 300".
Accuracy over time and the ranked probability score (RPS) are being added by
T-1369.

### The metrics, and how to read them

All of them are computed the same way in the backtest and on the live record
(`fmip_model/backtest/metrics.py`), so the two sets of numbers compare.

| Metric | What it is | Better | Uniform (1/3 each) |
|---|---|---|---|
| **Log loss** | The average of `−ln(probability given to what happened)`. Punishes confident mistakes hard: saying 5% for a result that happens costs 3.0, saying 33% costs 1.1. **The main yardstick.** | lower | 1.0986 |
| **Brier score** | The average squared gap between the three probabilities and what happened (1 for the outcome, 0 for the others). Gentler on confident mistakes. | lower | 0.667 |
| **Accuracy** | Share of matches where the outcome given the highest probability happened. Easy to read, but blind to *how* confident the forecast was; never judge a model by it alone. | higher | 33% |
| **Calibration error** | When the model says 40%, does it happen about 40% of the time? The average gap, over ten probability bands for each outcome. | lower | — |
| **RPS** (added by T-1369) | Like Brier, but it knows a home win is closer to a draw than to an away win. | lower | — |

**What a good number looks like.** In the big European leagues the bookmakers'
closing odds (with their margin removed) reach a log loss of about 0.96–1.00;
a model within 0.02 of the market is good enough to publish (D-016). Small
differences matter: across a season, 0.005 of log loss is a real
improvement, and 0.0005 is usually noise. That is why every comparison here
comes with an interval (section 4).

### Current numbers (from the committed reports)

Reports are in `apps/model/reports/<version>/`, one folder per version, never
edited by hand. Since 2026-10-09 the published version is **0.6.0**; it
replaced 0.1.0 on these backtests, as an exception to the 300-forecast rule
that the maintainer decided and D-191 records.

- **`dixon-coles-elo@0.1.0`**, published until 2026-10-09, Premier League 2024/25 (Oct–May,
  320 matches): log loss 1.0170 against the market's 0.9811 and uniform's
  1.0986 — better than guessing, worse than the market by more than 0.02, so
  not yet good enough by D-016's standard. In 2025/26 it is worse than the
  market in all eleven football-data.co.uk leagues (below).
- **Candidate `dixon-coles-elo@0.5.0`**, 2025/26, ten leagues, 3,185
  matches: our own Elo as the prior gave 0.9933 against 0.9965 with no prior
  (`reports/dixon-coles-elo-0.5.0/elo_prior_2025-08-01..2026-06-30.md`).
- **0.5.0 against 0.1.0 and the market**, eleven leagues, 2025/26 walked
  forward, 3,724 matches, from this guide's own command
  (`reports/dixon-coles-elo-0.5.0/compare_2025-08-01..2026-06-30.md`, run
  2026-10-04 with no Club Elo snapshot, so 0.1.0 fits with no prior, as it
  has in production since Club Elo stopped answering):

  | Forecaster | Log loss | Brier | Accuracy | Calibration error |
  |---|---|---|---|---|
  | published 0.1.0 | 1.0255 | 0.6106 | 49.5% | 0.0317 |
  | candidate 0.5.0 | 1.0055 | 0.6010 | 50.3% | 0.0215 |
  | market (closing odds) | 0.9850 | 0.5877 | 51.8% | 0.0149 |
  | uniform | 1.0986 | 0.6667 | 33.3% | 0.0640 |

  0.5.0 beats 0.1.0 by D-139's bar (−0.0201, 95% interval −0.0281 to
  −0.0124) and in every one of the eleven leagues, and is 0.0204 behind the
  market: just outside D-016's 0.02. 0.5.0 was never published: 0.6.0,
  identical to it in these leagues, was (D-191), and 0.5.0 is retired.
- **Published `dixon-coles-elo@0.6.0`** is 0.5.0 plus tuned constants for
  the Persian Gulf Pro League (IR1: `xi` 0.002, ridge 3), chosen on 2024/25
  and tested once on 2025-07-01..2026-10-08, on our own records in
  production's store (D-190,
  `reports/dixon-coles-elo-0.6.0/compare_2025-07-01..2026-10-08.md`). IR1 has
  no closing odds, so there is no market line; on the 229 matches all three
  versions forecast:

  | Forecaster | Log loss | Brier | RPS | Accuracy | Draws above 45% |
  |---|---|---|---|---|---|
  | published 0.1.0 | 1.0852 | 0.6527 | 0.2086 | 42.8% | 19 |
  | candidate 0.5.0 | 1.0653 | 0.6417 | 0.2040 | 42.4% | 14 |
  | candidate 0.6.0 | 1.0490 | 0.6336 | 0.2000 | 45.0% | 0 |
  | uniform | 1.0986 | 0.6667 | 0.2166 | 33.3% | 0 |

  D-139's bar against 0.5.0 says *insufficient* (229 of the 300 matches it
  asks for); 0.6.0 entered shadow all the same, for the reasons D-190 gives,
  and was published on these numbers and the eleven leagues' (D-191). In
  every other league its forecasts are 0.5.0's.

## 3. Versions: published, candidates, shadow, promotion

- **The published version** is the one the site shows:
  `dixon-coles-elo@0.6.0`, the one file of
  `apps/model/fmip_model/model/published/` (`PUBLISHED` in
  `fmip_model/model/version.py`; the service refuses to start unless there is
  exactly one). A version's constants never change: a changed constant is a
  new version.
- **The defaults** every version file starts from are the first published
  version's, `dixon-coles-elo@0.1.0`, kept in code (`BASELINE`;
  `fmip_model/model/dixon_coles.py`: `DEFAULT_XI = 0.0065`,
  `DEFAULT_RIDGE = 0.01`, `DEFAULT_ELO_WEIGHT = 0.5`, `ELO_SCALE = 1.0`). A
  file names only what differs from them.
- **A candidate** is a JSON file in `apps/model/fmip_model/model/candidates/`,
  named `<name>-<version>.json` (D-140). Today there is none.
- **Retired versions** (`retired/`, today 0.5.0) once forecast and no longer
  do; their files stay so a stored forecast can be traced to its constants.
- **Shadow.** Once a candidate file is merged and deployed, the model service
  offers it automatically, and the API stores a shadow forecast from every
  candidate beside every published forecast (D-082, D-140). Readers never see
  shadow forecasts; they are evaluated exactly like published ones.
- **Promotion** happens only on the candidate's own record: at least 300
  pre-kick-off forecasts evaluated, then a decision entry in
  `docs/00-decisions.md` with the numbers (D-082; T-535 and T-1151 are the
  promotion tasks). It is moving files: the candidate's to `published/`, the
  old published one's to `retired/`. Old forecasts keep the version that
  made them, and every match in the next seven days gets one new forecast
  from the new version on the next tick (D-191). The one exception so far is
  0.6.0 itself, published on backtests by the maintainer's decision (D-191);
  it does not lower the bar for the next.
- **The bar a change must clear before it enters shadow** (D-139, D-186): on
  the same matches as the current candidate, a lower log loss with a 95%
  interval entirely below zero, calibration not demonstrably worse, worse in
  at most a third of the leagues, and at least 300 matches. The backtest is
  the gate into shadow; the live record is the gate onto the site.

## 4. Proposing a change, step by step

### Once: set up

1. Install [Git](https://git-scm.com/downloads) (on Windows it brings *Git
   Bash*, the terminal to use for the commands below), [Docker
   Desktop](https://www.docker.com/products/docker-desktop/), and
   [Node.js](https://nodejs.org/) with pnpm (`corepack enable`).
2. Clone the repository and, in its folder, run:

   ```bash
   cp .env.example .env
   docker compose up -d --wait postgres
   pnpm install
   pnpm --filter @fmip/db migrate:up
   ```

   The last line creates the tables, including the training store (the
   `training` schema). The backtest fills that store itself the first time.

### Each idea

1. **Branch.** `git switch -c model-<short-idea>` (for example
   `model-longer-memory`).
2. **Copy the published version** (or the current candidate, when there is
   one) to the next version number in `candidates/`, and change the
   `version` inside to match the file name:

   ```bash
   cp apps/model/fmip_model/model/published/dixon-coles-elo-0.6.0.json \
      apps/model/fmip_model/model/candidates/dixon-coles-elo-0.7.0.json
   ```

3. **Change the parameters** you want to test (table below), and rewrite
   `source` in one or two sentences: what you changed and why you expect it
   to help. Change one idea at a time; two changes in one file cannot be told
   apart afterwards.
4. **Run the backtest** — the one command:

   ```bash
   bash scripts/model-backtest.sh apps/model/fmip_model/model/candidates/dixon-coles-elo-0.7.0.json
   ```

   It starts the database if needed, builds the model's Docker image, loads
   any football-data.co.uk season the store does not have yet (a few seconds
   per league and season, the first time only), and walks the 2025/26 season
   forward in all eleven leagues: for every match day it fits each version
   on the matches *before* that day only, forecasts the day, and scores it.
   It fits each league about 35 times per version, the leagues in parallel:
   about a quarter of an hour on an eight-core laptop for two versions, more
   for three. For a quick first look add
   `--divisions E0 SP1`. Other options: `--against published` (compare with
   the published version instead of the current candidate), and `--from`,
   `--to`, `--history-from` for another window.
5. **Read the report** it names at the end:
   `apps/model/reports/dixon-coles-elo-0.7.0/compare_2025-08-01..2026-06-30.md`
   (and a `.json` twin with the same numbers).
   - The first table scores, on exactly the same matches, the **published**
     version, the **reference** (the current candidate, or the published
     version when none is in shadow), your **proposed**
     version, the **market** (the closing odds) and **uniform** (one third
     each). Your version should beat uniform by a wide margin, and the closer
     it gets to the market, the better.
   - **"D-139's bar"** is the verdict: the difference in log loss between
     your version and the reference, with its 95% interval. *Passed* means
     the whole interval is below zero (better, and not by luck). *Failed*
     lists the reason. *Insufficient* means too few matches to say.
   - **Per division** shows where it helped and where it hurt. A change that
     wins in two leagues and loses in nine is not an improvement.
6. **Open a pull request** with the candidate file and its report folder.
   The title: `feat(model): dixon-coles-elo 0.7.0 -- <the idea>`. In the
   description, paste the first table and the verdict line. A passed verdict
   is merged and the version goes into shadow on the next deploy; a failed
   one is still worth keeping as a record, in the PR, of what was tried.

**Do not tune on the window you test on.** If you try twenty values of
`xi` and keep the one with the best 2025/26 number, part of that number is
luck you selected. Search on an earlier season (`--from 2024-08-01 --to
2025-06-30 --history-from 2022-07-01`), then run the default 2025/26 window
once with the value you chose. `python -m fmip_model.backtest.tune` does
exactly this for `xi` and `ridge` per league (T-532); with `--candidate
<file>` it tunes on top of that candidate's window and Elo prior, and
`--test-grid` shows every pair on the test window too (T-1372). The final test is
always the shadow record, on matches nobody had seen.

### The parameters

Everything the file does not name stays 0.1.0's (the defaults), so copy the
published file rather than starting from an empty one.

| Key in the JSON | Meaning | Defaults (0.1.0) | Published 0.6.0 | Sensible range |
|---|---|---|---|---|
| `xi` | Time decay for every league not listed in `per_division` (half-life `0.693 / xi` days) | 0.0065 (107 days) | 0.0065 | 0.0005 (4 years) to 0.01 (70 days) |
| `ridge` | Pull toward the league average, for leagues not in `per_division` | 0.01 | 0.01 | 0.001 to 1 |
| `per_division.<code>.xi`, `.ridge` | The same two, for one league. Codes: E0 Premier League, E1 Championship, SP1 La Liga, D1 Bundesliga, I1 Serie A, F1 Ligue 1, N1 Eredivisie, P1 Primeira Liga, T1 Süper Lig, B1 Belgian Pro League, SC0 Scottish Premiership, IR1 Iran (our own records) | none | e.g. E0 0.002 / 0.003, T1 0.004 / 0.01, most others 0.001–0.003 / 0.3; 0.6.0 adds IR1 0.002 / 3 | as above |
| `elo_weight` | How hard net strength is pulled toward Elo | 0.5 | 0.5 | 0 (off) to 5 |
| `elo_prior` | Which Elo: `own` (ours). `clubelo` and `clubelo_then_own` are refused for any new version (D-162) | `clubelo` | `own` | `own` |
| `history_days` | Days of results a fit reads | 400 | 1100 | 365 to 1500 |
| `cross_league.xi`, `.team_ridge`, `.group_ridge` | The cup fit: its decay, how far a club may sit from its league, how far leagues may sit from each other | none | 0.0005 / 4 / 0.001 | 0.0005–0.005 / 0.1–10 / 0.0001–0.1 |
| `lineup_beta` | Weight of the starting-XI difference; leave it out | none | none | fitted by `python -m fmip_model.backtest.lineups` |
| `name`, `version`, `source` | The version's identity and a sentence on where its numbers came from | | | `version` must match the file name |

Fixed for every version (changing them is a code change, not a candidate):
the scoreline table's 10-goal limit, the Elo scale (400 points = 1 unit of
strength), and the Dixon–Coles form itself.

**What the command does not test.** It forecasts league matches league by
league, from the football-data.co.uk divisions a local store holds. IR1 is
our own records, held only in production's store: its comparison is the
same module run there, read-only (`--divisions IR1`), with no market line
since there are no closing odds (D-190). A change to `cross_league` is judged on cup matches by `python -m
fmip_model.backtest.cross_league`, and `lineup_beta` by `python -m
fmip_model.backtest.lineups`; the report says so when your file changes
either. A wholly new kind of input (rest days, derbies, injuries...) is a
small Python module and its own test, `python -m fmip_model.backtest.inputs`
(D-139); describe the idea in an issue and we will write it together.

**Ideas already tried, and their verdicts** (so they are not repeated
blindly): rest and congestion (D-141, failed), league stakes (D-143,
insufficient; with zones D-171, failed), the second leg of a tie (D-144,
failed), neutral grounds (D-145, insufficient), head-to-head (D-148,
failed), home advantage per team (D-149, failed). D-150 records that none
passed. Tuning a league the earlier tuning had not covered did help: IR1's
constants (D-190, candidate 0.6.0).

## 5. Where things are

| What | Where |
|---|---|
| The fit | `apps/model/fmip_model/model/dixon_coles.py` |
| Versions and their files | `apps/model/fmip_model/model/version.py`; `apps/model/fmip_model/model/published/`, `candidates/`, `retired/` |
| The comparison behind the one command | `apps/model/fmip_model/backtest/compare.py`, `scripts/model-backtest.sh` |
| Other backtests | `apps/model/fmip_model/backtest/` (`__main__`, `tune`, `elo_prior`, `inputs`, `cross_league`, `lineups`) |
| Reports | `apps/model/reports/<version>/` |
| The rules | `docs/00-decisions.md`: D-016, D-031, D-082, D-085, D-139, D-140, D-150, D-162, D-186, D-190, D-191 |
