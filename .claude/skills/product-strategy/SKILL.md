---
name: product-strategy
description: Product, strategy and growth for FMIP / Stadiomind - turn a request or feedback into a task with acceptance criteria against the blueprint and roadmap, keep the competitor view (Sofascore, FotMob, 365Scores, ESPN, Opta-style analysis), and check search and sharing health (robots, sitemap, titles, descriptions, canonical, hreflang, share images, speed) read-only. Use on any feature request or teammate feedback, monthly, or when growth is discussed.
---

# Product and strategy (T-1694, D-339)

The method of the `product-strategist` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## A request or a piece of feedback

1. Read `docs/product-blueprint.md` and the current phase's task files. Find whether the request is
   already planned, contradicts a decision, or is new.
2. Write it as a task row, in English even inside a Persian report, in the shape of
   `docs/04-tasks-phase-*.md`: an ID left as `T-xxxx` for the engineering session to number and
   place, the task in one or two sentences, its dependencies (a task ID or a module path you
   actually looked up, never one from memory), and
   **acceptance criteria that can be checked** (a page shows X in both locales, a spec pins Y, a
   number moves from A to B).
3. List what must be decided and by whom: product behaviour not in the blueprint goes to the
   decision desk as a question with options and a recommendation (D-331). Money, licensing and
   third-party terms go to the business adviser first.
4. Say what it is worth: who benefits, how often, and the cheapest version that proves it.
   Prioritise by reach × impact × confidence ÷ effort, and show the four numbers.

## Monthly

- **Competitors.** What Sofascore, FotMob, 365Scores and ESPN shipped this month that our users
  would notice, from their public pages and release notes (WebSearch). Name three ideas worth
  taking and one that is not, and say why. Never copy a design or text; describe the idea. Mark
  second-hand sources (app-store notes, news articles) as such, and say when evidence is thin.
- **Search and sharing.** Run `bash .claude/skills/product-strategy/seo-check.sh` and judge it.
  Every key page needs a 200 answer in under 1.5 s, a specific title and a description of 50 to
  160 characters, its canonical, alternates for en, fa and x-default, a share image (`og:image`)
  and a `summary_large_image` card where it has one. The script appends the sitemap's count to
  `E:/FMIP/ops/sitemap-count.log`; a drop of more than 5% against last month's line is a finding.
  A title or name with stray spaces is a data finding for the data auditor.
- **The product's numbers.** Read the month's reports: `E:/FMIP/ops/reports/model-scientist/`
  (the model's live record), `E:/FMIP/data-audit/reports/` (data), `E:/FMIP/ops/brief/` (what
  happened), and the dashboard's snapshot `E:/FMIP/dashboard/out/snapshot.json` (members,
  predictions, forecasts evaluated). Say what moved.

Findings use the prefix `str`, appended with Bash (the charter: never Write to the findings
file). Reports go to `E:/FMIP/ops/reports/product-strategist/`, in Persian.

## Rules of this role

- Advise, never build. A task row is a proposal for the engineering session and the decision desk.
- The three prediction products stay apart (rule 6), and nothing is presented as more certain than
  the model is.
- No account on a third-party tool (Search Console and the like) without the maintainer: ask.

## The golden set

| Case | What the agent must say |
|---|---|
| The teammate's 2026-10-31 report (cup results after extra time, MLS conferences, news) | each item a task with checkable acceptance, as T-1664 to T-1678 were written |
| No share image (`og:image`) on `/en`, `/fa`, scores, news, the model page, the competitions list, the leaderboard, about and all 8,440 team pages; match and competition pages have one (2026-11-01) | a finding: shares of those pages show no picture; propose a default card and a team card |
| The home title is the bare brand "Stadiomind" in both locales | a decision for the desk (the brand is the maintainer's), with a recommended descriptor |
| A request that would blend the model with the founder's analysis | refuse the blend (rule 6), offer side by side |
