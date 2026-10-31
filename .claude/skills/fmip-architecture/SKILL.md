---
name: fmip-architecture
description: Architecture advice for FMIP / Stadiomind - the options and trade-offs for a substantial change, a draft decision in the project's format, module and provider boundaries (boundary-check.sh), the tech-debt register, and a review of a design against CLAUDE.md and the existing decisions. Use before any task that adds a module, a table, a provider, a job or a cross-cutting rule, or when a change keeps fighting the code.
---

# Architecture (T-1684, D-328)

The method of the `architect` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## Before a substantial change

1. **Read what exists, narrowly:** `docs/03-project-map.md` for the files, `docs/02-architecture.md`,
   and the decisions on the subject (`grep -n "^## D-" docs/00-decisions.md` then the relevant
   ones). Never scan the whole repository (CLAUDE.md section 3).
2. **State the problem** in two or three sentences with its evidence (a defect, a number, a request).
3. **Two or three options,** each with: what changes (modules, tables, jobs, contracts), the
   migration and backfill it needs, what it costs in provider requests and server load, how it
   fails, and how it keeps CLAUDE.md's rules (identity by UUID, provider isolation, coverage
   states, freshness, immutable forecasts, the three products apart, RTL, reproducible ratings,
   audited admin actions).
4. **A recommendation** and a draft decision in the project's shape: `## D-xxx — <title>`,
   Status (Proposed), Context, Decision, Rejected, Consequences (files). Write it to
   `E:/FMIP/ops/reports/architect/<date>-<subject>.md`; the engineering session puts it in
   `docs/00-decisions.md` with the next number once the maintainer agrees.
5. **What to ask the maintainer:** anything on money, licensing, third-party terms, or a schema
   change needing a backfill (CLAUDE.md section 7), as one question with options.

## Monthly health

Where things are: the API's modules under `apps/api/src/modules/<module>/` (public service at the
top, `internal/` for the rest), migrations in `packages/db/migrations/`, provider adapters in
`packages/ingestion/src/adapters/`, the web app in `apps/web/src/`, the model in `apps/model/`.

- `bash .claude/skills/fmip-architecture/boundary-check.sh`: module internals imported from outside
  and provider adapters outside ingestion (each a finding, prefix `arc`, with the public service
  that should be used instead), modules importing eight or more others, source files over 1,500
  lines, migrations sharing a timestamp.
- The tech-debt register `E:/FMIP/ops/tech-debt.md`, in Persian with identifiers in English: a table
  `| # | what | where | why it costs | cheapest fix | size (S, M, L) | status (open, planned, paid) |`,
  rows numbered once and never renumbered, read from the month's findings, `TODO (T-xxxx)` comments
  and workarounds in recent decisions; the three worth paying next go to the brief.

## The golden set: designs that needed a second decision

| First design | What went wrong | The question that would have caught it |
|---|---|---|
| One score kind read as "the result" | the 90 minutes shown for extra-time matches (D-317) | what does each stored value mean, and who reads it? |
| Every stage-less match of a league in its table | play-offs counted in tables (D-325) | which rows does this query take, across every competition we hold? |
| Zones looked up by the shown season label | Brasileirão zones never served (D-323) | is the key the stored identity or a display string? |
| Any period score the feed sent stored | "Pens 0–0" on matches without one (D-327) | can the source send a value for something that did not happen? |
| `conversations` importing `fixtures/internal/change-feed` (known since 2026-10-31; report it as open until fixed, not as new) | a module boundary crossed | does this use the other module's public service? |
