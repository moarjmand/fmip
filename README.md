# FMIP — Football Match Intelligence Platform

A football platform built around the match: live scores, a full match centre,
competition/team/player pages, a versioned statistical forecast model, user
predictions, and a reputation system where standing is earned through settled
predictions rather than popularity.

**Status:** Phase 0 — foundation. Not yet deployed.

---

## Start here

| If you are… | Read |
|---|---|
| An agent about to do work | `CLAUDE.md`, then `docs/03-project-map.md` |
| Resuming after a break | `docs/06-session-handoff.md` |
| Wondering why something is built this way | `docs/00-decisions.md` |
| Looking for what to build next | `docs/04-tasks-phase-1.md` |
| Trying to understand the system | `docs/02-architecture.md` |
| Asking about intended product behaviour | `docs/product-blueprint.md` |

## Stack

Next.js · NestJS (Fastify) · PostgreSQL · Redis · BullMQ · Python/FastAPI for the
forecast model · pnpm + Turborepo monorepo · Docker Compose on a VPS.

Rationale for each choice: `docs/00-decisions.md`.

## Local development

Requires Node 22 (see `.nvmrc`) and pnpm 10. The pinned pnpm version is declared
in `package.json`; `corepack enable` picks it up automatically.

```bash
pnpm install
cp .env.example .env
docker compose up -d
bash scripts/check-dev-stack.sh   # proves Postgres, Redis and /health answer
```

The stack is Postgres on `127.0.0.1:5432`, Redis on `127.0.0.1:6379` and the API
on `127.0.0.1:3001`; every port is bound to loopback so a development database is
not exposed to the rest of your network. Data survives restarts in the `postgres-data` and `redis-data`
volumes — `docker compose down -v` is what throws it away.

`apps/model` joins the compose file in T-063. `apps/web` is not containerised
yet and runs from the host:

```bash
pnpm --filter @fmip/web dev      # http://localhost:3000/en
```

To run the API without Docker:

```bash
pnpm --filter @fmip/api build && pnpm --filter @fmip/api start
```

Every page lives under a locale segment; `/` redirects to `/en`. Layout must use
logical properties — `pnpm lint` fails on `margin-left` in CSS and on `ml-*` in a
`className` (D-021).

Workspace-wide commands, each fanned out over every package by Turborepo:

```bash
pnpm build       # build every package
pnpm typecheck   # tsc across the workspace
pnpm lint        # eslint across the workspace
pnpm test        # vitest across the workspace
pnpm format      # prettier --write
```

## CI

`.github/workflows/ci.yml` runs `format:check`, `lint`, `typecheck`, `test` and
`build` on every pull request and on every push to `main`. All five run even
when an earlier one fails, so one run reports everything that needs fixing.

The job is named **Verify**. For a failing check to actually block a merge, that
job must be listed as a required status check on `main` in the repository's
branch protection settings — the workflow alone reports, it does not enforce.

## Ground rules

- One task, one branch, one PR.
- The API contract lives in `packages/contracts` and nowhere else.
- No provider-specific field ever leaves `packages/ingestion/adapters/`.
- Missing data is labelled, never faked.
- Layout CSS uses logical properties; the RTL check runs in CI.

Full rules: `CLAUDE.md`.
