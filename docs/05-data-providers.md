# Data providers

## The three data needs

Treating these as one requirement is the most common way to overpay.

| Need | Nature | Source strategy |
|---|---|---|
| Live operations — scores, incidents, lineups, tables | Continuous, high volume | Commercial API (paid tier at launch) |
| Historical training data | One-time bulk, then incremental | Free open datasets |
| Long-term team strength prior | Daily, tiny volume | Free dedicated source |

---

## Candidates for live operations

Figures gathered 2026-09-08 and **must be re-verified with a live key** before
the decision gate (T-025). A large share of published comparisons are authored by
vendors ranking themselves; treat all of the below as leads, not conclusions.

| Provider | Free tier | Entry paid | Notes |
|---|---|---|---|
| API-Football (api-sports.io) | 100 req/day, all endpoints, limited seasons | ~$19/mo → 7,500/day; ~$29 → 75,000/day; ~$39 → 150,000/day | 15s live updates. Top-five European leagues have lineups, player stats, xG; smaller leagues patchy. No feature gating between tiers. |
| football-data.org | 12 competitions, 10 req/min, delayed scores | ~€12/mo upward | Lineups, substitutions, cards, squads are paid. Match statistics and odds are separate add-ons. |
| Highlightly | 100 req/day, includes lineups | from ~$9.49/mo; top tier ~$45.99 for 65,000/day | Only candidate bundling structured data with video highlights. Smaller developer ecosystem. |
| Sportmonks | Permanent free plan, 2 leagues | varies | 14-day trial on paid plans requires a credit card. |
| TheStatsAPI | none | ~$50/mo | 150 competitions, xG and odds included, 10 years history. Vendor authored much of the comparison landscape. |
| Sportradar / Opta | none | enterprise contract | Only if officially licensed league data becomes a requirement. |

### Verified with live keys (2026-09-10)

The maintainer holds one free key per candidate (`API_FOOTBALL_KEY`,
`FOOTBALL_DATA_ORG_KEY`, `HIGHLIGHTLY_KEY` in `.env`, never in the tree). One
request each, to confirm the tier and learn the authentication each direct API
really wants:

| Provider | Base URL | Auth header(s) | What the first request said |
|---|---|---|---|
| API-Football | `https://v3.football.api-sports.io` | `x-apisports-key` | `/status`: plan `Free`, active, `limit_day: 100`, no errors. |
| football-data.org | `https://api.football-data.org/v4` | `X-Auth-Token` | `/competitions` and `/competitions/PL`: 200; `x-requests-available-minute: 9` after one call, so the 10/min figure holds. |
| Highlightly | `https://sports.highlightly.net/football` (`soccer.highlightly.net` also answers) | `x-rapidapi-key` **and** `x-rapidapi-host: sports.highlightly.net` | `/leagues?limit=1`: 200, `plan.tier: BASIC`. `x-api-key` or `Authorization: Bearer` alone → 403 "Missing mandatory HTTP Headers", even off RapidAPI. |

The adapters (T-021..T-023) must send exactly these headers; the harness
records real responses with the key redacted.

### Why no free tier can serve production

```
live polling, 30s interval, 6h of matches/day   ≈   720 req
fixtures + standings + lineups + post-match     ≈   300–800 req
                                                ───────────────
                                        daily   ≈   1,000–1,500
```

Against a 100/day free quota that resets at 00:00 UTC with no rollover, free
tiers cover roughly ten percent of need. They are a development and evaluation
environment.

---

## The bake-off protocol (T-024)

Evidence beats vendor marketing. Run all three free adapters simultaneously
against the **same fixture set** for **seven days** and record, per fixture:

| Metric | Definition |
|---|---|
| Goal latency | Seconds between kick event and provider reflecting it |
| Lineup lead time | Minutes before kick-off that a confirmed lineup appears |
| Lineup accuracy | Diff against the official post-match record |
| Field completeness | Percentage of expected fields populated, per module |
| Error rate | Non-200 responses, malformed payloads, contradictions |
| Quota efficiency | Requests consumed per useful update |
| Disagreement | Cases where two providers report different facts |

Fixture set: 20 matches spanning all five target leagues plus the Champions
League, mixing high-profile and low-profile fixtures.

