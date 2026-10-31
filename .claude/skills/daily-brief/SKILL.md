---
name: daily-brief
description: Write the maintainer's one-page Persian brief for FMIP / Stadiomind from the team's findings and reports, the open pull requests, the task tables and pending decisions; keep the weekly plan and review and the risk log (RAID). Use for the morning brief, the Saturday weekly, or when the maintainer asks "what is going on".
---

# The daily brief and project management (T-1682, D-328)

The method of the `chief-of-staff` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## Inputs (read, never change)

- `E:/FMIP/ops/findings/<today and yesterday>.jsonl`, and every report written today:
  `E:/FMIP/ops/reports/*/<today>*.md` (the code reviewer names its reviews `<date>-<branch>.md`).
- `E:/FMIP/data-audit/reports/<today>.md` (the data auditor).
- `E:/FMIP/ops/brief/` (the last brief: what you said is open), `E:/FMIP/ops/raid.md`.
- Open pull requests: `gh pr list --repo moarjmand/fmip --state open --json number,title,headRefName,statusCheckRollup`
  (on this machine `gh` is `"/c/Program Files/GitHub CLI/gh.exe"`, run with
  `env -u HTTPS_PROXY -u HTTP_PROXY -u NO_PROXY`).
- Work done: `git log --since=24.hours --oneline origin/main` after `git fetch -q origin`.
- Open tasks: rows starting ``| `[ ]` `` in the two newest phase files
  (`ls docs/04-tasks-phase-*.md | sort -V | tail -2`; the roadmap's "current" marker is not kept up
  to date), and decisions with `**Status:** Proposed` in
  `docs/00-decisions.md`.

Read-only git is fine (`git log`, `git merge-base --is-ancestor` to tell a stale PR whose commits
are all on main). Findings come first; a report without findings in the day's file is still read,
and the brief says which agent wrote no findings.

## The decisions ledger: `E:/FMIP/ops/decisions.md`

One row per decision put to the maintainer: the date first raised, the question, the options, the
recommendation, and the answer with its date once given. The brief takes each open decision's age
from here («۳ روز در انتظار», "3 days pending"); a decision is never dropped from it unanswered.

## The brief: `E:/FMIP/ops/brief/<YYYY-MM-DD>.md`, Persian, one page

1. **وضعیت** (status): one line, a traffic light for the site (from ops-release), the data
   (from the data auditor) and the work in progress.
2. **مهم امروز** (today's important): at most five items, critical and visible first, each one
   line with its evidence and its owner. Only what is new or changed since the last brief. The rest
   go, one line each, under «در انتظار» ("waiting") at the end, never dropped.
3. **تصمیم‌ها** (decisions): each decision the maintainer must make, in one sentence. Each comes
   with 2–3 options, your recommendation first and marked «پیشنهادی» ("recommended"), and what
   happens if nothing is decided. At most three a day; the rest wait in the list.
4. **در جریان** (in progress): open PRs and their checks, running jobs, what each finding's owner
   is doing.
5. **هندآف‌ها** (handoffs): proposed tasks for the engineering session, also written to
   `E:/FMIP/ops/handoffs/<date>.md` with the finding ids they close.

Never in a brief: a reminder about renewing a subscription, rotating keys, or translators; a secret;
a card of the team board; an item without evidence. Merge duplicates across agents into one item
naming both.

## Saturday: the weekly (in the same file, after a `---` separator)

- **The week's review:** what was done (merged PRs, closed findings), what slipped and why.
- **Next week's plan:** three to five priorities from the open tasks and findings, with a cap on
  work in progress (no more than two changes open at once).
- **RAID:** update `E:/FMIP/ops/raid.md`. It has four tables (Risks, Assumptions, Issues,
  Dependencies), each row with an owner and a next step; close rows that are done.
- **The team's scorecard** (monthly, the first Saturday): for each agent, findings confirmed vs
  false alarms, and its cost if known; propose retiring an agent nobody acted on for a month.

## The golden set: what the brief must not miss

| Situation | The brief must |
|---|---|
| A critical data fault visible today (e.g. "Pens 0–0", 2026-10-31) | put it first, with the fix's state |
| A PR green and waiting | say so, with the next step (merge, deploy, screenshots) |
| A decision pending for days (e.g. the Watch section) | keep it in the list, aged ("۳ روز در انتظار" = "3 days pending") |
| The same fault from two agents | one item, both named |
| Nothing new | say «چیز تازه‌ای نیست» ("nothing new") in one line, not a padded page |
