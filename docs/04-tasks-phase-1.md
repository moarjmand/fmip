# Phase 0 + Phase 1 task backlog

**How to use this file.** Say "do T-012" and the agent reads this entry, the
files named in `03-project-map.md`, and nothing else. One task = one branch =
one PR. Check the box when the acceptance criteria pass in CI.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done

**Dependency rule.** Do not start a task whose dependencies are unchecked.

---

## E0 — Foundation

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-001 | Create GitHub repo; monorepo skeleton (pnpm workspaces, Turborepo, shared tsconfig/eslint/prettier) | — | `pnpm install && pnpm build` succeeds on a clean clone |
| `[x]` T-002 | `docker-compose.yml` with Postgres + Redis; `.env.example` | T-001 | `docker compose up` gives a reachable DB and Redis |
| `[x]` T-003 | CI: typecheck, lint, unit tests, build, on every PR | T-001 | A PR with a type error is blocked |
| `[x]` T-004 | `apps/api` NestJS skeleton with Fastify adapter, health endpoint, empty module folders | T-002 | `/health` returns 200 in the compose stack |
| `[x]` T-005 | `apps/web` Next.js skeleton, Tailwind, `[locale]` routing, logical-properties lint rule | T-001 | `/en` renders; a `margin-left` in layout CSS fails lint |
| `[x]` T-006 | `packages/contracts` with a first shared type; wired into web and api | T-004, T-005 | Changing a contract type breaks the build in both apps |
| `[x]` T-007 | RTL pseudo-locale + Playwright visual check | T-005 | `/x-rtl` renders mirrored; CI fails if layout breaks |
| `[x]` T-008 | `packages/db` with migration tooling and the first migration | T-002 | Migrations run up and down cleanly |
| `[x]` T-009 | Containerise `apps/web`: Dockerfile + compose service | T-005 | `docker compose up` serves `/en` from the stack |

**T-002, T-004 and T-009 closed together.** The stack was verified on the
maintainer's Windows machine on 2026-09-09 with `bash scripts/check-dev-stack.sh`:
Postgres, Redis, `GET /health` and `/en` all answered from the compose stack,
`/x-rtl` was served with `dir="rtl"`, and `docker compose ps` showed all four
services healthy. The Dockerfile emulation described in `06-session-handoff.md`
matched the real build.

**T-009 was added, not inherited.** Containerising the web app belonged to no
task, but the E0 exit criterion below requires it. Folding it into T-039 (SEO)
or T-082 (PWA) would have let E0 close over a gap.

**E0 exit:** clean clone → `docker compose up` → working local stack, green CI.

---

## E1 — Canonical data model

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-010 | Schema: country, competition, season, stage, team, venue, person, player_spell | T-008 | Migration applies; seed data loads |
| `[x]` T-011 | Schema: fixture, participant, score, period, incident, lineup, fixture_stat | T-010 | Foreign keys enforced; no name-based keys anywhere |
| `[x]` T-012 | Schema: provider_mapping, coverage_profile, ingest_run | T-010 | Unique constraint on (provider, external_id, entity_type) |
| `[x]` T-013 | Entity resolver service: external id → internal uuid, with unresolved queue | T-012 | Unknown entity is queued, never silently created twice |

**T-010 verified on 2026-09-10** against the compose Postgres on the
maintainer's machine, twice over. First through `psql` in the container: the up
section applied on top of the bootstrap migration, the seed loaded twice
without change (idempotent), nine deliberately invalid rows were each rejected
by the named constraint, the down section left `public` with no tables, and up
plus seed ran again cleanly. Then with the real runner once the host could
install packages (`scripts/dev-proxy.sh`, see `06-session-handoff.md`):
`pnpm --filter @fmip/db migrate:up` recorded both migrations in
`schema_migration`, `pnpm --filter @fmip/db seed` loaded the fixtures,
`migrate:down` removed the eight tables and the ledger row, and up plus seed
ran again. `format:check`, `lint`, `typecheck` and `test` passed on the host
as well as in CI. Seed rows are development fixtures with fixed UUIDs; the
runner refuses `NODE_ENV=production`.

**T-011 verified on 2026-09-10** with the real runner against the compose
Postgres: `migrate:up` added `1757600000000_fixtures` to the ledger, the seed
(now with `002_fixtures.sql`, one finished match) loaded twice unchanged, and
eleven invalid rows were rejected by name: a second home side, a live minute on
a finished fixture, a negative score, a duplicate score kind, a substitution
without the incoming player, a card without a player, an unmodelled statistic
metric, a percentage over 100, a lineup pointing at a participant that does
not exist, a malformed formation, and a second captain on one side. Deleting
the fixture cascaded to every child table; `migrate:down` removed the seven
tables; up plus seed ran again. Every key is a UUID; no table is keyed by a
name.

**T-012 verified on 2026-09-10** with the real runner: `migrate:up` added
`1757700000000_ingestion`, seed `003` loaded twice unchanged. The acceptance
constraint held: a second `('api_football', '40', 'team')` row was rejected by
`provider_mapping_unique`, while the same id under another provider and a
second id for the same team under one provider were both accepted. Also
rejected by name: a blank external id, an unknown provider, entity type,
coverage state or job, a supplied coverage state with no provider, a second
coverage row for one module, a run marked running with a finish time, a failed
run with no error, and a second running run for one `(provider, job)`;
finishing the first run then allowed a new one. `migrate:down` removed the
three tables; up plus seed ran again.

**T-013 verified on 2026-09-10.** The resolver lives in
`apps/api/src/modules/ingestion/` as pure logic over a store port, with the
SQL in a Postgres store and the shared `pg` pool from
`src/database/database.module.ts` (D-025). Unit tests with an in-memory store
prove the acceptance criterion: the same unknown id resolved three times is one
queue row with `seen_count` 3, nothing is created, and the store has no way to
create an entity at all. Integration tests against the compose Postgres
(`DATABASE_URL` set) resolved the seeded API-Football id 40 to Liverpool,
queued an unknown id once across two sightings, refused to link to a UUID that
is not a team, linked, resolved, audited the queue row with actor and target,
and refused a second link to another team. In the schema, a resolved row
without actor, time and target, a pending row carrying a target, an ignored
row without an actor, and a duplicate `(provider, entity_type, external_id)`
were all rejected by name. `typecheck`, `lint` and `test` pass on the host.
**Bigger than a schema task:** it touches the API's database wiring, so it is
split into two commits, wiring then resolver, in one PR.

