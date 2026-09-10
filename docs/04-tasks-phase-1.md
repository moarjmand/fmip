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
| `[ ]` T-021 | API-Football adapter (free tier) | T-020 | Contract tests pass against recorded responses |
| `[ ]` T-022 | football-data.org adapter (free tier) | T-020 | Same |
| `[ ]` T-023 | Highlightly adapter (free tier) | T-020 | Same |
| `[ ]` T-024 | Bake-off harness: run all three over the same fixtures, log latency/completeness/errors | T-021, T-022, T-023 | Produces `docs/05-data-providers.md` results table automatically |
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

**T-021 to T-023 are blocked on credentials.** Recordings must come from real
responses, and `API_FOOTBALL_KEY`, `FOOTBALL_DATA_ORG_KEY` and
`HIGHLIGHTLY_KEY` are empty in the maintainer's `.env`. Free-tier accounts are
the maintainer's to create (third-party terms); once the keys exist, each
adapter is one directory plus its recordings. T-025 is likewise the
maintainer's decision and payment. E3 and E5 wait behind T-026.

---

## E3 — Public read experience

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-030 | Scores API: date range, filters, grouping, favourites | T-026 | Yesterday / today / next five days all correct in user timezone |
| `[ ]` T-031 | Scores page | T-030 | Matches blueprint 4.1 card fields, or labels them unsupported |
| `[ ]` T-032 | SSE gateway + client subscription with snapshot-on-reconnect | T-026 | Score changes appear without refresh; staleness is visible |
| `[ ]` T-033 | Match centre API | T-027 | Header, timeline, stats, form, H2H, coverage states |
| `[ ]` T-034 | Match centre page | T-033, T-032 | Works before, during and after a match |
| `[ ]` T-035 | Competition page (table, fixtures, results, leaders) | T-030 | Season selector works; links resolve |
| `[ ]` T-036 | Team page | T-035 | Squad, fixtures, form, competition context |
| `[ ]` T-037 | Player page | T-036 | Every lineup/squad name links here correctly |
| `[ ]` T-038 | Basic entity search | T-037 | Aliases and common spellings match |
| `[ ]` T-039 | SEO surface: metadata, canonical URLs, sitemap, structured data | T-034 | Rendered HTML contains full content without JS |

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
| `[ ]` T-050 | Prediction submission: outcome, optional score, confidence, reason tags | T-040, T-033 | Guests are blocked; versions are retained |
| `[ ]` T-051 | Kick-off lock | T-050 | No write succeeds after kick-off, verified by clock skew test |
| `[ ]` T-052 | Settlement job incl. void rules for postponed/abandoned | T-051 | Re-running settlement is idempotent |
| `[ ]` T-053 | Performance Rating engine, formula in versioned config | T-052 | Rating recomputable from stored records alone |
| `[ ]` T-054 | Career Points | T-052 | Cannot by itself unlock privileges |
| `[ ]` T-055 | Leaderboards with minimum-sample filters | T-053 | A one-prediction account cannot top the board |
| `[ ]` T-056 | Prediction history UI | T-050 | Shows submitted version, timestamp, settlement |

---

## E6 — Forecast model

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-060 | Historical loader: football-data.co.uk + Club Elo into the training store | T-008 | Repeatable, versioned, documented licence per source |
| `[ ]` T-061 | Baseline model: time-weighted goal model + Elo prior | T-060 | Produces a score matrix and 1X2 probabilities |
| `[ ]` T-062 | Backtesting and calibration harness (log loss, Brier, reliability curve, vs market odds) | T-061 | Report generated per model version |
| `[ ]` T-063 | `apps/model` FastAPI service with the internal contract | T-061 | Contract test from `apps/api` passes |
| `[ ]` T-064 | Forecast versioning + input snapshots | T-063 | Probabilities total 100% after rounding; forecasts immutable |
| `[ ]` T-065 | Match centre forecast panel with leading factors and computation time | T-064, T-034 | Explains, never asserts certainty |
| `[ ]` T-066 | Post-match evaluation records | T-064 | Model performance queryable per competition |

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

---

## E7 — Operations and admin

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-070 | Minimal admin: coverage status, freshness, ingest failures, user search, rating config | T-027, T-053 | High-impact actions write an audit record |
| `[ ]` T-071 | Structured logging, error tracking, tracing on ingestion and live path | T-026 | An ingest failure is visible without SSH |
| `[ ]` T-072 | Automated off-provider database backups + tested restore | T-008 | A restore drill is documented and passes |
| `[ ]` T-073 | Load test at expected peak (many concurrent SSE clients) | T-032 | Documented pass at an agreed threshold |
| `[ ]` T-074 | Production deploy: VPS, Docker Compose, Cloudflare, TLS, domain | T-073 | Zero-downtime redeploy verified |

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
