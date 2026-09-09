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
| `docker-compose.yml` | Local dev stack. Postgres, Redis, the API and the web app. The model service joins in T-063. |
| `scripts/` | Developer scripts. `check-dev-stack.sh` proves Postgres, Redis, `/health` and `/en` all answer. `dev-proxy.sh` (config in `dev-proxy/squid.conf`) runs a loopback-only forward proxy in Docker for a host that cannot reach the npm registry directly; see `06-session-handoff.md`, constraint 2. |
| `.dockerignore` | Keeps `node_modules`, build output and `.env` out of every image build context. |
| `package.json` | Workspace root. Pins the pnpm version and the `build`/`lint`/`typecheck`/`test`/`format` entry points. Checks run with `--continue`, so one run reports every broken workspace. |
| `turbo.json`, `pnpm-workspace.yaml` | Monorepo wiring. Task graph and workspace globs. |
| `tsconfig.json` | Root TypeScript config for editors. Compiles nothing itself. |
| `prettier.config.mjs`, `.prettierignore` | Formatting. Re-exports `@fmip/config/prettier`; Markdown is excluded. |
| `.npmrc`, `.nvmrc`, `.editorconfig` | Toolchain pinning: pnpm resolution, Node 22, editor defaults. |
| `.env.example` | Every environment variable, documented. Keep in sync. |
| `.github/workflows/ci.yml` | CI. `Verify` runs format, lint, typecheck, test and build; `E2E` runs the Playwright RTL check. Both on every PR and on `main`. |
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
| `apps/model` *(planned)* | FastAPI forecast service. | Called by `apps/api` only. Reads training store. |

### `apps/api`

| Path | Purpose |
|---|---|
| `src/main.ts` | Bootstrap: Fastify adapter, port resolution, shutdown hooks. |
| — | `pnpm dev` watches and compiles; `pnpm dev:serve` runs the output. Two scripts, not one backgrounded pipeline, because `&` backgrounds in bash and sequences in cmd. |
| `src/app.module.ts` | Root module. Each boundary is registered here as it is built. |
| `src/database/database.module.ts` | The shared `pg.Pool`, injected as `PG_POOL` (D-025). Global, so boundary modules do not import it. Refuses to boot without `DATABASE_URL`; drains the pool on shutdown. |
| `src/modules/health/` | `GET /health`. Liveness only — see the note below. Returns `HealthReport` from `@fmip/contracts`. |
| `src/modules/ingestion/` | The ingestion boundary. Today: `EntityResolverService` (public, in `ingestion.service.ts`), which resolves a provider id to an internal UUID or queues it. `internal/resolver.ts` is the pure logic over a `MappingStore` port; `internal/postgres-mapping-store.ts` is the SQL. Adapters and jobs arrive with E2. |
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

### `apps/web`

| Path | Purpose |
|---|---|
| `src/app/[locale]/layout.tsx` | Root layout. Owns `<html lang dir>`; 404s an unshipped locale. |
| `src/app/[locale]/page.tsx` | Placeholder home page. The scores page replaces it in T-031. |
| `src/app/globals.css` | Tailwind entry point and global styles. |
| `src/i18n/locales.ts` | Which locales ship, the pseudo-locales, and the writing direction of each. |
| `src/lib/api.ts` | Calls `apps/api`, typed by `@fmip/contracts`. Returns an unreachable state rather than throwing. |
| `tests/e2e/rtl.spec.ts` | The RTL check. Asserts computed layout, never screenshots. |
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
| `packages/ingestion` *(planned)* | Provider adapters, normalisation, entity resolution | `apps/api` |
| `packages/db` | Schema, migrations, seed data. Plain SQL, applied by node-pg-migrate (D-022). | `apps/api` |
| `packages/db/training` *(planned)* | Historical datasets for model training only. **Never importable from `apps/api` or `apps/web`** (D-014) | `apps/model` |
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

### `packages/db`

| Path | Purpose |
|---|---|
| `migrations/*.sql` | One file per change, `<timestamp>_<slug>.sql`, each with an up and a down section. Never edit a shipped one. `..._bootstrap.sql` is the version gate and the `set_updated_at()` trigger function; `..._catalog.sql` is T-010: `country`, `competition`, `season`, `stage`, `venue`, `team`, `person`, `player_spell`. `..._fixtures.sql` is T-011: `fixture`, `fixture_participant`, `fixture_score`, `fixture_period`, `incident`, `lineup`, `fixture_stat`. `..._ingestion.sql` is T-012: `provider_mapping`, `coverage_profile`, `ingest_run`. `..._unresolved-entity.sql` is T-013: the review queue for provider ids that do not resolve. |
| `seed/*.sql` | Development fixtures, `<nnn>_<slug>.sql`, applied in prefix order. Fixed UUIDs and `ON CONFLICT (id) DO UPDATE`, so re-running converges. `001` is the catalog slice, `002` one finished fixture, `003` three API-Football ids and an honest coverage profile for the seeded season. Never product data: the runner refuses `NODE_ENV=production`. |
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

---

## Environment variables

Every variable in `.env.example`, and what reads it. Adding one means editing
both files (`CLAUDE.md` §5). `.env` itself is never committed.

| Variable | Read by | Notes |
|---|---|---|
| `NODE_ENV` | everything | |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `docker-compose.yml` | Configure the container at first start. Changing them after the volume exists has no effect. |
| `POSTGRES_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `5432`. |
| `DATABASE_URL` | `apps/api`, `packages/db` | Required by the API at boot since T-013 (`src/database/database.module.ts` refuses to guess). For processes run on the host. The `api` container does not use the `.env` value: compose derives its own from the `POSTGRES_*` values and the `postgres` service name, because `localhost` inside a container is that container. |
| `REDIS_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `6379`. |
| `REDIS_URL` | `apps/api` *(planned)* | Cache, live state, BullMQ. Same host caveat as `DATABASE_URL`. |
| `API_PORT` | `apps/api`, `docker-compose.yml` | Host port for the API. Rejected at boot if it is not a valid port number. |
| `WEB_PORT` | `docker-compose.yml` | Host port for the web app, bound to `127.0.0.1`. Default `3000`. The container itself always listens on 3000; compose sets Next's own `PORT` for it. |
| `API_BASE_URL` | `apps/web` | Where the web app reaches the API server-side. Default `http://127.0.0.1:3001`. |
| `MODEL_SERVICE_URL` | `apps/api` *(planned)* | Internal only. Never reachable from the browser. |
| `SESSION_SECRET` | `apps/api` *(planned)* | |
| `API_FOOTBALL_KEY`, `FOOTBALL_DATA_ORG_KEY`, `HIGHLIGHTLY_KEY` | `packages/ingestion` *(planned)* | Free-tier keys for the bake-off (D-013). |
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
