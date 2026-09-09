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
| `docker-compose.yml` | Local dev stack. Postgres + Redis today; API, web and model service join it in T-004, T-005, T-063. |
| `scripts/` | Developer scripts. `check-dev-stack.sh` proves the stack is reachable. |
| `package.json` | Workspace root. Pins the pnpm version and the `build`/`lint`/`typecheck`/`test`/`format` entry points. |
| `turbo.json`, `pnpm-workspace.yaml` | Monorepo wiring. Task graph and workspace globs. |
| `tsconfig.json` | Root TypeScript config for editors. Compiles nothing itself. |
| `prettier.config.mjs`, `.prettierignore` | Formatting. Re-exports `@fmip/config/prettier`; Markdown is excluded. |
| `.npmrc`, `.nvmrc`, `.editorconfig` | Toolchain pinning: pnpm resolution, Node 22, editor defaults. |
| `.env.example` | Every environment variable, documented. Keep in sync. |
| `.github/workflows/ci.yml` | CI. Runs format, lint, typecheck, test and build on every PR and on `main`. |
| `docs/` | All project documentation. See below. |
| `apps/` *(planned)* | Deployable applications. |
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
| `apps/web` *(planned)* | Next.js application. SSR pages, PWA, i18n routing. | `apps/api` over HTTP + SSE; `packages/contracts` for types |
| `apps/api` *(planned)* | NestJS backend. All eleven modules. | Postgres, Redis, `apps/model` |
| `apps/model` *(planned)* | FastAPI forecast service. | Called by `apps/api` only. Reads training store. |

### `apps/api/src/modules/` *(planned)*

One directory per module from `02-architecture.md`. Each contains:

```
<module>/
  <module>.module.ts        # NestJS wiring
  <module>.controller.ts    # HTTP surface
  <module>.service.ts       # PUBLIC — other modules may import this
  internal/                 # PRIVATE — never imported across modules
  dto/                      # request/response shapes
  <module>.spec.ts          # unit tests
```

## `packages/`

| Path | Purpose | Consumed by |
|---|---|---|
| `packages/contracts` *(planned)* | API request/response types, shared enums, coverage states. **The single source of truth for the API shape.** | `apps/web`, `apps/api` |
| `packages/ingestion` *(planned)* | Provider adapters, normalisation, entity resolution | `apps/api` |
| `packages/db` *(planned)* | Schema, migrations, seed data | `apps/api` |
| `packages/db/training` *(planned)* | Historical datasets for model training only. **Never importable from `apps/api` or `apps/web`** (D-014) | `apps/model` |
| `packages/ui` *(planned)* | Shared React components, design tokens, RTL-safe primitives | `apps/web` |
| `packages/config` | Shared tsconfig, eslint, prettier. Published as `@fmip/config`. | everything |

### `packages/config`

Consumed by every other workspace. Nothing here imports from anywhere else.

| Path | Purpose |
|---|---|
| `tsconfig/base.json` | Strictness baseline. Every other preset extends it. |
| `tsconfig/library.json` | For `packages/*`: composite build, `src` → `dist`. |
| `tsconfig/nestjs.json` | For `apps/api`: CommonJS + decorator metadata. |
| `tsconfig/nextjs.json` | For `apps/web`: bundler resolution, JSX, `noEmit`. |
| `eslint/base.js` | Flat config. App configs spread it and add their own layers. |
| `prettier/index.js` | Formatting options. |
| `tests/shared-config.spec.ts` | Guards the invariants above against silent drift. |

---

## Environment variables

Every variable in `.env.example`, and what reads it. Adding one means editing
both files (`CLAUDE.md` §5). `.env` itself is never committed.

| Variable | Read by | Notes |
|---|---|---|
| `NODE_ENV` | everything | |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `docker-compose.yml` | Configure the container at first start. Changing them after the volume exists has no effect. |
| `POSTGRES_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `5432`. |
| `DATABASE_URL` | `apps/api`, `packages/db` *(planned)* | How the application reaches Postgres. Not read by compose — keep it in sync with the `POSTGRES_*` values by hand. |
| `REDIS_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `6379`. |
| `REDIS_URL` | `apps/api` *(planned)* | Cache, live state, BullMQ. |
| `API_PORT`, `WEB_PORT` | `apps/api`, `apps/web` *(planned)* | |
| `MODEL_SERVICE_URL` | `apps/api` *(planned)* | Internal only. Never reachable from the browser. |
| `SESSION_SECRET` | `apps/api` *(planned)* | |
| `API_FOOTBALL_KEY`, `FOOTBALL_DATA_ORG_KEY`, `HIGHLIGHTLY_KEY` | `packages/ingestion` *(planned)* | Free-tier keys for the bake-off (D-013). |

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
