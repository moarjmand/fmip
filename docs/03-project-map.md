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
| `docker-compose.yml` | Local dev stack. Postgres, Redis and the API. `apps/web` is not in it yet — it is run from the host with `pnpm --filter @fmip/web dev`. |
| `scripts/` | Developer scripts. `check-dev-stack.sh` proves Postgres, Redis and `/health` all answer. |
| `.dockerignore` | Keeps `node_modules`, build output and `.env` out of every image build context. |
| `package.json` | Workspace root. Pins the pnpm version and the `build`/`lint`/`typecheck`/`test`/`format` entry points. |
| `turbo.json`, `pnpm-workspace.yaml` | Monorepo wiring. Task graph and workspace globs. |
| `tsconfig.json` | Root TypeScript config for editors. Compiles nothing itself. |
| `prettier.config.mjs`, `.prettierignore` | Formatting. Re-exports `@fmip/config/prettier`; Markdown is excluded. |
| `.npmrc`, `.nvmrc`, `.editorconfig` | Toolchain pinning: pnpm resolution, Node 22, editor defaults. |
| `.env.example` | Every environment variable, documented. Keep in sync. |
| `.github/workflows/ci.yml` | CI. Runs format, lint, typecheck, test and build on every PR and on `main`. |
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
| `src/app.module.ts` | Root module. Each boundary is registered here as it is built. |
| `src/modules/health/` | `GET /health`. Liveness only — see the note below. |
| `src/modules/<boundary>/` | The eleven boundaries from `02-architecture.md`. Empty until built. |
| `Dockerfile` | Multi-stage build. Built from the repository root, not from `apps/api`. |
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
| `src/i18n/locales.ts` | Which locales ship, and the writing direction of each. |
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
| `tsconfig/library.json` | For `packages/*`: composite build. Each project sets its own `rootDir`/`outDir`. |
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
| `DATABASE_URL` | `apps/api`, `packages/db` *(planned)* | For processes run on the host. The `api` container does not use it: compose derives its own from the `POSTGRES_*` values and the `postgres` service name, because `localhost` inside a container is that container. |
| `REDIS_PORT` | `docker-compose.yml` | Host port, bound to `127.0.0.1`. Default `6379`. |
| `REDIS_URL` | `apps/api` *(planned)* | Cache, live state, BullMQ. Same host caveat as `DATABASE_URL`. |
| `API_PORT` | `apps/api`, `docker-compose.yml` | Host port for the API. Rejected at boot if it is not a valid port number. |
| `WEB_PORT` | `apps/web` | Port for `next dev` / `next start`. Default `3000`. |
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