---

## E2 — Ingestion and the provider bake-off

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-020 | Adapter contract interface + recorded-fixture contract test harness | T-011 | A non-conforming adapter fails tests |
| `[x]` T-021 | API-Football adapter (free tier) | T-020 | Contract tests pass against recorded responses |
| `[x]` T-022 | football-data.org adapter (free tier) | T-020 | Same |
| `[x]` T-023 | Highlightly adapter (free tier) | T-020 | Same |
| `[x]` T-024 | Bake-off harness: run all three over the same fixtures, log latency/completeness/errors | T-021, T-022, T-023 | Produces `docs/05-data-providers.md` results table automatically |
| `[ ]` T-025 | **Decision gate:** review bake-off, pick provider, subscribe to paid tier | T-024 | New entry in `00-decisions.md` |
| `[ ]` T-026 | Scheduled ingestion jobs (BullMQ): fixtures, live, lineups, standings, post-match | T-025 | Jobs are idempotent; a replay changes nothing |
| `[ ]` T-027 | Coverage profile computation + freshness tracking | T-026 | Every module payload carries a coverage state |

**T-020 verified on 2026-09-10.** `packages/ingestion` holds the normalised
model, the `ProviderAdapter` contract and `checkAdapterContract`. The
acceptance criterion is proved by the harness's own tests: a conforming fake
adapter returns no problems, and seven deliberately broken adapters each fail
with a named problem: a provider status leaking through with a clock on a
finished match and a negative score; a finished fixture without a full-time
score (faked coverage); a request to a URL absent from the recording; a thrown
error instead of a returned result; a misreported request count; a manifest
declaring a scraped source on the critical path (D-014); and success where the
recording says the call must fail. An adapter with no recordings is reported
as unverified, not passed. 14 tests; `typecheck` and `lint` pass.

**T-021 verified on 2026-09-10.** `packages/ingestion/src/adapters/api-football/`
is the first adapter, written against the free plan and verified by six
recordings made with the maintainer's key through `scripts/record.mjs`
(Premier League 2023/24, the newest season the plan serves): the opening
weekend (10 fixtures, all `finished` with half- and full-time scores, venue,
referee, `Regular Season` stage), the final table (20 rows, form strings,
`won + drawn + lost = played`), Burnley v Manchester City's lineup (20 + 20
players, formations, coaches, captains J. Cullen and K. De Bruyne read from
the per-player block, matched to home/away by team id), its detail (15
incidents across goal, substitution, red card and VAR with the side by team
id; 28 statistics including expected goals, with `55%` parsed to 55 and null
metrics absent; two periods), everything in play at recording time through
`fixtures?live=all` (25 matches), and a season the plan refuses (`2025/26` →
`unsupported`, "try from 2022 to 2024"). The first attempt at live-by-ids was
also recorded honestly — "Free plans do not have access to the Ids parameter"
— and the adapter was redesigned around `live=all` filtered to the requested
ids. **Contract tests pass against recorded responses:** `checkAdapterContract`
returns no problems over all six scenarios; 8 mapping-rule tests (statuses,
stage kinds, statistic parsing, no clock on a finished match, no invented
full-time score, incidents). 22 tests in the package; typecheck, lint, build.
The key never appears in a recording: it travels in `x-apisports-key` and the
recorder scans its output. T-022 and T-023 follow the same shape.

