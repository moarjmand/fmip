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
| `docker-compose.yml` | Local dev: Postgres, Redis, API, web, model service. |
| `turbo.json`, `pnpm-workspace.yaml` | Monorepo wiring. |
| `.env.example` | Every environment variable, documented. Keep in sync. |
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
| `packages/config` *(planned)* | Shared tsconfig, eslint, prettier | everything |

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