Output: a results table appended to this file, feeding the decision gate.

The harness is `packages/ingestion/src/bakeoff/` (T-024), run by
`node scripts/bakeoff.mjs --live` from `packages/ingestion` after a build, with
the three keys in the environment. Each run is one day's snapshot: it replaces
the table below and keeps the full result under `packages/ingestion/bakeoff/`,
so the seven days are seven runs. The free plans serve past seasons only
(API-Football: 2022–2024), so the fixture set is the 2023/24 opening weekends
of the five target leagues; goal latency and lineup lead time cannot be
measured on finished matches and are listed as not measured until the polling
job (T-026) runs against the current season on a paid plan. Field
completeness, error rate, quota efficiency and disagreement are measured now.
`--recorded` runs the same harness over the committed recordings without a
network, which is what the package tests do.

<!-- bakeoff:start -->
### Results — live run, 2026-09-10 19:40 UTC

Fixture set: 2023/24 opening weekends: Premier League, La Liga, Bundesliga, Serie A, Ligue 1. Written by `scripts/bakeoff.mjs`; do not edit by hand.

| Provider | Tier | Calls ok | Errors | Requests | Mean latency | Fixture fields | Lineup fields | Detail fields | Table fields |
|---|---|---|---|---|---|---|---|---|---|
| API-Football (api-sports.io) | free | 35/35 | 0 | 35 | 1140 ms | 90% | 99% | 95% | 50% |
| football-data.org | free (TIER_ONE) | 25/35 | 10 unsupported | 35 | 753 ms | 70% | — | 25% | 100% |
| Highlightly | BASIC (free) | 5/7 | 2 unsupported | 10 | 388 ms | 40% | — | 57% | 0% |

Field completeness is the share of optional normalised fields a provider filled, per module; "—" means the module never came back. Requests are what the adapters reported consuming, so quota efficiency is requests against calls ok.

**Disagreements** (0): same match, different facts.

None among the matched fixtures.

**Not measured by this run:**

- goal latency (needs the live polling job, T-026)
- lineup lead time (needs polling across match days)
- lineup accuracy (needs an official post-match record to diff against)

<details><summary>Every call</summary>

