# Highlightly Pro coverage check (T-1445, 2026-10-21)

A read-only probe of what the Highlightly Pro plan (`soccer.highlightly.net`,
7,500 requests a day) returns for the gaps the product has, made from the
production API container with the key it already holds. 67 requests in all
(the daily counter read about 7,287 before and 7,220 after the last one).
Nothing was written, no key was printed, and no odds or market-value data was
used.

Leagues are the ids in `provider_mapping`: Persian Gulf Pro League `247574`,
FA Cup `39079`, Copa del Rey `122477`. Every probe below is one `GET`. An empty
answer (a `200` with `[]`) still counts against the day, so a coverage check
costs the same whether or not the match has data.

## Summary

| Question | Answer |
|---|---|
| Iran league 2026/27: statistics, line-ups, player stats, box score with xG | **No.** Events and cards only. Nothing to build for line-ups or xG. |
| FA Cup / Copa del Rey 2026/27 line-ups and statistics | **Not yet.** Only qualifying rounds / round of 128 are played, and those have none. The 2025/26 FA Cup final had a line-up and a box score, so coverage follows the match's prominence. Re-probe when the proper rounds are played. |
| Highlights before 2026-10-12 | **Yes.** Listable by season with no date. One league's season costs about 4 to 52 list requests, plus 1 request per clip if geo restrictions are fetched. |
| Other unused endpoints | Per-player career statistics (the most useful), player profile and transfers, standings (Iran works), head-to-head, last five, team totals. |

## 1. Persian Gulf Pro League

`GET /matches?leagueId=247574&season=2026&limit=100` returned 108 matches in
one page (72 finished, the rest not started or postponed).

Four finished matches from rounds 8 and 9 (2026-10-18/19: Esteghlal-Gol Gohar,
Fajr Sepasi-Paykan, Mes Shahr-e Babak-Persepolis, Foolad-Nassaji) gave the same
answer each time:

