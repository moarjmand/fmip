---
name: fmip-qa
description: Test FMIP / Stadiomind like its users and its CI - a pull request's test coverage and targeted runs, a daily smoke walk of the live site in English and Persian at phone and desktop widths (layout, RTL, overflow, console errors, speed, stale or empty modules), and the screenshots a visible deploy needs. Use on every PR, daily, and before a visible deploy.
---

# QA for FMIP (T-1682, D-328)

The method of the `qa-engineer` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## A. On a pull request

1. List the behaviours the diff changes (`git diff --stat origin/main...HEAD`, then the code).
2. For each behaviour, find the spec that pins it (`*.spec.ts` beside the file, `apps/model/tests/`,
   `apps/web/e2e/`). Say which behaviours have none.
3. Run the targeted specs: `pnpm --filter <pkg> exec vitest run <files>` (build `@fmip/contracts`
   and `@fmip/ingestion` first if their `dist` is stale; API store specs need the local Postgres,
   `pnpm migrate up --no-check-order`, and `--hookTimeout 180000` when the machine is busy).
4. A gap that matters is a finding with the test to add, described as a case (input, expected).
   Write the test yourself only when the engineering session asks, in its branch.
5. A visible change: run section C on the preview or the branch build.

## B. The daily smoke walk (live site)

Site: `https://traveltohormuz.ir`. Use the built-in browser; read with `javascript_tool`
(`document.body.innerText.slice(a, b)` for long pages: `get_page_text` stops near 5,000
characters), screenshot only to show a fault. Find the pages to walk by their links:
`[...document.querySelectorAll('a[href*="/match/"]')].slice(0,10).map(a=>[a.innerText.trim(),a.href])`
on `/en/scores` (matches), the same with `/competition/` on `/en/competitions` and `/player/` on a
match page. Walk, in `en` and `fa`:

| Page | Path | It must |
|---|---|---|
| Home | `/en`, `/fa` | load in 2.5 s on a second, warm load with the pane visible (a first, cold load is reported and flagged only above 6 s; a hidden pane or "Lite mode" makes timing unreliable: say so); the moments rail shows matches with times or minutes |
| Scores | `/en/scores` | list today's matches; a live one shows a minute and an update within the last 5 minutes (rule 4); "Updated … ago" on a match not started is normal |
| A finished match | from Scores | score, scorers, a stage or round name; no "Pens" without a shoot-out; extra time shown as "90′ x–y". For a cup match with extra time or a shoot-out, look at yesterday's scores or a cup competition; if there is none, write "not exercised, no candidate" |
| A live match, if any | from Scores | it moves (minute, score) between two reads a minute apart. Checking it against an outside source is the data auditor's job (its P1), not yours |
| A league table | Competitions → a league | clubs, played, points; zone marks with their legend |
| A player | from a match | the current team and a season's stats with their competition; a missing section says so (rule 3), never a blank table |
| News | `/en/news`, `/fa/news` | the first 30 story headlines are football; a source credit shown alone as a story is a finding |
| The model | `/en/model-accuracy` | numbers present, a date of the last evaluation |

At 375 px wide (`resize_window` preset `mobile`, then `desktop` again) for Home, a match and a
table. On each page run this once and record what fails:

```js
(() => { const d = document.documentElement, t = document.body.innerText;
  return { dir: d.dir || d.getAttribute('dir'), lang: d.lang,
    overflowX: d.scrollWidth > innerWidth + 1,
    emptyText: t.trim().length < 200,
    brokenWords: /\b(undefined|NaN)\b|Something went wrong|Application error/.test(t),
    staleBanner: /out of date|data is delayed|not updated since/i.test(t),
    outsideViewport: [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect(); if (!r.width) return false;
      for (let p = e.parentElement; p; p = p.parentElement)
        if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)) return false;
      return r.right > innerWidth + 1 || r.left < -1; }).slice(0, 5).map(e => e.tagName),
    loadMs: Math.round(performance.getEntriesByType('navigation')[0]?.duration ?? -1) }; })()
```

Then `read_console_messages` with `onlyErrors` (`ERR_BLOCKED_BY_CLIENT` is the browser's own
blocking: ignore it). In `fa` the root must be `dir="rtl"`. Persian pages may show players,
venues and foreign headlines in Latin script: that is the data, not a fault.

## C. Release screenshots

For a visible change: the changed pages on real data, `en` and `fa`, desktop and 375 px, light and
dark when colours changed. Save them under `E:/FMIP/ops/reports/qa-engineer/<date>-<branch>/` and
list them; the engineering session shows them to the maintainer before the deploy.

## Report

Persian, `E:/FMIP/ops/reports/qa-engineer/<date>.md`: a pass/fail table per page and locale, each
failure as a finding in the charter's format (appended to the day's findings file), what was not
walked and why.

## The golden set: faults a walk should have caught

| Fault | Where |
|---|---|
| The live rail said 3–2 while the match was 4–2 (stale) | home, 2026-10 |
| Line-ups swapped between the sides | match page, 2026-10-28 |
| MLS conference tables squeezed side by side in Persian | competition page, 2026-10-31 |
| "Pens 0–0" on matches without a shoot-out | match page, 2026-10-31 |
| 2–0 shown for a 4–0 after extra time | match page, 2026-10-31 |
| Cricket, tennis and wrestling on the news page | news, 2026-10-31 |