| Provider | Call | Label | Result | Requests | Items | Latency |
|---|---|---|---|---|---|---|
| api_football | listFixtures | Premier League | ok | 1 | 9 | 1064 ms |
| api_football | getStandings | Premier League | ok | 1 | 1 | 558 ms |
| api_football | getFixtureDetail | Premier League: Burnley v Manchester City | ok | 1 | 1 | 1746 ms |
| api_football | getLineup | Premier League: Burnley v Manchester City | ok | 1 | 1 | 1209 ms |
| api_football | getFixtureDetail | Premier League: Arsenal v Nottingham Forest | ok | 1 | 1 | 1127 ms |
| api_football | getLineup | Premier League: Arsenal v Nottingham Forest | ok | 1 | 1 | 461 ms |
| api_football | getLive | Premier League | ok | 1 | 0 | 1352 ms |
| api_football | listFixtures | La Liga | ok | 1 | 8 | 4135 ms |
| api_football | getStandings | La Liga | ok | 1 | 1 | 1607 ms |
| api_football | getFixtureDetail | La Liga: Almeria v Rayo Vallecano | ok | 1 | 1 | 6051 ms |
| api_football | getLineup | La Liga: Almeria v Rayo Vallecano | ok | 1 | 1 | 1477 ms |
| api_football | getFixtureDetail | La Liga: Sevilla v Valencia | ok | 1 | 1 | 597 ms |
| api_football | getLineup | La Liga: Sevilla v Valencia | ok | 1 | 1 | 1032 ms |
| api_football | getLive | La Liga | ok | 1 | 0 | 787 ms |
| api_football | listFixtures | Bundesliga | ok | 1 | 9 | 613 ms |
| api_football | getStandings | Bundesliga | ok | 1 | 1 | 456 ms |
| api_football | getFixtureDetail | Bundesliga: Werder Bremen v Bayern Munich | ok | 1 | 1 | 481 ms |
| api_football | getLineup | Bundesliga: Werder Bremen v Bayern Munich | ok | 1 | 1 | 809 ms |
| api_football | getFixtureDetail | Bundesliga: VfL Wolfsburg v FC Heidenheim | ok | 1 | 1 | 640 ms |
| api_football | getLineup | Bundesliga: VfL Wolfsburg v FC Heidenheim | ok | 1 | 1 | 580 ms |
| api_football | getLive | Bundesliga | ok | 1 | 0 | 1462 ms |
| api_football | listFixtures | Serie A | ok | 1 | 10 | 458 ms |
| api_football | getStandings | Serie A | ok | 1 | 1 | 597 ms |
| api_football | getFixtureDetail | Serie A: Empoli v Hellas Verona | ok | 1 | 1 | 1358 ms |
| api_football | getLineup | Serie A: Empoli v Hellas Verona | ok | 1 | 1 | 550 ms |
| api_football | getFixtureDetail | Serie A: Frosinone v Napoli | ok | 1 | 1 | 457 ms |
| api_football | getLineup | Serie A: Frosinone v Napoli | ok | 1 | 1 | 489 ms |
| api_football | getLive | Serie A | ok | 1 | 0 | 435 ms |
| api_football | listFixtures | Ligue 1 | ok | 1 | 9 | 444 ms |
| api_football | getStandings | Ligue 1 | ok | 1 | 1 | 477 ms |
| api_football | getFixtureDetail | Ligue 1: Nice v Lille | ok | 1 | 1 | 2947 ms |
| api_football | getLineup | Ligue 1: Nice v Lille | ok | 1 | 1 | 463 ms |
| api_football | getFixtureDetail | Ligue 1: Marseille v Reims | ok | 1 | 1 | 742 ms |
| api_football | getLineup | Ligue 1: Marseille v Reims | ok | 1 | 1 | 1796 ms |
| api_football | getLive | Ligue 1 | ok | 1 | 0 | 427 ms |
| football_data_org | listFixtures | Premier League | ok | 1 | 9 | 648 ms |
| football_data_org | getStandings | Premier League | ok | 1 | 1 | 1334 ms |
| football_data_org | getFixtureDetail | Premier League: Burnley FC v Manchester City FC | ok | 1 | 1 | 392 ms |
| football_data_org | getLineup | Premier League: Burnley FC v Manchester City FC | error: unsupported | 1 | 0 | 412 ms |
| football_data_org | getFixtureDetail | Premier League: Arsenal FC v Nottingham Forest FC | ok | 1 | 1 | 392 ms |
| football_data_org | getLineup | Premier League: Arsenal FC v Nottingham Forest FC | error: unsupported | 1 | 0 | 408 ms |
| football_data_org | getLive | Premier League | ok | 1 | 2 | 422 ms |
| football_data_org | listFixtures | La Liga | ok | 1 | 8 | 466 ms |
| football_data_org | getStandings | La Liga | ok | 1 | 1 | 909 ms |
| football_data_org | getFixtureDetail | La Liga: UD Almería v Rayo Vallecano de Madrid | ok | 1 | 1 | 443 ms |
| football_data_org | getLineup | La Liga: UD Almería v Rayo Vallecano de Madrid | error: unsupported | 1 | 0 | 460 ms |
| football_data_org | getFixtureDetail | La Liga: Sevilla FC v Valencia CF | ok | 1 | 1 | 2681 ms |
| football_data_org | getLineup | La Liga: Sevilla FC v Valencia CF | error: unsupported | 1 | 0 | 418 ms |
| football_data_org | getLive | La Liga | ok | 1 | 2 | 472 ms |
| football_data_org | listFixtures | Bundesliga | ok | 1 | 9 | 2163 ms |
| football_data_org | getStandings | Bundesliga | ok | 1 | 1 | 3303 ms |
| football_data_org | getFixtureDetail | Bundesliga: SV Werder Bremen v FC Bayern München | ok | 1 | 1 | 556 ms |
| football_data_org | getLineup | Bundesliga: SV Werder Bremen v FC Bayern München | error: unsupported | 1 | 0 | 397 ms |
| football_data_org | getFixtureDetail | Bundesliga: Bayer 04 Leverkusen v RB Leipzig | ok | 1 | 1 | 1312 ms |
| football_data_org | getLineup | Bundesliga: Bayer 04 Leverkusen v RB Leipzig | error: unsupported | 1 | 0 | 438 ms |
| football_data_org | getLive | Bundesliga | ok | 1 | 2 | 731 ms |
| football_data_org | listFixtures | Serie A | ok | 1 | 10 | 515 ms |
| football_data_org | getStandings | Serie A | ok | 1 | 1 | 493 ms |
| football_data_org | getFixtureDetail | Serie A: Empoli FC v Hellas Verona FC | ok | 1 | 1 | 437 ms |
| football_data_org | getLineup | Serie A: Empoli FC v Hellas Verona FC | error: unsupported | 1 | 0 | 456 ms |
| football_data_org | getFixtureDetail | Serie A: Frosinone Calcio v SSC Napoli | ok | 1 | 1 | 649 ms |
| football_data_org | getLineup | Serie A: Frosinone Calcio v SSC Napoli | error: unsupported | 1 | 0 | 621 ms |
| football_data_org | getLive | Serie A | ok | 1 | 2 | 443 ms |
| football_data_org | listFixtures | Ligue 1 | ok | 1 | 9 | 478 ms |
| football_data_org | getStandings | Ligue 1 | ok | 1 | 1 | 474 ms |
| football_data_org | getFixtureDetail | Ligue 1: OGC Nice v Lille OSC | ok | 1 | 1 | 1103 ms |
| football_data_org | getLineup | Ligue 1: OGC Nice v Lille OSC | error: unsupported | 1 | 0 | 573 ms |
| football_data_org | getFixtureDetail | Ligue 1: Olympique de Marseille v Stade de Reims | ok | 1 | 1 | 406 ms |
| football_data_org | getLineup | Ligue 1: Olympique de Marseille v Stade de Reims | error: unsupported | 1 | 0 | 425 ms |
| football_data_org | getLive | Ligue 1 | ok | 1 | 2 | 537 ms |
| highlightly | listFixtures | Premier League | ok | 3 | 9 | 1102 ms |
| highlightly | getStandings | Premier League | ok | 1 | 1 | 231 ms |
| highlightly | getFixtureDetail | Premier League: Burnley v Manchester City | ok | 1 | 1 | 286 ms |
| highlightly | getLineup | Premier League: Burnley v Manchester City | error: unsupported | 1 | 0 | 210 ms |
| highlightly | getFixtureDetail | Premier League: Newcastle United v Aston Villa | ok | 1 | 1 | 480 ms |
| highlightly | getLineup | Premier League: Newcastle United v Aston Villa | error: unsupported | 1 | 0 | 523 ms |
| highlightly | getLive | Premier League | ok | 2 | 2 | 1046 ms |

