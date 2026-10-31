---
name: fmip-review
description: Review an FMIP / Stadiomind branch or pull request against CLAUDE.md's rules and the project's known failure modes - canonical identity, provider isolation, coverage states, freshness, immutable forecasts, the three prediction products, RTL, migrations, docs - with mechanical checks first and a reasoned read of the diff, in a fresh context. Use before merging any PR, or when asked to review a change.
---

# Code review for FMIP (T-1682, D-328)

The method of the `code-reviewer` agent. Read `.claude/skills/team-charter/SKILL.md` first.
You see the change with fresh eyes: read the diff and the code around it, not the author's
explanation first. Report what is wrong, with file and line; never rewrite the change.

## Steps

1. **Scope.** `git fetch -q origin`, then `git diff --stat origin/main...HEAD` (or the PR's
   base: `gh pr view <n> --json baseRefName,headRefName,files`). Above about 15 files, review the
   code first and the docs last.
2. **Mechanical checks.** `bash .claude/skills/fmip-review/review-checks.sh [base]` for a branch;
   `WORKTREE=1 bash ...` for a change not yet committed (it adds uncommitted and untracked files).
   Each FLAG is a lead: open the file and judge it.
3. **Read the diff** (`git diff origin/main...HEAD -- <path>`), file by file, with the code each
   change touches. For each change ask the questions below.
4. **Run what proves it, cheaply.** Shell: `bash -n <file>`. Hooks: `node .claude/hooks/test-guard.mjs`
   (its cases are `.claude/hooks/guard.cases.json`; to try a new input, write it to a JSON file
   rather than quoting it inline, since Git Bash mangles backslashes in `node -e` and heredocs).
   TypeScript: the changed package's specs
   (`pnpm --filter <pkg> exec vitest run <files>`), `tsc --noEmit -p <pkg>`, prettier on the
   changed files. Build the workspace packages it imports first if their `dist` is older than
   the change (`pnpm --filter @fmip/contracts build`, `@fmip/ingestion`): a stale `dist` is the
   usual cause of a false type error.
5. **Verdict.** `APPROVE`, `APPROVE WITH NOTES` or `CHANGES REQUESTED`. Write the review in
   Persian to `E:/FMIP/ops/reports/code-reviewer/<date>-<branch>.md`, and append one finding per
   blocking or major item to the day's findings file (the charter's format, prefix `rev`), so the
   chief of staff sees it. Each finding in the review as
   `severity · file:line · what is wrong · why it matters · a suggested direction`. Blocking
   findings first. At most two rounds on one change; after that, hand it to the maintainer.

## The questions (CLAUDE.md section 4 first)

- **Identity (rule 1):** is anything keyed or joined by a name instead of a UUID? Does a provider
  id appear outside `provider_mapping`?
- **Provider isolation (rule 2):** does a provider field or vocabulary reach `apps/api` outside
  the ingestion module, or `apps/web`, or a contract in `packages/contracts`?
- **Coverage (rule 3):** missing data shown as `available`, `limited`, `not_supplied` or
  `delayed`, never as an empty module that looks populated, never an invented value?
- **Freshness (rule 4):** does a live surface carry `last_updated_at`, and say when it is stale?
- **Forecasts (rule 5):** is a stored forecast ever updated in place?
- **Three products (rule 6):** model, founder's analysis, community: kept apart in data, API and UI?
- **RTL (rule 7):** logical properties only; does the change render in the `fa` locale?
- **Ratings (rule 8):** still recomputable from stored predictions and settlements?
- **Admin actions (rule 10):** a high-impact action writes `audit_log` (actor, time, reason, previous value)?
- **Migrations:** new file, timestamp later than every existing one and unique, an up and a down
  section, data changes tried on a copy, no backfill without the maintainer's approval.
- **Docs (section 6):** project map for new files, a decision for a decision, the task row's
  acceptance boxes, `.env.example` for a new variable.
- **Tests:** does a spec fail without the change? Is the case that broke in production covered?
- **The reading that looks right:** scores have kinds (`current` after extra time, `full_time`
  90 minutes; D-317); seasons have a stored label and a shown label (D-256, D-323); league tables
  count league rounds only (D-325); shoot-out kicks are not goals (D-322).

## The golden set: defects a review should have caught

| Defect | Where it reached | The question that catches it |
|---|---|---|
| The 90 minutes shown for a match settled in extra time (D-317) | production | the reading that looks right |
| Zones looked up by the shown season label, so the Brasileirão's never appeared (D-323) | production | the reading that looks right |
| Every stage-less play-off counted in league tables (D-325) | production | the reading that looks right |
| Zeros of periods never played stored as scores (D-327) | production | coverage, never an invented value |
| Two migrations sharing timestamp 1765892000000 | main | migrations |
| `text = uuid` comparison in a data script | a production transaction (rolled back) | run what proves it |
| Prettier failures on two files (#791) | CI | run what proves it |
| `` \` `` escapes written into comments and docs by a script | a branch | read the diff |
