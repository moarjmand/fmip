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

```bash
pnpm install
cp .env.example .env
docker compose up
```

Web at `http://localhost:3000/en`, API at `http://localhost:3001/health`.

## Ground rules

- One task, one branch, one PR.
- The API contract lives in `packages/contracts` and nowhere else.
- No provider-specific field ever leaves `packages/ingestion/adapters/`.
- Missing data is labelled, never faked.
- Layout CSS uses logical properties; the RTL check runs in CI.

Full rules: `CLAUDE.md`.