</details>
<!-- bakeoff:end -->

---

## Historical training data (free)

| Source | Contents | Licence posture |
|---|---|---|
| football-data.co.uk | Match results plus bookmaker odds going back decades, plain CSV | Free download; verify terms before redistribution |
| Club Elo | Daily Elo ratings for European clubs back to 1939, free keyless CSV API | Free; attribute |
| StatsBomb Open Data | Event-level data with xG for selected competitions | **Non-commercial with attribution. Redistribution of raw files not permitted. Building a commercial product on it is not permitted.** Research and offline validation only — never inside the product. |
| Understat | Shot-level xG for the top European leagues since 2014/15 | Requires scraping; legal and reliability risk. Not on the critical path. |
| FBref | Broad advanced statistics | Same posture as Understat |

The bookmaker odds in football-data.co.uk serve a second purpose: they are the
calibration benchmark. A model that cannot match the market's calibration on
historical fixtures is not ready to publish.

---

## Sourcing policy

See decision D-014. Summary:

- **Critical path** — licensed API only.
- **Enrichment, degradable** — permitted under constraints, always with an
  explicit `not_supplied` state when unavailable.
- **Offline research** — open datasets, licence respected.

---

## Switching cost

By design, changing provider is: write one adapter directory, pass the contract
tests, change one config value. No API module, page, or type outside
`packages/ingestion/adapters/` should need to change. If a provider swap ever
requires touching the frontend, the adapter layer has been violated.