| Endpoint | Answer for 2026/27 |
|---|---|
| `/matches/{id}` | One match with `events` (12 to 17: goals with scorer, cards, substitutions, missed penalties, each with the provider's player id), `statistics` and `predictions`. `venue` and `referee` are all `null`. `topPlayers` and `shots` are empty. |
| `statistics` (also `/statistics/{id}`) | **Two figures per side: red and yellow cards.** No shots, possession or corners. |
| `/lineups/{id}` | `formation: "Unknown"`, `initialLineup: []`, `substitutes: []` on both sides. |
| `/box-score/{id}` | `[]` for every match. No player statistics and no xG. |

Two more probes show a trend: a 2025/26 round-1 match (Gol Gohar-Aluminium
Arak) carried 10 statistics per side and 14 events, while the 2026/27 round-1
match (Tractor-Paykan, 2026-08-14) carries two statistics per side. Line-ups
were empty in both seasons. So the source once gave Iran a fuller statistics
sheet and now does not; it never gave line-ups.

**What it would take.** Line-ups, player statistics and xG: nothing, the source
does not have them. The goal, card and substitution events could fill an Iran
match timeline if the events API-Football returns for Iran are poorer; that needs
a comparison with our stored `incident` rows for the same matches first (not done
here). Cost if wanted: 1 request per finished match (`/matches/{id}`), about 8
a round; a mapper for `events` in
`packages/ingestion/src/adapters/highlightly/map.ts`; the provider player ids
resolved through the person mapping. The `predictions` block in the same
response is Highlightly's own model. CLAUDE.md rule 6 keeps a third party's
forecast out of our three prediction products, so it must not be read or shown.

## 2. FA Cup and Copa del Rey 2026/27

| Competition | Season 2026 state | Probed | Result |
|---|---|---|---|
| FA Cup | 355 matches listed, 69 finished; rounds: 3rd and 4th Round Qualifying (and replays), and "1/128-finals" (29 matches, not yet played) | Yeovil-Leatherhead (4th Qualifying, 2026-10-20), Carlisle-Tamworth (2026-10-17) | Line-ups empty, box score `[]`. Statistics are patchy: Yeovil only cards, **Carlisle-Tamworth 12 figures per side** (attacks, free kicks, throw-ins, goal kicks, possession, corners, offsides, cards, shots on and off target, blocked shots). 7 and 8 events. |
| Copa del Rey | 76 listed, 18 finished; "Round of 128" and "1/128-finals" | Prat-San Rafael (2026-10-11), Talayuela-Alcazar (2026-09-27) | Everything empty: no statistics, events, line-up or box score. |

Prominence matters: the **2025/26 FA Cup final** (Chelsea 0-1 Manchester City,
`/matches?leagueId=39079&season=2025&limit=1`) had a line-up (formation `4-2-3-1`,
`initialLineup` with 5 entries, so it looks grouped by line rather than by
player) and a box score with both sides. Early-round ties of 2025/26 (FA Cup Extra
Preliminary Round, Copa del Rey group stage) had nothing. The 2026/27 proper
rounds could not be tested: they are not played yet.

**What it would take.** The line-up adapter exists (`index.ts`, `/lineups/{id}`)
and so do the box-score adapter and job (T-1432), so these matches are picked up
once the leagues are in their cover set. Nothing to build until the proper
rounds are played. A re-probe costs about 3 requests per match (`/matches/{id}`,
`/lineups/{id}`, `/box-score/{id}`), 12 for four matches, and answers the only
open question: whether the big clubs' ties in those rounds get a line-up.

## 3. Highlights before 2026-10-12

`GET /highlights` accepts a season instead of a date and answers for past
seasons, 40 per page (the adapter's `HIGHLIGHTS_PAGE_SIZE`):

| Query | `totalCount` | Meaning |
|---|---|---|
| Premier League, `date=2026-05-24` | 42 | Final day of 2025/26; the 40 on page one were all `VERIFIED` (YouTube, club channels); some `UNVERIFIED` were on the list |
| Premier League, `date=2025-09-13` | 23 | A matchday in September 2025: still there |
| Premier League, `season=2025` | 2,043 | Whole season, newest first |
| Persian Gulf Pro League, `season=2025` | 128 | All `UNVERIFIED`, `source: other`, links on `video.varzesh3.com`, `embedUrl: null` |
| Persian Gulf Pro League, `season=2026` | 110 | Same: varzesh3 links, newest from 2026-10-19 |

Each clip carries its match (id, round, date, teams), so past clips can be tied
to our fixtures through the match id the box-score job already resolves.

**Cost of backfilling one league's season.**
- Season query, no date: `ceil(totalCount / 40)` list requests. Premier League
  2025/26: 52. Persian Gulf Pro League: 3 to 4. The count includes several
  channels' clips per match and clips that are not full-match highlights; the
  adapter drops those after reading, so the stored rows are fewer.
- Per-date query (what the daily job does now): one or two requests per matchday
  date, about 120 dates for a league season, so roughly 150 requests. Dearer
  for the same data.
- Geo restrictions are one request per clip
  (`/highlights/geo-restrictions/{id}`). If a backfill fetches them for every kept
  clip, that dominates: up to about 2,000 for a Premier League season. The daily
  job only checks the clips it keeps; a backfill should do the same and may spread
  the checks over several days.

So a top-flight league season is about 52 list requests plus the geo checks,
against a highlights budget of 5,000 a day (`HIGHLIGHTS_DAILY_BUDGET`).

**What it would take.** A `season` mode on `HighlightlyHighlights.list` in
`packages/ingestion/src/adapters/highlightly/highlights.ts` (today it requires
`date`), and a backfill job in the viewing module that walks the pages, applies
the same verified and match-highlight filters, stores into the existing highlight
store and spends from the shared `HighlightlyQuota`. No new table.

**Decision first: Iran's clips are all `UNVERIFIED`.** The adapter skips
unverified clips (`skipped.unverified` in `highlights.ts`), so the Iran league has
no highlights today although the source lists about 110 a season, one or two per
match, from `varzesh3.com`. They have no embed, so they could only be links out.
Whether to link Iranian readers to an unverified third-party site is a product and
licensing call for the maintainer (CLAUDE.md section 7, D-014), not something to
switch on inside a backfill.

## 4. Other endpoints on the plan we do not use

| Endpoint | Answer | Value | What it would take |
|---|---|---|---|
| `GET /players/{id}/statistics` | Per player: `perCompetition` (club, league, season, games played, minutes, goals, assists, cards, clean sheets, goals conceded, substitutions, penalties scored) and `perClub`. A Persian Gulf Pro League player came back with 15 competition rows back to 2023/24, including the Hazfi Cup, the Super Cup and AFC Champions League. | **High for Iran and cups**, where API-Football gives little: a career table and per-competition totals on a player page. | New client method; a job over players with a mapped provider person id (T-1436 maps them); a career-rows table, or an extension of the T-1431 season-stats store. 1 request per player: a 25-man squad is 25 requests, 3,000 players is 40% of a day. Needs a coverage state per competition, and a check that it does not duplicate T-1431 for the same player and season. |
| `GET /players/{id}` | Profile (foot, height, position main and secondary, birth date and place, citizenship, current club, contract expiry), transfers (from, to, type, date, season), injuries, **and market-value history**, rumours and news. | Profile and transfers overlap T-1428 (bios) and T-1440 (transfers). Market value is in the same body; it needs a licence check, so a mapper must drop it at the adapter. | Same client, 1 request per player. Never store `marketValue`, `rumours` or `relatedNews`. |
| `GET /standings?leagueId=&season=` | Iran 2026: one group of 18 rows with home, away and total played, wins, draws, losses, goals, plus points and position. | Low as a source: the adapter already maps it (`index.ts`) and API-Football gives standings. A cross-check or a fallback when the primary is late. | Nothing new; 1 request per league. |
| `GET /head-2-head?teamIdOne=&teamIdTwo=` | The last 10 meetings with scores and competition. | Medium: a "previous meetings" block for pairs our own history does not cover (new league pairs, cups). Our `fixture` table is better where it has the data. | Client method, both team ids through `provider_mapping`, 1 request per pair, cacheable for days. |
| `GET /last-five-games?teamId=` | The last five matches with scores. | Low: derivable from our stored fixtures for every covered team. | Not worth a source. |
| `GET /teams/statistics/{id}?fromDate=` | Per league and season: played, wins, draws, losses and goals, split home, away, total. | Low: a sum of our own fixtures. | Not worth a source. |
| `GET /teams/{id}`, `GET /leagues/{id}` | Team id, name, logo, type; league with its list of seasons. | Low. | None. |
| `GET /matches?leagueId=&season=&limit=100` | A whole season's match list, newest first (Iran 2026: 108 matches in 2 pages). | Medium as a fixture and coverage cross-check, and it gives the provider match ids the box-score job looks up one league-day at a time. | A season mode on the box-score `matches` call finds a season's ids in about 2 to 4 requests instead of one per matchday. |
| `x-ratelimit-requests-remaining` response header | The remaining daily requests, on every response. | Lets the quota service read the true figure instead of counting alone. | Return it from `highlightlyGet` (`highlights.ts`). |

Left out as instructed: odds and bookmakers (the terms forbid them for any
gambling use) and market values (licence check first).

## Recommendations

1. **Highlights season backfill** (section 3): the cheapest high-value item,
   about 52 list requests per top league. It needs a `season` mode and a job.
   Leave Iran out until the unverified-clip decision is taken.
2. **Player career statistics** (section 4): the one new data set that Iran, the
   cups and AFC competitions can gain from this plan. Plan it with T-1431 so the
   tables agree.
3. **Re-probe the FA Cup proper rounds and later Copa del Rey rounds** once they
   are played: 12 requests, only to confirm line-ups for the big clubs.
4. **Nothing for Iran line-ups, statistics or xG.** The plan does not have them;
   Iran detail comes from API-Football or stays `not_supplied`.
