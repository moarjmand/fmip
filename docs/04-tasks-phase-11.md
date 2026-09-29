# Phase 11 — Model depth and the console's configuration

Phases 1 to 10 built the product the blueprint describes and put it on a live
server. What is left in the two areas this phase covers -- what the model
reads, and what an operator can set without a deploy -- was checked on
2026-09-29 against `product-blueprint.md` sections 2.3, 6.1, 6.3, 6.4, 9.1,
13, 14 and 16, the roadmap's "Where it stands" paragraphs, `03-project-map.md`,
the decisions to D-138, `apps/model` and the schema where a doubt had to be
settled. It found:

- **Model inputs blueprint 6.3 lists that the fit does not read.** The fit
  (`fmip_model/model/dixon_coles.py`) reads results, time-weighted, with an
  Elo prior, one home advantage per division, clubs of different leagues on
  one scale (candidate only, D-085) and a line-up term (candidate only,
  D-086). It does not read **rest days or fixture congestion** (only the
  Power Index measures rest, `power-index-measure.ts` `restOf`), **travel**,
  **competition format and match state** (a league match with nothing left
  to play for, the second leg of a tie, a final on neutral ground),
  **manager changes**, **head-to-head** (the blueprint allows it only "if
  historical testing proves that they add value"), or **home advantage by
  team** (6.3 says "learned by competition and team"; the fit learns it by
  division only -- missed by the outline, added here).
- **Two Power Index components that are not what the blueprint says.** Rest,
  travel and schedule (5%) is measured without travel and is always
  `limited`; its weight was never validated, because `12-power-index.md`
  excludes rest from the backtest. Competition context (5%) is not modelled
  at all, so no match reaches more than 95% completeness.
- **One shadow slot.** D-082 runs one candidate in shadow
  (`candidate.json`, `forecast_version_unique (fixture_id, role,
  version_number)`). Candidate `dixon-coles-elo@0.5.0` is waiting for its 300
  pre-kick-off forecasts from 2026-10-08 (T-535). A new input put into that
  slot would restart that count, so every input in this phase would wait for
  the one before it.
- **The console's configuration.** Rating thresholds are versioned constants
  (D-035, D-059, `ELIGIBILITY_V1`); making them rows is Phase 9's N-7, the
  maintainer's. The homepage has no featured matches: "important-match
  forecasts" (2.3) are simply the first upcoming ones (`lib/home.ts`), and the
  competitions' order (`competition.display_order`, T-504) is set from a
  script on the server. A locale is offered exactly when its catalogue
  passes `isShippable`; nobody can hold one back. The console's member search
  finds an account but shows none of its rating history or privileges in one
  place (16: "user search, account status, rating history and privilege
  controls").

**Dropped from the outline because it is built, or declined.** Recent form
weighted by recency and opponent quality is the fit's time weighting and the
Power Index's opponent-adjusted form. Injuries and suspensions are the
line-up term (D-086, T-923 open); "measured against replacement quality" was
declined in D-081 because it guesses a manager's choice. Data completeness and
freshness are in every forecast. Head-to-head is already shown to users (the
match centre's `head_to_head` module, T-033). Blueprint 6.4's versions are
built (`early`, `lineups_confirmed`, what changed, the post-match evaluation);
the `lineups_predicted` version waits on predicted line-ups (Phase 8's N-5).
Blueprint 16's featured matches for public discussion (T-613), campaigns,
coverage writes, freshness, moderation and system health are built, as are
the language, territory and time-zone choices a reader makes (2.2, T-312,
T-620). What an administrator would set per territory is a question (N-3),
not a task.

**Carried, not duplicated.** Phase 9's T-902 (the send pool measured on the
server), T-914 (coverage from the findings), T-923 (the line-up term fitted),
T-924 (the Power Index's line-up weights), T-925 and T-926 (match days), and
T-930 and T-931 (the maintainer's yes) stay in `04-tasks-phase-9.md`. Phase
6's T-501, T-504 and T-535 (the promotion of 0.5.0) stay in
`04-tasks-phase-6.md`. Nothing here changes them.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**Numbers are assigned here, so parallel agents do not collide.** Every
decision entry a task needs has its number below (D-139 to D-155). So does
every migration a task needs (timestamps from `1765100000000`, in steps of
`10000000`). An agent takes the number its row names and no other. A task
that finds it needs no decision or no migration leaves its number unused and
says so in its PR. It never passes the number to another task. A task that
finds it needs one it was not given stops and asks, and does not take the
next free number.

| Decision | Task | Subject |
|---|---|---|
| D-139 | T-1101 | The bar an input passes in its backtest: against which versions, on which matches, by how much |
| D-140 | T-1102 | Several candidates in shadow at once, each with its own record |
| D-141 | T-1110 | Rest days and congestion as a model input, from the stored schedule |
| D-142 | T-1111 | The Power Index's rest component validated on stored schedules |
| D-143 | T-1120 | League stakes: a side whose position the table has locked |
| D-144 | T-1121 | The second leg of a tie, given the first |
| D-145 | T-1122 | A match on neutral ground carries no home advantage |
| D-146 | T-1123 | The Power Index's competition context component |
| D-147 | T-1130, T-1131 | Coach changes read from stored line-ups, and a new coach as an input |
| D-148 | T-1140 | Head-to-head, only on the backtest's evidence |
| D-149 | T-1141 | Home advantage by team, shrunk to the division's |
| D-150 | T-1150 | The next candidate: the inputs that passed, together |
| D-151 | T-1151 | Promotion of the next candidate (or not), with the numbers |
| D-152 | T-1160 | Rating thresholds as versioned rows set from the console |
| D-153 | T-1161 | Featured matches on the homepage |
| D-154 | T-1162 | The competitions' order set from the console |
| D-155 | T-1163 | Holding back a language that is ready |

| Migration | Task | For |
|---|---|---|
| `1765100000000` | T-1102 | `forecast` version numbering per (fixture, model version) for `role = 'shadow'`; published numbering unchanged |
| `1765110000000` | T-1160 | `rating_threshold_version`: the thresholds in force, from when, who set them and why, superseded rather than edited |
| `1765120000000` | T-1161 | `homepage_feature`: a match an editor features, its window, and its clearing with a reason |
| `1765130000000` | T-1163 | `locale_hold`: a ready locale held back, who, why, and its release |

T-1101, T-1103, T-1110, T-1111, T-1120 to T-1123, T-1130, T-1131, T-1140, T-1141,
T-1150, T-1151, T-1162, T-1164 and T-1165 need no migration: the model's
inputs are computed from `training.match` and our own records (read from
`public`, never written, T-512), and `competition.display_order` exists
(T-504). If one finds otherwise, it stops and asks.

**Every new input is a candidate, measured before it is anything else.** No
input reaches a published forecast in this phase except through T-1151, a
task with a decision entry and the numbers (D-082). Each input task
(E111 to E114) runs T-1101's harness on the football-data.co.uk divisions and
on our records' divisions (D-016, D-083), against the published version
(`dixon-coles-elo@0.1.0`) and the current candidate (`0.5.0`), and records
the verdict in its decision entry whether it passes or not. An input that
fails is written down with its numbers and carried by no candidate. A changed
constant is a new version (rule 5): stored forecasts keep the version they
were made by.

**What each input needs, and whether we have it (2026-09-29).**

| Input | Needs | Stored today? | So |
|---|---|---|---|
| Rest days | each club's previous match date | Yes: `training.match.match_date` (football-data: league matches only) and our records (every carried competition, cups included; clubs joined through `training.team_alias`) | T-1110. Domestic cups we do not carry are invisible; the entry says so |
| Fixture congestion | matches in the last 14 days | Yes, same rows, same limit | T-1110 |
| Travel | where each ground is | **No.** `venue.latitude`/`longitude` exist (T-010) but are empty: the licensed feed gives a ground's name and city only, and football-data carries no ground at all | **N-1**, not a task |
| League stakes | the table before the match | Yes: computed from stored results (D-038). Qualification and relegation places are **not** stored | T-1120 on a zone-free rule; zones are **N-2** |
| Knockout legs | the tie's first leg | Our records only (stage, round, legs; the bracket's `tieOf`, T-630). football-data has no cups | T-1121; the sample is small and the entry says how small |
| Neutral ground | the match's ground and each club's usual one | Our records: `fixture` carries its venue | T-1122 |
| Manager changes | the coach on each line-up | Our records: `fixture_participant.coach_id` (D-119), 2025/26 onward and the past seasons as the backlog loads them. football-data has no coaches | T-1130, T-1131; **waits for data** |
| Head-to-head | past meetings | Yes: decades of football-data | T-1140 |
| Home advantage by team | home and away results | Yes | T-1141 |

**Nothing here buys, opens an account, adds a provider request or holds a
secret.** Every task is agent-buildable under the standing delegation of
2026-09-26, with a revisable decision entry, except T-1160, which is applied
only on the maintainer's answer to Phase 9's N-7. No input reads a new source:
travel, league zones and coaching spells from the feed are questions (N-1,
N-2, N-4), because each needs a new source, a licence or the request budget.

**The three prediction products stay separate** (rule 6). Nothing in E111 to
E115 touches the founder's analysis or the community consensus, and no
candidate is ever shown beside the published version.

---

## Exit criteria

- One command backtests an input against the published version and the
  current candidate, on the football-data divisions and our records, and
  says whether it passed D-139's bar.
- Several candidates run in shadow at once, each with its own pre-kick-off
  record, and 0.5.0's count toward T-535 is not reset by any of them.
- Rest and congestion, league stakes, knockout legs, neutral grounds,
  head-to-head and home advantage by team each have a decision entry with a
  backtest verdict. Manager changes have one once the line-ups are loaded.
- The Power Index's rest component is validated or its weight changed by a
  new formula version, and competition context is measured, so a covered
  match can reach 100% completeness less travel.
- The inputs that passed are in one next candidate, in shadow, and its
  promotion is a task with the numbers, not a switch.
- Featured matches lead the homepage while an editor's window lasts; the
  competitions' order and a language's hold are set in the console, audited;
  a member's rating history and privileges are on one console page; and,
  on the maintainer's yes, rating thresholds are versioned rows.

---

## E110 — Measuring an input

*Agent-doable. The foundation every input task stands on.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1100 | This plan | — | `04-tasks-phase-11.md`, the roadmap's Phase 11 section and what remains after it merged |
| `[ ]` T-1101 | One harness for an input's backtest: `python -m fmip_model.backtest.inputs --input <name> --divisions … --from … --to …` walks forward with the same fit dates as `backtest.elo_prior`, and scores, on the same matches, the published version, the current candidate, and the current candidate with the input. Report under `reports/<candidate>/`. D-139 | T-062, T-922 | D-139 states the bar before any input is run: mean log loss better than the current candidate with a paired bootstrap interval that excludes zero, calibration error not worse, and not worse in more than a stated share of divisions. Football-data divisions and our records' divisions are reported separately. A test on a simulated season with a planted effect passes the bar and one without fails it. Never sees a match after its fit date |
| `[ ]` T-1102 | Several candidates in shadow. `candidate.json` becomes a directory of named candidates; the service answers `/forecast/candidate/:name` and lists them; the API writes one shadow forecast per candidate beside every published one, each numbered within its own model version. D-140; migration `1765100000000` | T-531 | Published numbering is unchanged and has no gap. 0.5.0's stored shadow rows and its count toward T-535 are untouched. A failing candidate is logged and the others and the published version stand. Every product read stays `role = 'published'` (D-082), proved by the existing tests. The evaluation records are written per candidate |
| `[ ]` T-1103 | Candidates' records in the console: for each candidate in shadow, its pre-kick-off forecasts counted toward 300, and its log loss and Brier against the published version on the same matches, per competition, from the stored evaluations (T-066). `admin` only | T-1102 | Read-only. Only forecasts made before kick-off count (D-031). A candidate with fewer than 300 says how many it has, never a verdict. A member gets `forbidden` (D-108) |

## E111 — Rest and fixture congestion

*Agent-doable. Travel is N-1.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1110 | Rest and congestion as an input: days since each side's previous match and its matches in the last 14 days, from `training.match` and our records (clubs joined through `team_alias`, D-080), moving the expected goals by fitted coefficients, as the line-up term does (D-086). Backtested with T-1101. D-141 | T-1101 | Training and serving read the same rows, so a forecast never sees a wider schedule than its fit did. A club with no earlier match in the store has no rest value and the term is not applied, never a default. The entry states that domestic cups we do not carry are invisible. Verdict recorded either way |
| `[ ]` T-1111 | The Power Index's rest and schedule component validated: `power-index-backtest.mjs` reads the stored schedule, so rest is scored with the other components, and `12-power-index.md` loses "rest is excluded". D-142 | T-113 | The bar is unchanged (beat the blueprint's weights by more than 0.01 held-out log loss). A changed weight is a new `power-index@x.y.z`, never an edit. The component stays `limited` and says travel is not modelled until N-1 is answered |

## E112 — Competition context

*Agent-doable. League zones are N-2.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1120 | League stakes: before a league match, whether each side's position is locked -- no side above can be caught and no side below can catch it with the matches left -- from the table computed from stored results (D-038). A fitted term for "locked" sides, backtested with T-1101. D-143 | T-1101 | Needs no qualification or relegation places. The number of matches left is from the stored fixture list, and a season whose list is incomplete gives no value. A test on a constructed table for each case. Verdict recorded, with how many matches in the window had a locked side |
| `[ ]` T-1121 | The second leg of a tie: the first leg's score as an input to the second, from our records' cup matches (the bracket's pairing, T-630). Backtested with T-1101 on our records only. D-144 | T-1101, T-533 | The entry states the number of second legs in the sample. Below the bar's minimum, no candidate carries it and the entry says why. A single-leg round and a tie decided on the first leg's own day give no value |
| `[ ]` T-1122 | Neutral ground: a match whose stored venue is neither club's usual ground (the ground of most of its home league matches that season) is fitted without home advantage. A candidate on our records' finals and neutral matches. D-145 | T-1101 | A match with no stored venue, or a club with no usual ground, keeps today's home advantage and says so in its factors. A ground shared by two clubs is either club's usual ground. The sample is stated |
| `[ ]` T-1123 | The Power Index's competition context (5%), measured: a side's stake as a position among the division's teams, from T-1120's rule and, in a cup, the tie's state from T-1121's. A new `power-index@x.y.z`, validated as T-1111 is. D-146 | T-1120, T-1121, T-1111 | Rule 3: a match where nothing can be read leaves the component absent and its weight redistributed, as today. `12-power-index.md` updated. A covered match can then reach 100% completeness less travel |

## E113 — Manager changes

*Agent-doable. Waits for the past seasons' line-ups, as T-923 does.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1130 | Coach changes read from stored line-ups: the model's records loader carries each side's named coach (`fixture_participant.coach_id`), and a change is recorded where two consecutive line-ups of a club both name a coach and the coaches differ. Matches under the current coach are counted from their first stored line-up. D-147 | T-512, T-944 | Rule 1: a coach is a person id, never a name. A line-up that names no coach is a gap, never a change and never a carry-forward (D-119). A caretaker is a change like any other, and the entry says so. A test for a gap, a return and a change |
| `[ ]` T-1131 | A new coach as an input: a decaying term over the first matches under a new coach, fitted and backtested with T-1101 on our records' divisions. **Waits for data** (the past seasons' line-ups). D-147 | T-1130, T-1101 | Blueprint 6.3: only "where they improve prediction quality". The entry states the number of changes in the sample; below the bar's minimum, no candidate carries it and the entry says so. football-data divisions are not scored (they hold no coaches) |

## E114 — Head-to-head and home advantage by team

*Agent-doable. Measurable today on decades of football-data.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1140 | Head-to-head after current strength: the residual of past meetings, time-weighted, as a candidate term, backtested with T-1101 on the football-data divisions and our records. D-148 | T-1101 | Blueprint 6.3's own condition: the candidate carries it only if it passes D-139's bar after current strength is in the fit. The entry records the numbers either way. What users see (`head_to_head`, T-033) is unchanged |
| `[ ]` T-1141 | Home advantage by team: each club's home deviation, penalised toward its division's, fitted with the rest of the model and backtested with T-1101. D-149 | T-1101 | A club with few home matches in the window stays at its division's value. The penalty is chosen on one window and scored once on the next, as T-533 was. Verdict recorded either way |

## E115 — The next candidate

*Agent-doable. Promotion is a task with a decision entry, never automatic.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1150 | The next candidate: the inputs that passed their bars, together in one version (`dixon-coles-elo@0.6.0`, or the next number free), backtested together with T-1101 because inputs overlap, and put in shadow beside 0.5.0 through T-1102. The forecast's leading factors name each input it carries. D-150 | T-1102, and each of T-1110, T-1120, T-1121, T-1122, T-1140, T-1141 decided | Only inputs whose own entry says "passed". If together they fail the bar, the entry says which input is dropped and why. The service's contract examples regenerated by its tests. 0.5.0 keeps running in shadow |
| `[ ]` T-1151 | Promotion of the next candidate, or not, after at least 300 pre-kick-off forecasts, on T-1103's numbers. **(match days)** D-151 | T-1150, T-1103, T-535 | As T-535 (D-082): a decision entry with the numbers; stored forecasts keep their version (rule 5). A promotion updates the public model notes and `12-power-index.md` where they describe the inputs. T-535 decides 0.5.0 first; this task never promotes past it |

## E116 — The console's configuration

*Agent-doable, except T-1160 (the maintainer's answer to Phase 9's N-7).
Every write takes a reason and is an `audit_log` row with the previous value
(rule 10, D-046).*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-1160 | **Needs the maintainer's yes (Phase 9's N-7).** Rating thresholds as versioned rows: the provisional and established counts, the contributor eligibility thresholds (`ELIGIBILITY_V1`, D-059) and T-1031's sustained period, set by an administrator from the console as a new version with a reason and a start. The formula changes only by a new formula version, never here. D-152; migration `1765110000000` | T-053, T-250, T-1031 | Rule 8: a rating and an eligibility are recomputable from stored predictions, settlements and the threshold version in force when they were computed. The first version holds today's constants exactly, so nothing changes on the day it ships. No row is edited; a new one supersedes |
| `[ ]` T-1161 | Featured matches on the homepage: an editor features a match for a window, with a note, and may clear it early with a reason. The homepage's matches and "the model's view" list featured matches first, after a member's own favourites. D-153; migration `1765120000000` | T-526, T-942 | Audited on feature and clear. An expired feature is gone on the next render. A guest sees them. With nothing featured the homepage is as today. The founder's analysis and the community are unaffected (rule 6). A member gets `forbidden` |
| `[ ]` T-1162 | The competitions' order in the console: `competition.display_order` (T-504) set from a page instead of `catalog.mjs --set-order`, with a reason. D-154 | T-504 | The same audited write the script makes, and the script keeps working. The scores page and the homepage read the new order on the next render. `14-maintainer.md` says where it is now set |
| `[ ]` T-1163 | Holding back a language: an administrator may hold back a locale that `isShippable` offers, with a reason, and release it. A held locale is not offered by the picker or the first run, and its URLs answer as an unoffered locale does today. D-155; migration `1765130000000` | T-302, T-306 | Nothing can offer a locale that `isShippable` refuses. A member whose stored language is held is shown the default and told why, once. The `/admin` language rows show the hold. The catalogue files are untouched (the words are the translators') |
| `[ ]` T-1164 | A member's page in the console: account status, rating history and tier, settlements, Career Points, eligibility and grants, sanctions and flags, and the audit rows about them, one page reached from the member search. Links to the existing audited actions; no new write | T-070, T-250, T-1031 | Blueprint 16. `admin` only; a moderator sees what the reports queue already shows them. A deleted account shows its tombstone (D-094). Nothing is shown that the API does not already give an administrator |
| `[ ]` T-1165 | Observability for the new surfaces: the System page shows each candidate in shadow and its last failure, and the watchdog raises an alert when a candidate has failed on every forecast of a day | T-1102, T-801, T-804 | An alert is a transition (D-095). A candidate that has never answered says so rather than showing zero |

---

## Needs a decision

None of these is a task yet. Each needs a decision entry first. The note
says whose.

1. **N-1 — Travel (6.3, 6.1).** `venue.latitude` and `longitude` exist and
   are empty. The licensed feed gives a ground's name and city only, and
   football-data carries no ground, so travel can be measured only on our
   records, from the day grounds are placed. Three ways to place about 300
   grounds: an open geocoder or open dataset (OpenStreetMap is ODbL,
   Wikidata CC0), which is enrichment under D-014 with its own terms; an
   editor entering each ground by hand; or a proxy that needs nothing -- a
   cross-border match (the clubs' countries differ), which reaches only the
   European cups. *The maintainer's* (third-party terms). Until then the
   Power Index says travel is not modelled.
2. **N-2 — League zones (6.3, 5.1).** Qualification and relegation places
   are not stored, so T-1120's stakes are zone-free. The feed's standings
   carry a description per place, but tables are computed from results
   (D-038) and reading standings spends the daily request budget. A committed
   list per competition and season, from each competition's published
   regulations, is the other way. Either would also let the tables show the
   places. *The maintainer's* (request budget, and whether a hand-kept list
   is acceptable on a table the licensed feed otherwise supplies).
3. **N-3 — Territory settings (16).** A reader already chooses a territory,
   and editors declare viewing coverage per territory (T-313). What an
   administrator would set per territory is not written anywhere: a default
   language proposed to a guest, or the territories offered first. Inferring
   a territory from Cloudflare's country header is excluded: T-312 says a
   territory is "never silently inferred". *The maintainer's* (product
   behaviour).
4. **N-4 — Coaching spells from the feed.** The licensed feed has a coaches
   endpoint with each coach's career, which would date appointments exactly
   and separate a caretaker from an appointment. T-1130 reads only the
   line-ups we already store (D-119). Reading it spends the request budget.
   *The maintainer's* (request budget and terms).
5. **N-5 — The share of a season an input must cover.** Rest reads league
   matches only in the football-data history, and our records cover the
   past seasons only as the backlog loads them. D-139 proposes that an input
   is judged only on the matches where it can be read, and that the entry
   states that share. Whether a small share is enough to promote an input is
   *the maintainer's*, or is left to D-139 under the standing delegation if
   the maintainer prefers.

**Still open from earlier phases, not repeated:** Phase 8's N-1 (T-806), N-2,
N-4, N-5 (predicted line-ups, which the `lineups_predicted` version waits on)
and N-6; Phase 9's N-3 to N-7 (N-4, Club Elo, and N-7, which gates T-1160);
Phase 10's N-1 to N-8.

**Not in Phase 11, by earlier decision:** replacing an absent player with a
guessed substitute (D-081); machine translation of anyone's words (D-061,
13.2); a tracing vendor (D-044); a native app (D-084).

---

## What blocks what

| Tasks | Blocked on | Who |
|---|---|---|
| T-1101, T-1102, T-1130, T-1161, T-1162, T-1163, T-1164 | nothing | agent |
| T-1103, T-1165 | T-1102 | agent |
| T-1110, T-1120, T-1121, T-1122, T-1140, T-1141 | T-1101 | agent |
| T-1111 | nothing (T-113's backtest exists) | agent |
| T-1123 | T-1120, T-1121, T-1111 | agent |
| T-1131 | T-1130, T-1101, the past seasons' line-ups | agent, **waits for data** |
| T-1150 | T-1102 and the input tasks' verdicts | agent |
| T-1151 | T-1150, T-1103, T-535, 300 pre-kick-off forecasts | agent, on match days |
| T-1160 | Phase 9's N-7 | **maintainer** to answer, then agent |
| Travel, league zones, territory settings, coaching spells | N-1 to N-4 | **maintainer** |

**Start with T-1101 and T-1102.** Every input task is judged by the first,
and none can reach a shadow without the second. The input tasks are
independent of each other and can run in parallel once T-1101 is merged. E116
is independent of the model epics.
