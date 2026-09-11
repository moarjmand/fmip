# Project map

**Purpose.** This file exists so that neither a human nor an agent has to scan
the repository to find anything. Read it first; open only what it points to.

**Maintenance rule.** Any PR that adds a file, removes a file, or moves a
responsibility must update this file in the same PR. A PR that does not is
incomplete.

**Status.** Phase 0. Entries marked *(planned)* do not exist yet.

---

## Top level

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Operating rules for agents. Read before any work. |
| `README.md` | Human entry point, setup instructions. |
| `docker-compose.yml` | Local dev stack. Postgres, Redis, the API, the web app and the model service (internal, no published port). |
| `scripts/` | Developer scripts. `check-dev-stack.sh` proves Postgres, Redis, `/health` and `/en` all answer. `dev-proxy.sh` (config in `dev-proxy/squid.conf`) runs a loopback-only forward proxy in Docker for a host that cannot reach the npm registry directly; see `06-session-handoff.md`, constraint 2. `backup/` is T-072: `backup.sh` (pg_dump in the container + manifest + off-provider copy through rclone + pruning), `restore-drill.sh` (restores into a throwaway Postgres and checks checksum, migrations, every row count, constraints), `fmip-backup.service`/`.timer` for the VPS. Runbook: `07-backups.md`. |
| `.dockerignore` | Keeps `node_modules`, build output and `.env` out of every image build context. |
| `package.json` | Workspace root. Pins the pnpm version and the `build`/`lint`/`typecheck`/`test`/`format` entry points. Checks run with `--continue`, so one run reports every broken workspace. |
| `turbo.json`, `pnpm-workspace.yaml` | Monorepo wiring. Task graph and workspace globs. |
| `tsconfig.json` | Root TypeScript config for editors. Compiles nothing itself. |
| `prettier.config.mjs`, `.prettierignore` | Formatting. Re-exports `@fmip/config/prettier`; Markdown is excluded. |
| `.npmrc`, `.nvmrc`, `.editorconfig` | Toolchain pinning: pnpm resolution, Node 22, editor defaults. |
| `.env.example` | Every environment variable, documented. Keep in sync. |
| `.github/workflows/ci.yml` | CI. `Verify` runs format, lint, typecheck, test and build against a real Postgres service: the migrations are applied and the seed loaded with the package scripts first, so the API's store tests run rather than skip. `E2E` runs the Playwright RTL check. Both on every PR and on `main`. |
| `docs/` | All project documentation. See below. |
| `apps/` | Deployable applications. |
| `packages/` | Shared libraries. |

## `docs/`

| File | Contains | Read it when |
|---|---|---|
| `00-decisions.md` | Every locked decision with rationale | Before proposing any architectural change |
| `01-roadmap.md` | Phases and sequencing rule | Deciding whether something is in scope |
| `02-architecture.md` | Module boundaries, data flow, adapters | Starting work in a new module |
| `03-project-map.md` | This file | Always, first |
| `04-tasks-phase-1.md` | Task backlog with acceptance criteria | Picking up work |
| `05-data-providers.md` | Provider research and bake-off protocol | Touching ingestion |
| `06-session-handoff.md` | How to resume in a fresh chat | Starting a new session |
| `product-blueprint.md` | The original product definition, converted from `m1.docx`. Authoritative on behaviour, **not** on engineering | Questions about intended behaviour |
| `adr/` *(planned)* | Long-form decision records when a log entry is not enough | — |

## `apps/`

| Path | Purpose | Talks to |
|---|---|---|
| `apps/web` | Next.js App Router application. Locale routing, Tailwind, RTL-safe by lint. | `apps/api` over HTTP + SSE; `packages/contracts` for types |
| `apps/api` | NestJS backend on the Fastify adapter. One module per boundary. | Postgres, Redis, `apps/model` |
| `apps/model` | Python forecast model service (D-009): training-store loaders (T-060), the Dixon-Coles model (T-061), the backtest harness (T-062) and the FastAPI service (T-063). | Reads and writes the `training` schema; will be called by `apps/api` only. |

### `apps/api`

