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
bash scripts/check-dev-stack.sh   # proves Postgres and Redis answer
```

The stack is Postgres on `127.0.0.1:5432` and Redis on `127.0.0.1:6379`; both
ports are bound to loopback so a development database is not exposed to the rest
of your network. Data survives restarts in the `postgres-data` and `redis-data`
volumes — `docker compose down -v` is what throws it away.

`apps/api`, `apps/web` and `apps/model` are added to the compose file by T-004,
T-005 and T-063. Once they are there: web at `http://localhost:3000/en`, API at
`http://localhost:3001/health`.

Workspace-wide commands, each fanned out over every package by Turborepo:

```bash
pnpm build       # build every package
pnpm typecheck   # tsc across the workspace
pnpm lint        # eslint across the workspace
pnpm test        # vitest across the workspace
pnpm format      # prettier --write
```

## Ground rules

- One task, one branch, one PR.
- The API contract lives in `packages/contracts` and nowhere else.
- No provider-specific field ever leaves `packages/ingestion/adapters/`.
- Missing data is labelled, never faked.
- Layout CSS uses logical properties; the RTL check runs in CI.

Full rules: `CLAUDE.md`.
