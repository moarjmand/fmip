# CLAUDE.md — Operating rules for this repository

You are working on **FMIP** (Football Match Intelligence Platform).
Read this file fully. Then read `docs/03-project-map.md` before opening any source file.

---

## 1. What this project is

A football platform built around a canonical match entity: live scores, match
centre, competition/team/player pages, a versioned statistical forecast model,
user predictions, and an earned reputation system.

Full product definition: `docs/product-blueprint.md`
Current scope: `docs/01-roadmap.md` (we are in **Phase 1**)

## 2. Stack (locked — see `docs/00-decisions.md`)

| Layer | Technology |
|---|---|
| Web | Next.js (App Router) + TypeScript |
| Backend | NestJS with Fastify adapter + TypeScript |
| Model service | Python + FastAPI |
| Database | PostgreSQL |
| Cache / live state | Redis |
| Jobs | BullMQ |
| Live to client | SSE (scores), WebSocket (chat, Phase 3) |
| Repo | pnpm workspaces + Turborepo monorepo |
| Styling | Tailwind, logical properties only |
| Tests | Vitest (unit/integration), Playwright (E2E) |
| Deploy | Docker Compose on a VPS, Cloudflare in front |

Do not introduce a new framework, ORM, or infrastructure dependency without an
entry in `docs/00-decisions.md`. If you think one is needed, stop and say so.

## 3. Token discipline (important)

The maintainer works within a subscription usage budget. Wasted context is a
real cost to this project.

- **Never** scan the whole repository. Consult `docs/03-project-map.md`, open
  only the files it points to.
- Prefer targeted edits over rewriting files.
- If a task spans more than ~6 files, stop and propose splitting it.
- Do not re-read a file you have already read in this session.
- Do not restate large blocks of code back to the user; reference paths and line
  ranges.

## 4. Non-negotiable rules

1. **Canonical identity.** Every football entity has an internal UUID. External
   provider IDs live in a mapping table. Never use a team/player *name* as a key.
2. **Provider isolation.** No provider-specific field ever reaches the API layer
   or the frontend. Everything passes through an adapter in
   `packages/ingestion/adapters/`. The frontend depends on our contracts only.
3. **Never fake coverage.** If data is missing, return an explicit coverage
   state (`available` | `limited` | `not_supplied` | `delayed`). Never emit an
   empty module that looks populated, and never invent a value.
4. **Never show stale data as current.** Every live surface carries a
   `last_updated_at`. If it is beyond the freshness threshold, the UI says so.
5. **Forecasts are immutable.** Each forecast version stores its inputs, model
   version, and computation time. Never mutate a stored forecast; write a new
   version.
6. **Three prediction products stay separate.** The statistical model, the
   founder's analysis, and community consensus are never blended or relabelled.
7. **RTL safety.** CSS uses logical properties (`margin-inline-start`, not
   `margin-left`). No hardcoded `left` / `right` in layout. The RTL pseudo-locale
   test must pass.
8. **Ratings must be reproducible.** A Performance Rating must be recomputable
   from stored predictions and settlements alone.
9. **Licensed data only on the critical path.** See decision D-014.
10. **Audit high-impact admin actions.** Record actor, timestamp, reason, and
    previous value.

## 5. Conventions

- Language of code, comments, commits, and docs: **English**.
- Language of chat with the maintainer: **Persian (Farsi)**, in every session,
  without being asked. Only the conversation is Persian: code, comments,
  commits, PR titles and bodies, and docs stay in English.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- One task = one branch = one PR. Branch name: `t-<task-id>-<slug>`.
- Every module lives under `apps/api/src/modules/<module>/` and exposes only its
  public service; no cross-module imports of internals.
- Database changes only via migrations. Never edit a shipped migration.
- New env var → add to `.env.example` and to `docs/03-project-map.md`.

## 6. Definition of done

A task is not complete until all of these hold:

- [ ] Typecheck passes, lint passes.
- [ ] Unit tests cover the new logic; integration test if it crosses a boundary.
- [ ] `docs/03-project-map.md` updated if files were added or responsibilities moved.
- [ ] `docs/00-decisions.md` updated if a decision was made.
- [ ] The task's acceptance criteria in `docs/04-tasks-phase-1.md` are checked off.
- [ ] No new `TODO` without a task ID next to it.

## 7. When you are unsure

Stop and ask. Do not guess at:
- Product behaviour not covered by the blueprint.
- Anything involving money, licensing, or third-party terms of service.
- Schema changes that would require a backfill.

Say what you would do and why, and wait.