| Path | Purpose |
|---|---|
| `src/main.ts` | Bootstrap: Fastify adapter, port resolution, shutdown hooks. |
| — | `pnpm dev` watches and compiles; `pnpm dev:serve` runs the output. Two scripts, not one backgrounded pipeline, because `&` backgrounds in bash and sequences in cmd. |
| `src/app.module.ts` | Root module. Each boundary is registered here as it is built. |
| `src/database/database.module.ts` | The shared `pg.Pool`, injected as `PG_POOL` (D-025). Global, so boundary modules do not import it. Refuses to boot without `DATABASE_URL`; drains the pool on shutdown. |
| `src/modules/health/` | `GET /health`. Liveness only — see the note below. Returns `HealthReport` from `@fmip/contracts`. |
| `src/modules/catalog/` | The catalog boundary's read side. Today `GET /countries`, `GET /teams` and `GET /competitions` as summary lists for forms and follow controls; full competition, team and player reads arrive with E3. |
| `src/modules/profile/` | The profile boundary: `GET /profiles/:username` (privacy applied to the viewer before anything is serialised), `GET`/`PATCH /me/profile`, `PATCH /me/privacy`. `internal/visibility.ts` is the one rule (`canView`) plus the `FriendshipOracle` port, whose only implementation answers no until Phase 2. `profile.http.spec.ts` proves public / friends / private server-side. Following (T-042): `GET`/`PUT`/`DELETE /me/following[/:type/:id]`, `GET /me/favourites`; `internal/following-store.ts` is the SQL; `internal/favourite-order.ts` is `compareByFavourites`, the pure ranking the scores API sorts with (exported from `profile.service.ts`). |
| `src/modules/ingestion/` | The ingestion boundary. Today: `EntityResolverService` (public, in `ingestion.service.ts`), which resolves a provider id to an internal UUID or queues it. `internal/resolver.ts` is the pure logic over a `MappingStore` port; `internal/postgres-mapping-store.ts` is the SQL. Adapters and jobs arrive with E2. |
| `src/modules/identity/` | The identity boundary: `/auth/*`. `identity.service.ts` is public (`IdentityService`: register, login, authenticate, logout, verify e-mail, password reset; cookie helpers). `identity.controller.ts` validates bodies into the `@fmip/contracts` shapes. `internal/`: `password.ts` (scrypt), `tokens.ts` (random tokens, HMAC), `cookies.ts` (the session cookie, by hand), `validation.ts`, `identity-store.ts` (SQL), `mailer.ts` (the `MAILER` port; `LogMailer` prints). `identity.spec.ts` is unit; `identity.http.spec.ts` is the security suite against the real schema. |
| `src/modules/forecast/internal/model-client.ts` | The API's side of the internal contract with the model service (T-063): `ModelClient.forecast()` and `.health()`, plus `contractProblems()`, which refuses any response that drifted from `@fmip/contracts`. Failure is a value. |
| `src/modules/forecast/` | The forecast boundary (T-064). `forecast.service.ts` is public: `ForecastService.compute(fixtureId, kind)` asks the model and stores the answer as the next immutable version — an `available` answer with probabilities re-rounded to total exactly 1, or an `unavailable` one with its reason (`competition_not_mapped`, `model_unreachable`, `contract_violation`, or the model's own) — and `.versions(fixtureId)` serves them oldest first with `coverage` and `last_updated_at` from the latest (D-030). `forecast.controller.ts`: `GET /fixtures/:id/forecasts` (public) and `POST` (admin session; the jobs of E2 call the service directly). `internal/forecast-store.ts` is the SQL, one transaction per version; `internal/rounding.ts` is `roundToTotalOne`. `forecast.spec.ts` is unit; `forecast.http.spec.ts` proves numbering, immutability and the probability CHECK against the real schema, and stores a live answer when `MODEL_SERVICE_URL` is set. Evaluation (T-066): `evaluation.service.ts` (`EvaluationService.evaluateFixture` scores every available version of a finished fixture against its full-time score, once; `.performance(competitionId, seasonId)` aggregates pre-kick-off evaluations per model version and kind, with the gaps counted — D-031), `evaluation.controller.ts` (`GET`/`POST /fixtures/:id/evaluations`, POST admin only; `GET /competitions/:id/model-performance?season=`), `internal/scoring.ts` (log loss, Brier, correct, scoreline hit — the same definitions as the Python `metrics.py`), `internal/evaluation-store.ts`; `scoring.spec.ts` and `evaluation.http.spec.ts`. |
| `src/modules/forecast/model-client.spec.ts` | The contract test: validates the golden examples the model service writes, the client's behaviour on drift, HTTP errors and an unreachable service, and, when `MODEL_SERVICE_URL` is set (CI starts the service), the live service. |
| `src/modules/fixtures/` | The fixtures boundary's read side. T-030: `GET /scores` — `fixtures.service.ts` is public (`FixturesService.scores(filters, viewerId)` plus `parseScoresQuery`); `scores.controller.ts` reads the session if there is one; `internal/scores-query.ts` parses dates, the IANA zone, flags and ids and names every bad field at once; `internal/scores-store.ts` is the SQL, with the date range turned into instants by Postgres in the user's zone (`AT TIME ZONE`), scores and list incidents aggregated per fixture, and `last_updated_at` the newest change across fixture, scores and incidents; `internal/arrange.ts` pins favourites (ranks from the profile boundary's `favouriteRank`) and groups the rest by competition under its country. `scores.spec.ts` is unit (parsing, grouping); `scores.http.spec.ts` proves the timezone boundary, filters and pinning against the real schema. T-033: `GET /fixtures/:id` — `match-centre.controller.ts`; `FixturesService.matchCentre()` assembles header, timeline, statistics, line-ups, form and head-to-head, each a `Covered` module; `internal/match-centre-store.ts` is the SQL (eight tables, `last_updated_at` as the newest change across them); `internal/covered.ts` is the rule that turns rows plus the season's declared coverage into one state (`covered.spec.ts`). `match-centre.http.spec.ts` builds a five-fixture cluster and checks every module. |
| `src/modules/<boundary>/` | The remaining boundaries from `02-architecture.md`. Empty until built. |
| `Dockerfile` | Multi-stage build. Built from the repository root, not from `apps/api`. Compiles through Turbo so `@fmip/contracts` is built first, and deploys with `pnpm deploy --legacy`, because pnpm 10 refuses to deploy a workspace that does not inject its packages. |
| `vitest.config.mts` | Vitest transformed by SWC rather than esbuild (D-019). |

**`/health` is liveness, not readiness.** It reports that the process is serving
HTTP and nothing else. It deliberately says nothing about Postgres or Redis: no
client for either exists yet, and claiming a dependency check that never runs is
the failure rule 3 exists to prevent. Readiness arrives with T-008.

One directory per module from `02-architecture.md`. Each will contain:

```
<module>/
  <module>.module.ts        # NestJS wiring
  <module>.controller.ts    # HTTP surface
  <module>.service.ts       # PUBLIC — other modules may import this
  internal/                 # PRIVATE — never imported across modules
  dto/                      # request/response shapes
  <module>.spec.ts          # unit tests
```

### `apps/model`

Python 3.12+, managed with a plain venv. `pnpm --filter @fmip/model setup` creates
`.venv` and installs the package with its dev tools; the Turbo scripts run that
interpreter through `scripts/py.mjs`, or `python` from PATH when there is no
venv (CI). On the maintainer's host, pip needs the proxy:
`python -m pip install --proxy http://127.0.0.1:3128 ...`.

| Path | Purpose |
|---|---|
| `pyproject.toml` | Package `fmip-model`: runtime deps `httpx`, `psycopg`; dev `pytest`, `ruff`, `mypy` (strict). Ruff and mypy configuration. |
| `package.json`, `scripts/py.mjs` | Turbo hooks: `lint` (ruff check + format), `typecheck` (mypy), `test` (pytest), `build` (import check). |
| `fmip_model/training/sources.py` | The two sources (D-016) with their terms URL and note, and the URL builders. Every load records these. |
| `fmip_model/training/football_data.py` | Parses a football-data.co.uk CSV into match rows: results, half-time, shots, and closing 1X2 odds from the first bookmaker set present (`B365`, then `Avg`, `PS`, `WH`), naming the source. Unsupplied is `None`, never a guess. |
| `fmip_model/training/clubelo.py` | Parses Club Elo CSV (`Rank,Club,Country,Level,Elo,From,To`). |
| `fmip_model/training/store.py` | Writes to the `training` schema: opens a `source_load` row, upserts on natural keys, closes the load as succeeded (hash, row count) or failed (error). |
| `fmip_model/training/load.py` | The CLI: `python -m fmip_model.training.load football-data --seasons 2425 --divisions E0 SP1` and `clubelo --days 2025-08-01`. One load row per (source, scope); a failure writes no rows and is recorded. |
| `fmip_model/model/poisson.py` | Expected goals → scoreline matrix (0–10 each side, Dixon-Coles low-score correction, renormalised) → `Outcome`: home/draw/away, expected goals, most likely scorelines, and `rounded()` so the three displayed probabilities total exactly 1. |
| `fmip_model/model/dixon_coles.py` | The fit (T-061): time-weighted penalised maximum likelihood over attack, defence, home advantage and `rho`, with a ridge and an Elo prior on net strength. `FittedModel.predict(home, away)` reads everything off the matrix; an unknown team is an error, not a guess. |
| `fmip_model/model/data.py` | Reads matches and Elo from the `training` schema into model inputs, with the fit date as a hard boundary against leaks. |
| `fmip_model/model/version.py` | `ModelVersion`: name, version and the frozen constants (`xi`, ridge, Elo weight, scale, max goals). `BASELINE` is `dixon-coles-elo@0.1.0`. A changed constant is a new version. |
| `fmip_model/backtest/` | T-062. `metrics.py`: log loss, Brier, reliability bins, calibration error. `market.py`: de-margined implied probabilities from closing odds. `walk_forward.py`: fit on the past, forecast the day, refit weekly, never see the future; scores the model, the market and uniform on the same matches. `report.py`: Markdown + JSON per model version and scope, with the D-016 verdict. `__main__.py`: `python -m fmip_model.backtest --divisions E0 --from … --to … --history-from …`. |
| `reports/<model-version>/` | Committed backtest reports: the evidence behind a model version. Never edited by hand. |
| `fmip_model/service/` | T-063, the FastAPI service. `contract.py`: the Pydantic twin of `packages/contracts/src/forecast.ts`. `forecaster.py`: aliases catalog team ids to training names, fits once per (division, day) and caches, answers `available` with probabilities that total 100%, expected goals, most likely scorelines, leading factors and what data was used, or `unavailable` with a reason (`team_not_mapped`, `no_history`, `division_not_loaded`). `store_source.py`: the training store as its source. `app.py` / `__main__.py`: `GET /health`, `POST /forecast`; `python -m fmip_model.service` on `MODEL_PORT` (8000). |
| `contract/*.example.json` | Golden request and response examples, written by the service's own tests and validated by `apps/api`'s contract test. Regenerated by `pytest`, never edited by hand. |
| `Dockerfile` | `python:3.12-slim`, dependencies from `pyproject.toml`, non-root, its own HEALTHCHECK. Built from the repository root. The compose `model` service publishes no port. |
| `tests/` | Parser tests on a real football-data file head (`fixtures/`); store and real-season fit tests against the database when `DATABASE_URL` is set; model tests on simulated seasons with known strengths. |

**The training store is a schema, not a package.** `training.source_load`,
`training.match` and `training.elo` live in the same Postgres as everything
else (D-028), and nothing in `public` references them. `apps/api` never
queries the schema; the model service is its only reader. Team names are
text there, by design: the sources identify teams by name and the data is
offline research (D-014), so mapping historical names onto the catalog is the
model's job at training time, not a reason to bend rule 1.

### `apps/web`

| Path | Purpose |
|---|---|
| `src/app/[locale]/layout.tsx` | Root layout. Owns `<html lang dir>`; 404s an unshipped locale. |
| `src/app/[locale]/page.tsx` | Placeholder home page. The scores page replaces it in T-031. |
| `src/app/[locale]/register`, `login`, `forgot-password`, `reset-password`, `verify-email` | The account pages (T-040/T-041). Forms are `ActionForm` over a server action; `verify-email` spends the token on render. |
| `src/app/[locale]/scores/page.tsx` | The scores page (blueprint 4.1, T-031): one day in the viewer's zone (`?tz=`, else the member's, else UTC), the yesterday / today / next-five-days strip, All / Live / Favourites-only filters, favourites pinned, the rest grouped by competition under its country. An unreachable API is said out loud, never shown as a quiet day. |
| `src/components/score-card.tsx` | One match on the list: status or clock, teams with red-card marks, score, competition / stage / round / leg / aggregate, kick-off and venue, goals / red cards / VAR, then the labels: the scores coverage state and, for what the platform does not have yet, "Forecast: not on this page yet", "Community: unsupported", "Watch: unsupported". |
| `src/lib/scores.ts` | The page's pure helpers: reading the query (zone precedence, bad date → today), the API query and page links that keep state, the day strip, status / score / kick-off labels. `scores.spec.ts` covers them. |
| `src/app/[locale]/u/[username]/page.tsx` | A member's profile as the API allows this viewer to see it: full, or name-only when restricted. |
| `src/app/[locale]/settings/page.tsx` | Profile and privacy forms for the signed-in member; redirects to login otherwise. |
| `src/components/site-header.tsx` | The navigation bar. Reads the session server-side; shows the visitor as signed out when the API cannot be reached. |
| `src/components/action-form.tsx` | The one form component: fields from a spec, errors from the API's `ApiError.fields` through `useActionState`. |
| `src/components/following-section.tsx` | Follows and favourites on the settings page: pin, unpin, unfollow, and pickers over `GET /teams` and `GET /competitions`. Plain forms over server actions. |
| `src/lib/auth-actions.ts` | Server actions for every account form. They call the API, mirror its session cookie onto the web origin (D-027), and redirect or return an `ActionState`. |
| `src/lib/session.ts`, `src/lib/set-cookie.ts` | Forwarding the visitor's session cookie to the API and mirroring the API's `Set-Cookie` back. The parser is pure and tested. |
| `src/app/globals.css` | Tailwind entry point and global styles. |
| `src/i18n/locales.ts` | Which locales ship, the pseudo-locales, and the writing direction of each. |
| `src/lib/api.ts` | Every call to `apps/api`, server-side only, typed by `@fmip/contracts`. Failure is a value (`status` 0 = unreachable), never a throw. |
| `tests/e2e/rtl.spec.ts` | The RTL check. Asserts computed layout, never screenshots. |
| `tests/e2e/scores.spec.ts` | The scores page without an API: the strip, the filters, state kept in links, the unreachable notice, the RTL mirror. |
| `playwright.config.ts` | Runs the E2E suite against a production build. |
| `Dockerfile` | Multi-stage build on Next's standalone output. Built from the repository root. |
| `src/proxy.ts` | Redirects any path without a locale segment to the default locale. |
| `stylelint.config.mjs` | Bans physical CSS properties (rule 7). |
| `eslint.config.mjs` | Bans physical Tailwind utilities in `className`, plus Next's rules. |

**RTL safety is enforced in two places, because layout lives in two places.**
Stylelint rejects `margin-left` and friends in CSS; ESLint rejects `ml-*`,
`text-left`, `border-l-*` and friends inside a `className`. In a Tailwind
codebase almost all layout is class names, so a CSS-only rule would cover
almost nothing. Both fail the build, not just review.

The locale segment is the only routing rule: every page lives under one, and
`src/proxy.ts` redirects anything that arrives without it. A URL therefore
always says which language it is in.

**`x-rtl` is a pseudo-locale, not a language.** It serves the same English text
in a right-to-left document, so a physical-property regression becomes visible
before anyone ships Arabic. It is routable in every environment — the check runs
against a production build — and carries `noindex`, because duplicate English
under a second URL is an SEO problem on a product that depends on search.

The `<h1>` accent bar is the canary: `border-s-4 ps-4` must render on the left
in `en` and on the right in `x-rtl`. Written as `border-l-4 pl-4` instead, `/en`
still looks perfect and only the `x-rtl` assertion fails — which is the whole
argument for having the pseudo-locale.

## `packages/`

| Path | Purpose | Consumed by |
|---|---|---|
| `packages/contracts` | API request/response types, shared enums, coverage states. **The single source of truth for the API shape.** | `apps/web`, `apps/api` |
| `packages/ingestion` | The normalised model adapters produce, the adapter contract, and the recorded-fixture harness that verifies an adapter, and the three adapters: `api-football` (T-021), `football-data-org` (T-022), `highlightly` (T-023). | `apps/api` |
| `packages/db` | Schema, migrations, seed data. Plain SQL, applied by node-pg-migrate (D-022). | `apps/api` |
| schema `training` (was `packages/db/training`) | Historical datasets for model training only, as a Postgres schema created by the T-060 migration (D-028). **Never read by `apps/api` or `apps/web`** (D-014) | `apps/model` |
| `packages/ui` *(planned)* | Shared React components, design tokens, RTL-safe primitives | `apps/web` |
| `packages/config` | Shared tsconfig, eslint, prettier. Published as `@fmip/config`. | everything |

### `packages/config`

Consumed by every other workspace. Nothing here imports from anywhere else.

| Path | Purpose |
|---|---|
| `tsconfig/base.json` | Strictness baseline. Every other preset extends it. |
| `tsconfig/library.json` | For `packages/*`: composite build. Each project sets its own `rootDir`/`outDir`. |
| `tsconfig/nestjs.json` | For `apps/api`: CommonJS + decorator metadata. |
| `tsconfig/nextjs.json` | For `apps/web`: bundler resolution, JSX, `noEmit`. |
| `eslint/base.js` | Flat config. App configs spread it and add their own layers. |
| `prettier/index.js` | Formatting options. |
| `tests/shared-config.spec.ts` | Guards the invariants above against silent drift. |

### `packages/contracts`

| Path | Purpose |
|---|---|
| `src/coverage.ts` | `CoverageState`, the `Covered<T>` envelope, and `hasData`. |
| `src/health.ts` | The `GET /health` response shape. |
| `src/index.ts` | The package's whole public surface. |

**Every module payload the API returns is a `Covered<T>`**, carrying a coverage
state and a `last_updated_at`. That is rules 3 and 4 expressed as a type rather
than a convention: a caller cannot read the data without having been handed the
coverage state next to it.

Changing a type here breaks `apps/api` and `apps/web` in the same build, which
is the point of the package (D-006).

### `packages/ingestion`

| Path | Purpose |
|---|---|
| `src/normalised.ts` | The provider-neutral shapes every adapter returns: fixture, incident, lineup, standing, statistic, period, and the closed value lists they share with the schema. Entities carry the provider's id plus a name; unsupplied fields are `null`, never zero or a guess. |
| `src/adapters/_contract.ts` | `ProviderAdapter` (five calls: fixtures, live, lineup, standings, detail), `AdapterManifest` (licence, tier, quota, critical-path flag), `Transport` (the only way to the network, injected), `AdapterResult` (failure is a value, with the request count). |
| `src/adapters/_fixtures/` | Recorded provider responses, one directory per provider, one JSON scenario per call. Recorded with `RecordingTransport` through `scripts/record.mjs`, never hand-written. `api-football/`, `football-data-org/` and `highlightly/`: six scenarios each from 2026-09-10, the same Premier League 2023/24 fixtures (T-021..T-023). |
| `src/adapters/api-football/` | T-021. `index.ts`: `createApiFootballAdapter` and `API_FOOTBALL_MANIFEST` (licensed API, free tier, 100/day, 10/min); one request per call; the v3 envelope's `errors` object becomes `quota` / `unsupported` / `http` / `malformed`. `map.ts`: the only file that knows API-Football's field names — statuses, rounds → stage kinds, events → incidents (side by team id, substitute as the related player, unattributed events dropped), lineups matched to home/away by team id with captains from the per-player block, statistics by name (`55%` → 55), standings per group. Live state is `fixtures?live=all` filtered to the requested ids: the free plan refuses `ids=`. `api-football.spec.ts`: the contract check over the recordings plus mapping-rule tests. |
| `src/adapters/football-data-org/` | T-022. Same shape as `api-football`, against v4 on the free tier (TIER_ONE, 10/min). `map.ts`: statuses, `REGULAR_SEASON`/`GROUP_STAGE`/`LAST_16`… → stage kinds, `matchday` → round, the ninety-minute score from `regularTime` when a match went further (null when not split), `form` reversed because the provider writes it newest first (verified live), goals/bookings/substitutions → incidents and lineups for the tiers that carry them. On the free tier lineups are `unsupported` and a detail has no incidents or statistics. `/matches?ids=` serves the live call. |
| `src/adapters/highlightly/` | T-023. Same shape, against `sports.highlightly.net/football` on the BASIC plan (100/day) with the RapidAPI-style headers the direct API insists on. Request cost is different and reported honestly: a fixture list is one request per day of the range (refused beyond 14), the live call one request per fixture (refused beyond 20; there is no batch lookup). `map.ts`: free-text `state.description` → status by keyword, string scores (`0 - 3`), event times (`90+4`), events with the substitute as the related player, statistics by display name with possession fractions → percentages, standings per group without form. No half-time scores exist; a lineup with no starters is `unsupported`; an unknown id answers an empty array and is reported as `malformed`. |
| `src/bakeoff/` | T-024. `metrics.ts`: field completeness per module (optional normalised fields filled / could have been filled), cross-provider matching by kick-off and normalised team name, disagreements (same match, different status or score, counted only where two providers supplied the field). `run.ts`: `runLive` (a `TimedTransport` around `fetch`, paced to each manifest's per-minute quota, response times, every provider over the same competitions and dates) and `runRecorded` (the `_fixtures` scenarios replayed; deterministic, no network); both produce the same `BakeoffResult`. `report.ts`: the Markdown results table and `insertResults`, which replaces the block between `<!-- bakeoff:start -->` and `<!-- bakeoff:end -->` in `docs/05-data-providers.md`. Goal latency, lineup lead time and lineup accuracy are listed as not measured: they need the polling job (T-026). |
| `scripts/bakeoff.mjs`, `scripts/plans/bakeoff.mjs` | `node scripts/bakeoff.mjs --recorded` or `--live` (keys from the environment; a provider without a key is skipped and named). Writes the table into `docs/05-data-providers.md` and the full result to `bakeoff/<timestamp>-<mode>.json`. The plan is the fixture set: five 2023/24 opening weekends, the seasons every free plan serves. |
| `scripts/record.mjs`, `scripts/plans/<provider>.mjs` | Records a provider's scenarios from the live API (`node scripts/record.mjs api-football [--only=name]` after `pnpm build`): the plan lists calls and arguments, the expectation is derived from the adapter's own result, the key is read from the environment and the output is scanned for it. |
| `src/harness/contract-check.ts` | `checkAdapterContract(factory, scenarios)`: replays each scenario through `ReplayTransport`, checks the manifest (D-014), that failure is returned not thrown, that no unrecorded URL was requested, that the request count is honest, and that success validates as the normalised shape. Returns problems; empty means pass. `loadScenarios(dir)` reads a provider's recordings. |
| `src/harness/replay-transport.ts` | `ReplayTransport` answers only from recordings and lists what it could not answer; `RecordingTransport` performs real requests and remembers them, for producing recordings. |
| `src/harness/validate.ts` | Hand-written validators for each normalised shape and the manifest, restating the schema's rules at the boundary (statuses, ranges, uniqueness, "finished needs a full-time score", one captain, D-014). |
| `src/harness/contract-check.spec.ts` | The harness's own proof: a conforming fake adapter passes; deliberately broken ones (leaked provider status, faked coverage, unrecorded URL, thrown error, misreported requests, scraped critical path, success where failure was recorded) each fail by name. |

**An adapter is verified by its recordings, not by its author.** `checkAdapterContract`
on an adapter with no scenarios reports it as unverified rather than passing it.
The adapter never reaches for `fetch`: it is constructed with a `Transport`, so
the same code runs against the recording in tests and against the provider in
the bake-off, and the request count it reports is checked against the transport.

`apps/api` will import `PROVIDERS` and the entity-type list from this package
once an adapter exists (T-021); until then the resolver in
`apps/api/src/modules/ingestion/` carries its own copy of both lists.

### `packages/db`

| Path | Purpose |
|---|---|
| `migrations/*.sql` | One file per change, `<timestamp>_<slug>.sql`, each with an up and a down section. Never edit a shipped one. `..._bootstrap.sql` is the version gate and the `set_updated_at()` trigger function; `..._catalog.sql` is T-010: `country`, `competition`, `season`, `stage`, `venue`, `team`, `person`, `player_spell`. `..._fixtures.sql` is T-011: `fixture`, `fixture_participant`, `fixture_score`, `fixture_period`, `incident`, `lineup`, `fixture_stat`. `..._ingestion.sql` is T-012: `provider_mapping`, `coverage_profile`, `ingest_run`. `..._unresolved-entity.sql` is T-013: the review queue for provider ids that do not resolve. `..._identity.sql` is T-040: `user_account`, `credential`, `session`, `email_token`, `user_role`. `..._profile.sql` is T-041: `profile`, `privacy_setting`. `..._followed-entity.sql` is T-042: `followed_entity`. `..._training-store.sql` is T-060: schema `training` with `source_load`, `match`, `elo`. `..._training-team-alias.sql` is T-063: `training.team_alias`, catalog team → training name per division. `..._forecast.sql` is T-064: `competition.football_data_division`, `model_version`, `input_snapshot`, `forecast`, and the `refuse_change()` trigger that makes snapshots and forecasts immutable (rule 5). `..._evaluation.sql` is T-066: `evaluation`, one immutable row per forecast version scored against the full-time score. |
| `seed/*.sql` | Development fixtures, `<nnn>_<slug>.sql`, applied in prefix order. Fixed UUIDs and `ON CONFLICT (id) DO UPDATE`, so re-running converges. `001` is the catalog slice, `002` one finished fixture, `003` three API-Football ids and an honest coverage profile for the seeded season, `004` training-store aliases for the two seeded English clubs, `005` the football-data division of the two seeded leagues (an UPDATE-only seed). Never product data: the runner refuses `NODE_ENV=production`. |
| `src/index.ts` | Locates and orders the migration files. |
| `src/seed.ts` | Locates and orders the seed files, and the `pnpm seed` runner: one transaction per file, rolled back whole on failure. |
| `src/migrations.spec.ts` | Enforces the naming, the unique ordering, and that every migration has a non-empty down section. |
| `src/seed.spec.ts` | Enforces seed naming and ordering, that every `INSERT` carries its `ON CONFLICT`, the production refusal, and the per-file transaction. |

Applying them needs `DATABASE_URL` and a running Postgres:

```bash
DATABASE_URL=... pnpm --filter @fmip/db migrate:up
DATABASE_URL=... pnpm --filter @fmip/db migrate:down
DATABASE_URL=... pnpm --filter @fmip/db build seed   # seed runs from dist
```

**Catalog conventions (T-010).** Every table has a `uuid` primary key that we
generate, `created_at`/`updated_at` maintained by trigger, and named
constraints. Enumerations (`competition.kind`, `team.kind`, `stage.kind`,
`player_spell.position`, …) are `text` columns under `CHECK` constraints, not
Postgres enum types (D-024). Names are never unique; the only unique natural
keys are standardised codes (`country.code`, the FIFA trigram) and structural
pairs (`season(competition_id, label)`, `stage(season_id, sort_order)`). Two
partial unique indexes carry business rules: one current season per
competition, one open `player_spell` per (person, team).

**Fixture conventions (T-011).** A team's involvement in a fixture is a row in
`fixture_participant` (one `home`, one `away`, a team at most once), and
`lineup`, `incident` and `fixture_stat` reference that row, not `team`: a
lineup for a team that is not playing cannot be written. Scores are one row
per kind in `fixture_score` (`current`, `half_time`, `full_time`,
`extra_time`, `penalties`, `aggregate`); the clock is `fixture_period` with
real start and end times. `fixture_stat` is `(metric, value)` under a closed
metric list; an absent row means *not supplied* and is never stored as zero
(rule 3). Children of a fixture cascade on delete; references into the
catalog (`team`, `person`, `season`) are `RESTRICT`.

**Ingestion conventions (T-012).** `provider_mapping(provider, external_id,
entity_type)` is unique and is the only place a provider id lives (rule 2);
`internal_id` is not a foreign key because it points at one of eight tables by
`entity_type`, so the entity resolver (T-013) checks existence on write. One
internal entity may carry several ids from one provider (upstream duplicates)
and one id per provider is the norm. `coverage_profile` is one row per
`(season, module)` in the four `CoverageState` values from
`packages/contracts`; a missing row means unknown and is read as
`not_supplied`, and a state other than `not_supplied` must name its provider.
`ingest_run` is `running` exactly while `finished_at` is null, a failed run
must carry its error, and a partial unique index allows one running row per
`(provider, job)`, which is the lock that makes a duplicate scheduler tick
harmless. Provider identifiers (`api_football`, `football_data_org`,
`highlightly`) are the D-013 bake-off set; T-025 changes them with a
constraint swap.

**Entity resolution (T-013).** `EntityResolverService.resolve(ref)` returns
`resolved` with the internal UUID, or `queued` after upserting one row in
`unresolved_entity` per `(provider, entity_type, external_id)`; a second
sighting bumps `seen_count`, never adds a row (the UNIQUE constraint, not
discipline). It never creates a catalog row. `link(ref, internalId, actor,
note)` is the only way a mapping comes to exist: it checks the target row
exists in the entity's table, inserts into `provider_mapping` with
`ON CONFLICT DO NOTHING`, and reports `conflict` if the id already points
elsewhere. The queue row is closed with actor, time, target and note (rule
10). The API-side test runs against the real schema when `DATABASE_URL` is
set and is skipped, visibly, when it is not.

**Accounts (T-040).** No secret is stored: passwords are scrypt hashes with
their parameters in the string, sessions and e-mailed tokens are HMACs of the
random value the client holds (D-026). The session is an HttpOnly, SameSite=Lax
cookie named `fmip_session`; a login always mints a new one and never promotes
a cookie the client already had, which is the session-fixation defence. Wrong
password and unknown account are the same 401 in the same time (a decoy hash
is verified when the account is unknown); forgotten-password requests always
answer 202. A password reset revokes every session. E-mail tokens are single
use, decided by one `UPDATE ... WHERE used_at IS NULL`. `username` and `email`
are unique and lower-cased. Outbound mail goes through the `MAILER` port; the
provider is chosen at deployment (T-074), so `LogMailer` prints the link,
which is what local development wants anyway.

---

## Environment variables

Every variable in `.env.example`, and what reads it. Adding one means editing
both files (`CLAUDE.md` §5). `.env` itself is never committed.

| Variable | Read by | Notes |
|---|---|---|
| `NODE_ENV` | everything | |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `docker-compose.yml` | Configure the container at first start. Changing them after the volume exists has no effect. |
| `POSTGRES_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `5432`. |
| `DATABASE_URL` | `apps/api`, `packages/db`, `apps/model` | Required by the API at boot since T-013 (`src/database/database.module.ts` refuses to guess). For processes run on the host; use `127.0.0.1`, not `localhost` (psycopg on Windows tries `::1` first and waits two minutes). The `api` container does not use the `.env` value: compose derives its own from the `POSTGRES_*` values and the `postgres` service name, because `localhost` inside a container is that container. Turbo passes it through (`globalEnv`), so `pnpm test` reaches the database-backed tests. |
| `REDIS_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `6379`. |
| `REDIS_URL` | `apps/api` *(planned)* | Cache, live state, BullMQ. Same host caveat as `DATABASE_URL`. |
| `API_PORT` | `apps/api`, `docker-compose.yml` | Host port for the API. Rejected at boot if it is not a valid port number. |
| `WEB_PORT` | `docker-compose.yml` | Host port for the web app, bound to `127.0.0.1`. Default `3000`. The container itself always listens on 3000; compose sets Next's own `PORT` for it. |
| `API_BASE_URL` | `apps/web` | Where the web app reaches the API server-side. Default `http://127.0.0.1:3001`. |
| `MODEL_SERVICE_URL` | `apps/api` | Where the model service answers, e.g. `http://model:8000` in compose. Internal only, never reachable from the browser. When set, the API's live contract test runs against it. |
| `BACKUP_DIR`, `BACKUP_KEEP_LOCAL_DAYS` | `scripts/backup` | Where `backup.sh` writes dumps and manifests (git-ignored, default `./backups`) and how many days of local copies it keeps (default 7). |
| `BACKUP_RCLONE_REMOTE`, `BACKUP_KEEP_REMOTE_DAYS`, `BACKUP_RCLONE_CONFIG` | `scripts/backup` | The off-provider rclone destination (a `crypt` remote, see `07-backups.md`), its retention (default 90 days) and the `rclone.conf` holding it. Unset remote = local copies only, and the script warns (D-032). |
| `MODEL_PORT` | `apps/model` | The port the model service listens on. Default `8000`. |
| `SESSION_SECRET` | `apps/api` | Required at boot, at least 32 characters. Keys the HMAC of session and e-mail tokens (D-026); rotating it signs everyone out and voids every unused e-mail link. |
| `WEB_BASE_URL` | `apps/api` | Where the links in verification and password-reset e-mails point. Default `http://localhost:3000`. |
| `API_FOOTBALL_KEY`, `FOOTBALL_DATA_ORG_KEY`, `HIGHLIGHTLY_KEY` | `packages/ingestion` (recording script), the bake-off (T-024) | Free-tier keys, verified 2026-09-10 (`05-data-providers.md`). Sent in headers, never in URLs; recordings are scanned for them. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `apps/web/playwright.config.ts` | Tooling only, not application config, so it is deliberately **not** in `.env.example`. Points the E2E run at an already-installed browser, for an environment that cannot download one. Unset in CI. |

---

## Dependency rules

```
apps/web      →  packages/contracts, packages/ui
apps/api      →  packages/contracts, packages/ingestion, packages/db
apps/model    →  (independent; contract defined in packages/contracts)
packages/*    →  packages/config only
```

`apps/web` must **never** import from `apps/api` or `packages/db`. If a type is
needed on both sides, it belongs in `packages/contracts`.

---

## How to find things

| I need to… | Go to |
|---|---|
| Change what the API returns | `packages/contracts` first, then the module |
| Add a data provider | `packages/ingestion/adapters/` |
| Change the database shape | `packages/db/migrations/` |
| Change how a match page looks | `apps/web/app/[locale]/match/` |
| Change rating maths | `apps/api/src/modules/reputation/` |
| Change the forecast model | `apps/model/` |
| Add an environment variable | `.env.example` **and** this file |
