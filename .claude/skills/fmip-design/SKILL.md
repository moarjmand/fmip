---
name: fmip-design
description: Design for FMIP / Stadiomind - mockups of a visible change on real data in the Stadiomind design system, and a design review of a page or a change's screenshots for consistency, hierarchy, accessibility (WCAG 2.2 AA), RTL and Persian typography, dark mode and phone width. Use before building any visible change, and on the screenshots of one before it is deployed.
---

# Design (T-1684, D-328)

The method of the `designer` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## The system you design in

- **Tokens:** `apps/web/src/app/tokens.css` (canvas, surface, text, accent amber `#8a5300` and brand
  `#eba53c`, the model's teal, danger, live; their dark values) and `globals.css`. Never a raw
  colour (a spec refuses them, `raw-colours.spec.ts`).
- **The design system artifact:** "Stadiomind Design System"
  (`https://claude.ai/artifact/XXXSf9yhanxxCLcMtuYyrC`): read it with the Artifact tool's `read`.
- **The brand and its decisions:** Stadiomind, English first, Sofascore and Opta as the taste
  (the 2026-10-24 brief), and the redesign decisions D-256 onwards; the moments rail D-300 to D-302.
- **Type:** Vazirmatn for both scripts, tabular numbers for scores and tables.
- **Rules that are not taste:** logical properties only (rule 7; Stylelint and ESLint refuse the
  physical ones), the coverage states (rule 3: a missing module says so, never an empty box), the
  freshness line on live surfaces (rule 4), the three prediction products visibly apart (rule 6).

## A mockup (before building)

1. Read the request, the page as it is today (the live site, both locales), and the data the page
   will really have (ask the engineering session for a sample, or read it through the API's public
   pages). Use real teams, real numbers; never invented ones presented as real.
2. Draw it on a Design canvas (the Artifact tool: `quickstart` with intent `design`, then the type's
   instructions), one artboard per state: desktop and 375 px, English and Persian, light and dark,
   empty and loading and stale where they exist.
3. Write beside it what changes for the user, which components and tokens it uses, and any new
   component, so the engineering session builds exactly that.
4. The maintainer approves the design before it is built; offer two directions only when the
   choice is real.

## A design review (of a page or of release screenshots)

**Before you look:** the site may open in "Lite mode" on a slow connection, which skips the web
fonts; turn it off with its switch in the banner (a display preference, allowed) so Vazirmatn
loads, or say that typography was not checked. The theme switch cycles dark, system, light: set
it back to system when you finish, as you reset the width.

**The states, at least:** each page in English and Persian at desktop and 375 px, and one of them
in dark; add more only where the change is about them. About 35 tool calls for two pages.

**Contrast, in one call per page** (paste into `javascript_tool`):

```js
(() => { const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return 1; const [r,g,b] = m.slice(0,3).map(v => { v /= 255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; }); return .2126*r + .7152*g + .0722*b; };
  const bg = e => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(.*, 0\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
  const out = []; for (const e of document.querySelectorAll('body *')) { if (!e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e), a = lum(s.color), b = lum(bg(e)), r = (Math.max(a,b)+.05)/(Math.min(a,b)+.05), big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    if (r < (big ? 3 : 4.5)) out.push([e.textContent.trim().slice(0,30), r.toFixed(2)]); } return out.slice(0, 12); })()
```

Check, and write each issue as a finding (prefix `des`) with the page, the state and a fix:
- hierarchy: the one thing the page is for comes first; nothing competes with the score;
- consistency with the system: tokens, spacing scale, radius, the same component for the same job;
- WCAG 2.2 AA: text contrast 4.5:1 (3:1 large), focus visible, targets at least 24 px, no meaning
  by colour alone (the live dot has a word);
- Persian: mirrored layout, numerals as the locale shows them, no clipped Vazirmatn descenders
  (only with the web fonts loaded: a system fallback is not a finding), every Latin name isolated
  (`bdi`), players as well as teams, so parentheses and punctuation do not jump;
- 375 px: no horizontal scroll, tables scroll in their own container, nothing under the system bars;
- dark mode: every surface from the tokens, no light-only image;
- data honesty: no module that looks filled when the data is missing.

## The golden set

| Case | What the review must say |
|---|---|
| MLS conference tables side by side in Persian at 1024 px, squeezed | tables need 1280 px side by side; stack below (fixed in #779) |
| "Pens 0–0" under a final score (D-327) | a shoot-out line with no shoot-out: data honesty (check it on a cup match with extra time or a shoot-out; with none on the page, write "not applicable") |
| Persian scorer lines with Latin player names not isolated (2026-10-31) | `bdi` for players too |
| Scorer names broken inside the name at 375 px (2026-10-31) | keep a name on one line (`white-space: nowrap` on the name, wrap between entries) |
| The hybrid design choices (Analyst + Front Row) | follow the board-by-board decisions already made, do not reopen them |
