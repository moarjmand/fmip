---
name: share-cards-p10
description: Package 10 (2026-11-13) share cards and brand line: canvas link, real data used, css/crest assets, measured facts, tool gotchas
metadata:
  type: project
---

- Canvas "Stadiomind Share Cards": https://claude.ai/artifact/Syanxx5swD4XD8VvBzXVRh (Main, P10-1 brand 10 options, P10-2/3 team T1-T10, P10-4 states, P10-5 previews, P10-6 brand line). Spec: E:\FMIP\ops\reports\design\2026-11-13-share-cards-fa.md. Nobody saw it rendered (private canvas, browser pane hidden).
- Assets in that canvas: p10.css cf70f79f795ddc80d2198d1302408838; crests (72px webp, ICC stripped) Arsenal f657fd5d..., Liverpool 4077e10d..., Persepolis 61d865ae..., Arsenal Tivat b89f2860... Sources: scratchpad cv/ (copy lost after session; boards are readable from the canvas).
- Decisions behind it: d-2026-11-01-02 (one brand card + one team card, draw several), d-2026-11-09-02 (line "record in public"). My top 3: brand B10, B1, B9 (B5 held for model page); team T1, T4, T2 (T6 fourth: colour data).
- Facts measured 2026-11-13: only match page has og image; home and /model-accuracy have no og:image and twitter:card=summary; card faces have no Persian glyphs (lib/card-fonts.ts), T-1309 keeps card words English; team page band fill is in `[data-band]` style (Arsenal #e10000, Liverpool #e41e2c, Persepolis #cc0000, Arsenal Tivat #0000ff); Arsenal Tivat (3b8277dd-8e5a-4676-a3c3-b2e93e7e1eb2) has no competition, no next match, no results, no localised name: the best empty-state test team; accuracy page 880 matches 58% vs guess 33% (5 Oct-12 Nov), weekly edge 23/16/9/25/16/20 with n 104/176/182/171/242/5.
- Gotchas: browser pane goes "hidden" after navigate (JS and screenshots time out, fetch in javascript_tool worked only before); file:// pages cannot be scripted; so layout was checked only by PIL text widths on the card TTFs (public/fonts/card). No team API through /api/..., read team HTML pages with fetch and DOMParser instead. A python text patch of css is fine; artboards were written with Write. sc-for with one level and literal repeated card markup worked as the pattern for 100 card renders.
- Charter reminder: never mention translators in reports (rule 2).