**T-022 verified on 2026-09-10.** `packages/ingestion/src/adapters/football-data-org/`
follows the API-Football shape (one request per call, `Transport` injected,
failure as a value) against v4 on the free tier, and is verified by six
recordings of the same Premier League 2023/24 fixtures as the API-Football
set, so the bake-off compares like with like: the opening weekend (10
`finished` fixtures with half- and full-time scores, `Matchday 1`, referee
by id, `lastUpdated` as the freshness), the final table (20 rows from the
`TOTAL` table only), Burnley v Manchester City's lineup (`unsupported`: the
free tier's match resource carries no lineups, bookings or substitutions at
all), its detail (the fixture, empty incident and statistic lists, null
lineup — nothing invented), the same two matches through `/matches?ids=`
(works on this tier, unlike API-Football's), and a competition the tier
refuses (Europa League → 403 → `unsupported`; the Championship turned out to
be served). Two provider facts were learned live and written into `map.ts`
as rules with tests: `form` is newest first (`W,D,W,D,L` for Liverpool,
whose last five were L D W D W by their own match list), so it is reversed;
and the ninety-minute score comes from `regularTime` when a match went to
extra time, or is `null` when the provider did not split it. **Contract tests
pass against recorded responses:** no problems over all six scenarios; 6
mapping-rule tests. 28 tests in the package; typecheck, lint, build. The key
travels in `X-Auth-Token` and never appears in a recording.

**T-023 verified on 2026-09-10.** `packages/ingestion/src/adapters/highlightly/`
completes the set, against `sports.highlightly.net/football` on the BASIC
plan, which insists on the RapidAPI-style headers even off RapidAPI. Six
recordings of the same Premier League 2023/24 fixtures (league 33973): the
opening weekend (10 fixtures, **four requests** — one per day of the range,
reported as such; ranges beyond 14 days are refused), the final table (20
rows, no form: the provider has none), Burnley v Manchester City's lineup
(`unsupported`: empty `initialLineup` and formation "Unknown" on this plan),
its detail (14 incidents — goals, substitutions with the player coming on as
the related player, a red card at 90+4 — and 22 statistics with possession
`0.34` read as 34%), the live call for two ids of which one is unknown (two
requests, one fixture; the API has no batch lookup), and a detail of an
unknown id (an empty array with 200 → `malformed`). Half-time scores do not
exist on this provider and are `null`, never derived. **Contract tests pass
against recorded responses:** no problems over all six scenarios; 6
mapping-rule tests (free-text states, string scores, `90+4`, day counting,
no invented half-time score, substitutes, possession). 36 tests in the
package; typecheck, lint, build. All three adapters now answer the same five
calls over the same fixtures, which is what T-024 needs.

**T-024 verified on 2026-09-10.** `packages/ingestion/src/bakeoff/` runs the
three adapters over the same competitions and dates and measures them:
calls that succeeded, error kinds, requests consumed (quota efficiency),
response time per request, field completeness per module (optional
normalised fields filled over fields that could have been filled), and
disagreements (the same match, matched across providers by kick-off minute and
normalised team name, described with a different status or score). Goal
latency, lineup lead time and lineup accuracy need the polling job of T-026
against a current season and are listed as **not measured** rather than
estimated. **Produces the results table automatically:** `node
scripts/bakeoff.mjs --live` writes the table between two markers in
`docs/05-data-providers.md` and the full result to
`packages/ingestion/bakeoff/<timestamp>-live.json`; `--recorded` runs the
same harness over the committed recordings without a network, which is what
the package tests do (41 tests, typecheck, lint). The first live run
(2026-09-10 19:40 UTC, 2023/24 opening weekends of the five target leagues,
paced to each plan's per-minute quota): API-Football 35/35 calls ok, fixture
fields 90%, lineup 99%, detail 95%, mean 1,140 ms; football-data.org 25/35 ok
(10 `unsupported`, all `getLineup`: lineups are paid on TIER_ONE), fixture
70%, detail 25%, 753 ms; Highlightly 5/7 ok (2 `unsupported`), fixture 40%,
detail 57%, 388 ms — Highlightly ran on the Premier League only because its
league ids for the other four are not yet in the plan. No disagreements among
the matched fixtures. One run is one day's snapshot; the protocol's seven days
are seven runs, and T-025 reads them together. The second run (2026-09-11 05:04 UTC) added the Highlightly ids of the other four leagues: Highlightly 25/35 ok with 50 requests (its fixture list costs one request per day; every `getLineup` `unsupported` on BASIC), fixture 40%, detail 57%; API-Football and football-data.org repeated day one exactly; again no disagreements.

---

## E3 — Public read experience

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-030 | Scores API: date range, filters, grouping, favourites | T-011, T-042 (was T-026, D-033) | Yesterday / today / next five days all correct in user timezone |
| `[x]` T-031 | Scores page | T-030 | Matches blueprint 4.1 card fields, or labels them unsupported |
| `[x]` T-032 | SSE gateway + client subscription with snapshot-on-reconnect | T-011 (was T-026, D-033/D-034) | Score changes appear without refresh; staleness is visible |
| `[x]` T-033 | Match centre API | T-011, T-012 (was T-027, D-033) | Header, timeline, stats, form, H2H, coverage states |
| `[x]` T-034 | Match centre page | T-033, T-032 | Works before, during and after a match |
| `[ ]` T-035 | Competition page (table, fixtures, results, leaders) | T-030 | Season selector works; links resolve |
| `[ ]` T-036 | Team page | T-035 | Squad, fixtures, form, competition context |
| `[ ]` T-037 | Player page | T-036 | Every lineup/squad name links here correctly |
| `[ ]` T-038 | Basic entity search | T-037 | Aliases and common spellings match |
| `[ ]` T-039 | SEO surface: metadata, canonical URLs, sitemap, structured data | T-034 | Rendered HTML contains full content without JS |

**T-030 verified on 2026-09-11.** `GET /scores` (the `fixtures` boundary,
`apps/api/src/modules/fixtures/`) takes `from`, `to`, `tz`, `live`,
`favourites`, `country`, `competition`, `stage`, `gender` and `age`, defaults to
today in the given zone, caps the range at 14 days, and names every invalid
parameter at once (400). **Yesterday / today / next five days all correct in
user timezone:** the range is converted to instants by Postgres in the user's
zone, and the HTTP suite proves the boundary with a 23:30 UTC kick-off that is
5 January for London and 6 January for Tehran, then serves a seven-day window
grouped by country and competition. Each card carries teams, score by kind,
status and live minute, competition, stage, round and leg, red-card counts,
the goals, red cards and VAR decisions, venue, the season's scores-module
coverage state (`limited` when none is recorded) and `last_updated_at` (rules
3 and 4). Forecast summary, community totals and viewing availability are
absent from the shape, not empty; the page (T-031) labels them. With a
session, favourite teams and competitions are pinned above the list (ordered
by the profile boundary's `compareByFavourites`), followed ones lift their
group, and `favourites=1` narrows to follows; without a session it is 401.
Filters by live, country and competition proved on the same data. Data: rows
inserted by the test (D-033), not a provider. 125 API tests, typecheck, lint.

**T-031 verified on 2026-09-11.** `/[locale]/scores` renders `GET /scores` for
one day: the strip is yesterday, today and the next five days in the viewer's
zone (`?tz=`, else the signed-in member's `timezone`, else UTC), and the day,
zone and filters survive every link. **Matches blueprint 4.1 card fields, or
labels them unsupported:** each card shows teams, score, status and live
clock; competition, stage, round, leg and aggregate; red-card marks and the
goal / red-card / VAR incidents; venue and kick-off in the viewer's zone; the
scores coverage state as a label. The three fields the platform does not have
yet are labelled on every card ("Forecast: not on this page yet", "Community:
unsupported", "Watch: unsupported") rather than left blank. Smoke test against
the running API and the seeded database: `/en/scores?date=2025-01-05` rendered
the seeded Liverpool 2–2 Manchester United as `FT`, one card, "Times in UTC".
With the API stopped the page shows the unreachable notice and no cards; the
Playwright suite (`tests/e2e/scores.spec.ts`) asserts that, the seven-link
strip with "Today" current, state carried in links, and the RTL mirror, and
runs in CI's E2E job. 22 web unit tests, typecheck, lint, stylelint.

**T-033 verified on 2026-09-11.** `GET /fixtures/:id` (the `fixtures` boundary)
serves the match centre as far as our own tables reach, each module wrapped
in `Covered` (blueprint 4.3). **Header:** teams with formation and coach,
score by kind, status and live minute, competition, season, stage, round,
group, leg, venue and neutral flag, referee, attendance, the playing periods
with real start and end times, and `last_updated_at` as the newest change
across fixture, participants, scores, periods, incidents, line-ups and
statistics. **Timeline:** every incident in sequence, its side decided by the
credited participant, player and related player (assist or substitute)
named. **Stats:** one row per metric with both sides; a side the provider left
out is `null`, never zero. **Line-ups:** both sides with role, shirt, position
and captain; half a line-up is `not_supplied`. **Form:** each team's last five
competitive finished matches before this one (friendlies excluded), newest
first, with W/D/L and venue side; **H2H:** their recent finished meetings.
**Coverage states:** the season's declared profile per module is returned as
is, and each module's own state is decided with it: rows present take the
declared state, or `limited` when the profile denied them; rows absent are
`not_supplied` (or `delayed` when declared so); form and head-to-head grade
our own history (`available` at five, `limited` below, `not_supplied` at
none). The HTTP suite builds a five-fixture cluster on the seeded catalog and
checks each module, plus 404 for unknown and malformed ids. Data: test rows
(D-033). 6 unit tests for the coverage rules. 134 API tests, typecheck, lint.

**T-032 verified on 2026-09-11.** The gateway is `GET /scores/stream` and
`GET /fixtures/:id/stream` in the `fixtures` boundary, server-sent events
(D-034). The change source is Postgres itself: migration
`..._fixture-change-notify.sql` raises `NOTIFY fixture_change` after any write
to a fixture, its participants, scores, periods, incidents, line-ups or
statistics, and the API's one `LISTEN` connection fans the notifications out to
every open stream. **Score changes appear without refresh:** the HTTP suite
listens on a real port, reads a first `snapshot` off the wire, updates a score
and the live minute in the database, and reads the next `snapshot` carrying
1–0 and minute 23 — no poll, no refresh; a burst of writes is debounced into
one push. **Staleness is visible:** every event carries `id` = the time it was
true, a `heartbeat` goes out every 15 s, a broken feed sends `stale` instead of
silence, and the first event on every (re)connection is a full snapshot, so a
reconnecting client can never keep an old card (snapshot-on-reconnect). On the
web side the page renders the server snapshot, then `live-scores.tsx`
subscribes through the web app's own `/api/scores/stream` (D-027) and shows
one freshness line: connecting, "Live · updated hh:mm:ss", "Stale · last
update …" after 45 s without a heartbeat, or "Live updates unavailable" when
no picture ever arrived; the proxy answers 503 with a JSON error when the API
is unreachable, which Playwright checks along with the page. Data: test rows
(D-033). 3 gateway tests on the wire, 5 SSE unit tests, 6 freshness unit
tests; typecheck, lint, Prettier.

**T-034 verified on 2026-09-11.** `/[locale]/match/[id]` renders `GET
/fixtures/:id` through `MatchCentreView`: header with teams, score, status or
live clock, competition, season, stage, round, group, leg, half-time,
aggregate and penalty scores, kick-off and venue in the viewer's zone,
referee, attendance and the last data update; then timeline, statistics,
line-ups, recent form, head-to-head, the season's coverage per module, and
"Not on this page yet" naming the nine blueprint 4.2 modules that are not
built (forecast arrives with T-065, competition context with T-035, the rest
unsupported). Every module carries its coverage state beside its name and
says "Not supplied for this match" or "Data for this module is delayed"
instead of an empty box. **Works before, during and after a match:** the
page renders whatever the payload holds — a scheduled match is header, form
and head-to-head; a live one adds the clock and timeline and stays current
through `LiveMatch` over `/api/fixtures/:id/stream` (T-032, full snapshot
replaced on every change, freshness line connecting / live / stale /
unavailable); a finished one is the full record. Smoke test against the
running API and the seeded database: the seeded Liverpool 2–2 Manchester
United rendered as `FT` with every module labelled `not supplied` (the seed
holds no incidents, line-ups or statistics for it), an unknown id answered
404, and the stream proxy delivered a first `snapshot` with an `id`. Scores
cards now link to the match page. Playwright: a malformed id is a 404 page;
without an API the page names the unreachable service and the proxy answers
503 JSON. 29 web unit tests, typecheck, lint, stylelint.

---

## E4 — Accounts

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-040 | Registration, email verification, login, sessions, password reset | T-004 | Security tests cover auth and session fixation |
| `[x]` T-041 | Profile page + privacy settings | T-040 | Public / friends-only / private all enforced server-side |
| `[x]` T-042 | Favourites and following (teams, competitions, players) | T-041 | Favourites affect the scores page ordering |

**T-040 verified on 2026-09-10.** API only: the web forms belong with the
profile page (T-041), since a member has nowhere to land before then. Twelve
security tests run against the real schema through the Nest application
(`identity.http.spec.ts`): register issues a 43-character HttpOnly SameSite=Lax
cookie and mails a link; duplicate username and e-mail are 409s naming the
field; an invalid body and an unknown country are 400s naming the field; a
garbage cookie is 401; wrong password and unknown account are byte-identical
401s with no cookie; login by username or e-mail mints a fresh session each
time; **session fixation**: a planted unknown cookie is never promoted, and an
attacker's own valid cookie sent with the victim's login stays the attacker's
while the victim gets a different one; logout revokes server-side and clears
the cookie; the verification link works once and is then spent; forgot-password
answers 202 identically for known and unknown addresses; reset rejects a weak
password, then changes the password, revokes every session, invalidates the
old password and spends the token; the database holds scrypt hashes and HMACs,
never a password or a cookie value. Unit tests cover scrypt, tokens, cookie
attributes, and validation. 43 API tests pass on the host; the same suite runs
in CI against the Postgres service.

**T-041 verified on 2026-09-10**, API and web. Server-side enforcement is
proved through HTTP with real sessions (`profile.http.spec.ts`): a fresh
member is public and empty; the owner edits bio, avatar and display name and a
stranger sees the result; edits without a session are 401 and a
`javascript:` avatar URL is a 400 naming the field; **private** returns only
username and display name to a signed-out viewer and to another member, while
the owner still sees everything, and the restricted body provably does not
contain the bio; **friends-only** behaves as private for everyone but the
owner, because friendships are Phase 2 and the oracle says no; prediction
history visibility is stored independently; unknown levels are 400. Also
`GET /countries` for the form. Web: register, login, forgot/reset password,
verify e-mail, profile and settings pages plus the header, all server-rendered
through server actions (D-027). Smoke-tested through the running web app:
register via API, then the profile page rendered the display name, the header
switched from Sign in / Register to Sign out with the session cookie, settings
redirected to login without one and rendered with one, the verification link
succeeded once and was spent on the second visit, and after setting the
profile private the page showed "This profile is private." 58 API and 15 web
tests pass; web `build` lists the new routes.

**T-042 verified on 2026-09-10.** `followed_entity` is one row per (member,
entity) with a `favourite` flag; a favourite is always followed. API:
`GET /me/following` (names joined per type, favourites first),
`PUT /me/following/:type/:id` with an optional `favourite`, `DELETE`, and
`GET /me/favourites`, the id sets a personalised view sorts with. The
acceptance criterion, "favourites affect the scores page ordering", is
delivered as `compareByFavourites` in the profile boundary's public surface:
a favourite team's fixture ranks above a favourite competition's, above a
followed team's, above a followed competition's, above the rest, with kick-off
breaking ties; a unit test sorts seven fixtures into exactly that order and
another shows kick-off order alone when nothing is followed. The scores API
(T-030) sorts with it and `favouriteIds()`; that is the one hook it must call.
HTTP tests with real sessions: follows a team, competition and person with
their current names; favourite sorts first and following twice is one row;
`/me/favourites` returns the sets and the profile shows the favourite team
names; unpin keeps the follow, unfollow removes it; unknown entity 404,
unknown type, bad id and bad flag 400 naming the field. Web: a Following
section on settings (pin, unpin, unfollow, and pickers over `GET /teams` and
`GET /competitions`) and favourite teams on the profile. 69 API tests pass.

---

## E5 — Predictions and reputation

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-050 | Prediction submission: outcome, optional score, confidence, reason tags | T-040, T-033 | Guests are blocked; versions are retained |
| `[x]` T-051 | Kick-off lock | T-050 | No write succeeds after kick-off, verified by clock skew test |
| `[x]` T-052 | Settlement job incl. void rules for postponed/abandoned | T-051 | Re-running settlement is idempotent |
| `[x]` T-053 | Performance Rating engine, formula in versioned config | T-052 | Rating recomputable from stored records alone |
| `[ ]` T-054 | Career Points | T-052 | Cannot by itself unlock privileges |
| `[ ]` T-055 | Leaderboards with minimum-sample filters | T-053 | A one-prediction account cannot top the board |
| `[ ]` T-056 | Prediction history UI | T-050 | Shows submitted version, timestamp, settlement |

**T-050 verified on 2026-09-11.** Migration `..._predictions.sql` adds
`user_prediction` (one per member per fixture) and `prediction_version`
(outcome, optional exact score that must agree with the outcome, confidence
1–5, up to three reason tags from a closed list, explanation up to 280
characters, `submitted_at`), immutable by the same `refuse_change()` trigger
as forecasts. `PUT /fixtures/:id/prediction` writes the next version inside
one transaction; `GET` returns the member's own prediction with every version,
`locks_at` and `locked`. **Guests are blocked:** both verbs answer 401 without
a session, and a member whose e-mail is not verified gets 403
`email_unverified` (blueprint 6.6: a verified account is mandatory). **Versions
are retained:** the HTTP suite submits a home 2–1 at confidence 4, then a
draw at confidence 2 with two tags and an explanation, and reads back both
versions in order under the same prediction id; UPDATE and DELETE on a version
are refused by the database (`23001`). Every invalid field is named at once
(400), an unknown fixture is 404, and a fixture that has kicked off is 409
`locked` (the database-level lock and the clock-skew proof are T-051). On
the match centre, "Your prediction" shows the form to a signed-in member of an
open match (with the version number after the first submission), the final
version read-only once locked, and a sign-in prompt to guests; the community
distribution and settlement are named as arriving with E5's later tasks,
never blended with the model forecast (rule 6). Data: test rows (D-033). 11
API tests, 4 web unit tests; typecheck, lint, stylelint, Prettier.

**T-051 verified on 2026-09-11.** Migration `..._prediction-lock.sql` adds
`refuse_prediction_after_kickoff()`, a `BEFORE INSERT` trigger on
`prediction_version` that reads the fixture's kick-off and raises SQLSTATE
`PL001` once `now()` — the database clock — has reached it. The API still
checks its own clock first (409 `locked`), and maps `PL001` to the same
answer, so a request that crosses the kick-off instant or a skewed server gets
the same 409 rather than a 500; the transaction rolls back whole, leaving no
`user_prediction` row behind. `locked` in the response now comes from the
database clock too. **No write succeeds after kick-off, verified by clock skew
test:** the HTTP suite (a) predicts a fixture 1.5 s before its kick-off, waits
past it and is refused on the next write with the first version intact; (b)
sets the API clock 70 s behind on a fixture that kicked off 10 s ago by the
database clock — the database refuses (409, nothing written); (c) sets the API
clock two hours ahead on a match still an hour away — the API refuses, and an
honest clock is accepted; (d) inserts a version directly into the table for a
match a day old — refused with `PL001`. Data: test rows (D-033). 15 API tests
in the predictions module; typecheck, lint, Prettier; migration down/up cycled
on the real database.

**T-052 verified on 2026-09-11.** Migration `..._settlement.sql` adds
`settlement_run` (one row per execution with what it wrote: settled, voided,
unchanged) and `settlement` (per prediction: the version that stood at
kick-off, `settled` with the full-time score, whether the outcome and the
exact score were right and whether a score was predicted at all, or `void`
with the reason), both immutable by trigger; one `settled` row per prediction
is enforced by a partial unique index, void rows may be superseded. The rules
are one pure module (`internal/settle.ts`): finished + full-time score →
settle; postponed, abandoned, cancelled, awarded → void with that reason
(blueprint 6.6: "void until a valid settlement rule is applied"); anything
else, including finished without a score, → nothing is written yet.
`SettlementService.settleFixture` writes the run and its rows in one
transaction; `settleDue` is the job's pass over every final fixture that still
owes a settlement (`POST /settlements/run`, admin, until T-026 wires it);
`GET /fixtures/:id/settlements` is the public aggregate and the member's own
prediction now carries `settlement`. **Re-running settlement is idempotent:**
the HTTP suite settles a 2–1 with two predictions (one exact, one changed
before kick-off so version 2 is judged) — run one writes 2, run two writes 0
and reports 2 unchanged, the table holds exactly two rows; a postponed match
is voided once (a second run writes nothing), and when the rearranged match is
finished 0–0 a `settled` row supersedes the void one with both rows kept;
UPDATE and DELETE on settlements and runs are refused (`23001`); guests and
members get 401/403, a live match 409. Data: test rows on Real Madrid v
Persepolis (D-033). 24 API tests in the predictions module (9 new), 6 unit
tests on the rules; typecheck, lint, Prettier; migration down/up cycled.

**T-053 verified on 2026-09-11.** The reputation boundary
(`apps/api/src/modules/reputation/`) computes the Performance Rating of
blueprint 9.1 under `performance-rating@1.0.0`, a versioned config in one file
(`internal/formula.ts`, D-035): 60% result performance adjusted for
difficulty, 20% exact scores, 15% consistency across the most recent settled
predictions, 5% appropriate use of confidence; provisional below 30 settled
predictions, established at 50; tiers bronze / silver / gold / platinum /
elite on configured bounds. Difficulty is the model's latest forecast version
computed before kick-off (immutable, T-064): a correct pick earns `1 −
p(outcome)`, neutral 1/3 without a forecast, so the result component is plain
accuracy when the model said nothing and "always pick the favourite" earns
0.2 per correct pick at 80% — twenty such picks rate 35.5 against 77.5 for
twenty correct picks the model did not expect. Migration `..._rating.sql`
adds immutable `rating_snapshot` rows (formula version, settled count, total,
components, provisional/established, an `inputs_hash` over the settlement ids
and the formula version). **Rating recomputable from stored records alone:**
`ReputationService.recompute` reads settlements through the predictions
boundary and forecasts through the forecast boundary, computes, and writes a
snapshot only when the inputs differ from the newest one; the HTTP suite
stores forecasts and predictions before kick-offs that really pass, settles
four matches, rates a favourite-picker (result 0.225) below an upset-picker
(0.345), recomputes twice from the same rows with the same number and one
snapshot in the table, then changes the formula version and gets a second
snapshot with the first kept; UPDATE on a snapshot is refused (`23001`).
`GET /me/rating`, `GET /users/:username/rating` (public, blueprint 9.3),
`POST /me/rating/recompute` (member), `POST /ratings/recompute` (admin pass
over recently settled members). 7 formula unit tests, 5 HTTP tests; 176 API
tests; typecheck, lint, Prettier; migration down/up cycled.

---

## E6 — Forecast model

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-060 | Historical loader: football-data.co.uk + Club Elo into the training store | T-008 | Repeatable, versioned, documented licence per source |
| `[x]` T-061 | Baseline model: time-weighted goal model + Elo prior | T-060 | Produces a score matrix and 1X2 probabilities |
| `[x]` T-062 | Backtesting and calibration harness (log loss, Brier, reliability curve, vs market odds) | T-061 | Report generated per model version |
| `[x]` T-063 | `apps/model` FastAPI service with the internal contract | T-061 | Contract test from `apps/api` passes |
| `[x]` T-064 | Forecast versioning + input snapshots | T-063 | Probabilities total 100% after rounding; forecasts immutable |
| `[x]` T-065 | Match centre forecast panel with leading factors and computation time | T-064, T-034 | Explains, never asserts certainty |
| `[x]` T-066 | Post-match evaluation records | T-064 | Model performance queryable per competition |

**T-060 verified on 2026-09-10.** `apps/model` (Python) gains the loaders and
the `training` schema arrives by migration (D-028). **Repeatable:** the real
2024/25 Premier League file was loaded twice through the CLI; both loads
report 380 rows with the same SHA-256 (`d0c8ce4a96d8…`), the table holds 380
rows, not 760, all 380 carry closing odds (`B365`), and the first row reads
Man United 1-0 Fulham at 1.60/4.20/5.25. **Versioned:** each run is a
`source_load` row with source, scope, URL, terms URL, terms note, content
hash, row count and outcome; rows point at the load that last wrote them.
**Documented licence per source:** `sources.py` carries the terms URL and
note for football-data.co.uk and Club Elo, and every load copies them.
Failure is honest: the Club Elo API answered `502 Bad Gateway` throughout the
session, and the attempted load is recorded as `failed` with that error and
wrote no rows; the Elo parser is tested on synthetic rows in the documented
layout until the API is back. 18 pytest tests (parsers on a real file head;
store tests for repeatability, the failed-download path, a malformed file, and
Elo) pass in under a second; ruff and strict mypy pass; Turbo runs all four
through `pnpm lint/typecheck/test/build`, and CI installs the package.

Two things found on the way and fixed here: Turbo's strict env mode was
stripping `DATABASE_URL`, so the API's database-backed tests had been
**skipping under `pnpm test`, in CI too**, since PR #23 (now in `globalEnv`,
and 69 API tests run); and psycopg takes two minutes to connect to
`localhost` on Windows (IPv6 first), so `.env.example` now says `127.0.0.1`.

**T-061 verified on 2026-09-10.** `fmip_model/model/`: a time-weighted
Dixon-Coles score model (attack, defence, home advantage, low-score `rho`,
exponential decay with a ~107-day half-life) fitted by penalised maximum
likelihood, with Club Elo as a prior on net strength (D-029). The acceptance
criterion is the `Outcome` read off the scoreline matrix: home / draw / away
probabilities that sum to one, expected goals, most likely scorelines, and a
`rounded()` that makes the three displayed figures total exactly 100%
(blueprint 6.2). Tests on simulated seasons with known strengths: the fit
recovers the strength order and a positive home advantage; the stronger side
is favoured home and away; the time weight halves at the half-life; a match
after the fit date is refused as a leak; a team with no matches but an Elo is
rated where its Elo puts it, and an absurd Elo cannot overturn twelve seasons
of results; an unknown team is an error. On the real 2024/25 Premier League
(380 matches in the training store): converges, positive home advantage,
twenty teams, in-sample log loss below uniform. 32 tests, ruff, strict mypy
(with `scipy-stubs`).

**T-062 verified on 2026-09-10.** `fmip_model/backtest/`: walk-forward
evaluation (fit on everything before the match day, refit weekly, forecast the
day; a match after the fit date is refused), scored by log loss, Brier and a
ten-bin reliability table per outcome, with the de-margined closing odds and
a uniform forecast scored on the same matches. `python -m fmip_model.backtest`
writes a Markdown and a JSON report under `reports/<model-version>/<scope>`,
which is the acceptance criterion. The first real report is committed:
**`dixon-coles-elo@0.1.0` on the 2024/25 Premier League, 1 Oct 2024 to 31
May 2025, 320 forecasts, 28 refits, all 320 with closing odds: log loss model
1.0170, market 0.9811, uniform 1.0986; Brier 0.6094 / 0.5861 / 0.6667.** The
model beats uniform clearly and is 0.036 behind the market, so the report's
verdict is "not ready to publish (D-016)", which is the honest state of a
first baseline fitted without its Elo prior (the Club Elo API was down all
day, so `training.elo` is empty and the prior was inactive). Tests: textbook
values for uniform, a perfect and a confidently wrong forecaster, the
distribution guard, reliability binning and calibration error on constructed
cases, de-margining; and on simulated seasons the walk-forward never sees the
future, beats uniform on log loss and Brier, refuses a window without enough
history, tolerates missing odds, and writes the report per model version with
the expected tables. 42 tests, ruff, strict mypy.

**T-063 verified on 2026-09-10.** The FastAPI service (`fmip_model/service/`)
answers `GET /health` and `POST /forecast`. The contract is written twice, in
Pydantic and in `packages/contracts/src/forecast.ts`, and held together by the
acceptance test in `apps/api` (`model-client.spec.ts`): the golden request
and response examples the service's own tests write are validated rule by rule
(probabilities total one, expected goals positive, scorelines well-formed,
leading factors from the closed list, `inputs` with a `name@semver` model
version, an `unavailable` body with a reason and no probabilities); the client
refuses a drifted response, and reports HTTP errors and an unreachable service
as values; and against the **live service** it checks `/health`, the seeded
Liverpool v Manchester United fixture (fit date the day before kick-off, a
valid `available` or `unavailable` body), and an unmapped team → `unavailable`
/ `team_not_mapped`. Locally the live test ran against the real training
store: Liverpool 73.4% / 18.7% / 8.0%, expected goals 2.56 / 0.81, fitted on
E0 up to 4 January 2025 without Elo, `data_completeness: limited`. CI starts
the service after migrating and seeding, so the live test runs there too.
`training.team_alias` (migration) bridges catalog UUIDs to training names;
seed 004 maps the two seeded English clubs. The service fits once per
(division, day) and caches; it never fits past today. `Dockerfile` and the
compose `model` service (no published port; the api reaches `http://model:8000`)
were built and run against the compose Postgres. 51 Python tests, 81 API
tests (78 + 3 live), ruff, strict mypy.

**T-064 verified on 2026-09-10.** Migration `..._forecast.sql` adds
`competition.football_data_division`, `model_version`, `input_snapshot` and
`forecast`; seed 005 maps the two seeded leagues to `E0` and `SP1`. The
`ForecastService` in `apps/api` builds the model request from the fixture
(participants, kick-off, the competition's division), asks the model through
`ModelClient`, and stores the answer as the next version in one transaction:
request and reported inputs in the snapshot, probabilities re-rounded to total
exactly 1, expected goals, most likely scorelines, leading factors, data
completeness — or `unavailable` with a reason (D-030). `GET
/fixtures/:id/forecasts` serves every version oldest first with `coverage`
and `last_updated_at` from the latest; `POST` computes a version and needs an
admin session (`IdentityService.hasRole`, the first use of `user_role`).
**Probabilities total 100% after rounding:** `roundToTotalOne` is unit-tested
(1/3, 1/3, 1/3 → 0.3334 / 0.3333 / 0.3333), the stored row's
`p_home + p_draw + p_away` reads `1.0000`, and a direct INSERT of 0.5 / 0.3 /
0.3 is refused by the CHECK (`23514`). **Forecasts immutable:** the HTTP test
proves a second computation is version N+1 while version N is returned
byte-for-byte unchanged, and that UPDATE and DELETE on `forecast` and
`input_snapshot` are refused by the trigger (`23001 restrict_violation`); the
down/up cycle of the migration ran on the real database. Against the **live
model** the seeded Liverpool v Manchester United fixture was stored as an
`available` version: 73.38% / 18.66% / 7.96%, expected goals 2.56 / 0.81,
`dixon-coles-elo@0.1.0` fitted on 196 E0 matches to 4 January 2025 without
Elo, `data_completeness: limited`, so `coverage: limited`. 104 API tests
(35 in the forecast module, 2 of them live), typecheck, lint.

**T-066 verified on 2026-09-10.** Migration `..._evaluation.sql` adds
`evaluation`: one row per forecast version once the fixture has a full-time
score — the score, the outcome, whether the version was computed before
kick-off, the probability it gave what happened, log loss, Brier, and whether
its most probable outcome and most likely scoreline were right. The
definitions are those of the Python `metrics.py` and are unit-tested to the
sixth decimal (a 26.22% draw: log loss 1.338648, Brier 0.834497; the uniform
forecast scores ln 3 and 2/3). `EvaluationService.evaluateFixture` refuses a
fixture that is not `finished` or has no full-time score (409 over HTTP),
scores every `available` version exactly once (the unique `forecast_id` makes
a second run a no-op), skips `unavailable` versions, and stores each row
immutably (`refuse_change()`, UPDATE and DELETE refused with `23001`). **Model
performance queryable per competition:** `GET
/competitions/:id/model-performance[?season=]` aggregates pre-kick-off
evaluations per model version and forecast kind — versions and fixtures
evaluated, mean log loss and Brier, accuracy, scoreline accuracy — beside the
uniform reference values, and states the gaps: finished fixtures, fixtures
evaluated, `unavailable` versions, and versions computed after kick-off (stored
and evaluated, never counted — D-031); `coverage` is `limited` while finished
fixtures exist that no pre-kick-off version covers. The HTTP suite creates its
own Premier League fixture, computes three versions (before kick-off,
unavailable, after the result), finishes it 2-2, and checks each of these
against the real schema. Down/up cycle of the migration ran on the real
database. 116 API tests (47 in the forecast module), typecheck, lint.

**T-065 verified on 2026-09-11.** The match centre gains the model forecast
panel (`forecast-panel.tsx`) fed by `GET /fixtures/:id/forecasts` and, once
the match is finished, `GET /fixtures/:id/evaluations`. **Explains, never
asserts certainty:** the three probabilities are shown as percentages that
total exactly 100.0, under them one sentence names the outcome the model
gives the most probability and by how many points, ending "these are
probabilities, not a prediction of the result" (or "the model sees this as
close" under five points); the leading factors say what they are, whom they
favour and the model's note; version number, kind, computation time, model id
and data completeness are always on screen; "What changed between versions"
gives each version's shift in points against the previous available one
(blueprint 6.4); an `unavailable` version shows its reason in plain words; no
forecast says "No forecast has been computed for this match yet". After the
match the panel shows the result, the probability the version gave it, whether
that was its most probable outcome, log loss and Brier beside the
knowing-nothing reference, and whether it was computed after kick-off. Smoke
test with the real model service, API and web app on the seeded Liverpool v
Manchester United: a new version (73.4% / 18.7% / 8.0%, `data limited`,
`dixon-coles-elo@0.1.0`) rendered with the framing "gives Liverpool the most
probability, 54.7 points ahead … not a prediction of the result", and the
post-match evaluation block appeared for the finished match. 32 web unit
tests (7 new on percentages, framing, deltas), typecheck, lint, stylelint.

---

## E7 — Operations and admin

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-070 | Minimal admin: coverage status, freshness, ingest failures, user search, rating config | T-027, T-053 | High-impact actions write an audit record |
| `[ ]` T-071 | Structured logging, error tracking, tracing on ingestion and live path | T-026 | An ingest failure is visible without SSH |
| `[x]` T-072 | Automated off-provider database backups + tested restore | T-008 | A restore drill is documented and passes |
| `[ ]` T-073 | Load test at expected peak (many concurrent SSE clients) | T-032 | Documented pass at an agreed threshold |
| `[ ]` T-074 | Production deploy: VPS, Docker Compose, Cloudflare, TLS, domain | T-073 | Zero-downtime redeploy verified |

**T-072 verified on 2026-09-10.** `scripts/backup/backup.sh` dumps the
database from inside the postgres container (`pg_dump` custom format,
`--no-owner --no-privileges`), writes a manifest beside it — applied
migrations, the exact `COUNT(*)` of every table in `public` and `training`,
size, SHA-256 — copies dump and manifest to the off-provider rclone remote
through the official `rclone` image, re-reads the size from the remote and
fails the run if it differs, then prunes local (7 days) and remote (90 days)
copies. `restore-drill.sh` restores a dump into a throwaway
`postgres:18-alpine` container it removes on exit, and passes only if the
checksum, the migration list, every table's row count, the forecast
probability CHECK and the immutability trigger all match. **A restore drill
is documented and passes:** run on the development database — 36 tables, 458
rows, 12 migrations, 144,462 bytes — the drill printed `DRILL PASSED`
(checksum ok, 12 migrations ending in `1758600000000_evaluation`, 36 tables
and 458 rows equal, both constraints present). The off-provider path was
rehearsed with an rclone `local` remote: copy, remote size verification and
prune all ran through the real rclone binary. `fmip-backup.service` and
`.timer` schedule it daily at 03:30 UTC on the VPS. The runbook is
`docs/07-backups.md` (what, where, schedule, the drill, the monthly
checklist, restoring for real). What remains for the maintainer: create the
bucket at a provider other than the VPS host, write `rclone.conf` with a
`crypt` remote, set `BACKUP_RCLONE_REMOTE`, and run the first real backup
and drill from the remote (D-032).

---

## E8 — Quality gate before launch

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-080 | Playwright E2E for the four blueprint user journeys in scope | T-056, T-065 | Green in CI |
| `[ ]` T-081 | Accessibility pass: keyboard, focus order, contrast, live-score announcements | T-034 | Meets the agreed standard |
| `[ ]` T-082 | PWA: manifest, offline shell, installability | T-039 | Installs on Android; audited |
| `[ ]` T-083 | Feed-failure resilience: provider outage degrades gracefully | T-027 | Stale data is labelled, never presented as live |
| `[ ]` T-084 | Launch acceptance review against `01-roadmap.md` exit criteria | all | Signed off in `00-decisions.md` |

---

## Not in Phase 1 — do not start

Chat, groups, friends, Watch/broadcast, highlights, news CMS, community
analysis, contributor approval, additional languages, native apps, xG-based
Power Index. If a task seems to require one of these, stop and re-scope.
