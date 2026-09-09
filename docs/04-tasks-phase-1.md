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
| `[ ]` T-012 | Schema: provider_mapping, coverage_profile, ingest_run | T-010 | Unique constraint on (provider, external_id, entity_type) |
| `[ ]` T-013 | Entity resolver service: external id → internal uuid, with unresolved queue | T-012 | Unknown entity is queued, never silently created twice |

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

---

## E2 — Ingestion and the provider bake-off

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-020 | Adapter contract interface + recorded-fixture contract test harness | T-011 | A non-conforming adapter fails tests |
| `[ ]` T-021 | API-Football adapter (free tier) | T-020 | Contract tests pass against recorded responses |
| `[ ]` T-022 | football-data.org adapter (free tier) | T-020 | Same |
| `[ ]` T-023 | Highlightly adapter (free tier) | T-020 | Same |
| `[ ]` T-024 | Bake-off harness: run all three over the same fixtures, log latency/completeness/errors | T-021, T-022, T-023 | Produces `docs/05-data-providers.md` results table automatically |
| `[ ]` T-025 | **Decision gate:** review bake-off, pick provider, subscribe to paid tier | T-024 | New entry in `00-decisions.md` |
| `[ ]` T-026 | Scheduled ingestion jobs (BullMQ): fixtures, live, lineups, standings, post-match | T-025 | Jobs are idempotent; a replay changes nothing |
| `[ ]` T-027 | Coverage profile computation + freshness tracking | T-026 | Every module payload carries a coverage state |

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
| `[ ]` T-040 | Registration, email verification, login, sessions, password reset | T-004 | Security tests cover auth and session fixation |
| `[ ]` T-041 | Profile page + privacy settings | T-040 | Public / friends-only / private all enforced server-side |
| `[ ]` T-042 | Favourites and following (teams, competitions, players) | T-041 | Favourites affect the scores page ordering |

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
| `[ ]` T-060 | Historical loader: football-data.co.uk + Club Elo into the training store | T-008 | Repeatable, versioned, documented licence per source |
| `[ ]` T-061 | Baseline model: time-weighted goal model + Elo prior | T-060 | Produces a score matrix and 1X2 probabilities |
| `[ ]` T-062 | Backtesting and calibration harness (log loss, Brier, reliability curve, vs market odds) | T-061 | Report generated per model version |
| `[ ]` T-063 | `apps/model` FastAPI service with the internal contract | T-061 | Contract test from `apps/api` passes |
| `[ ]` T-064 | Forecast versioning + input snapshots | T-063 | Probabilities total 100% after rounding; forecasts immutable |
| `[ ]` T-065 | Match centre forecast panel with leading factors and computation time | T-064, T-034 | Explains, never asserts certainty |
| `[ ]` T-066 | Post-match evaluation records | T-064 | Model performance queryable per competition |

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
