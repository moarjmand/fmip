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

> Results table — pending T-024.

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
