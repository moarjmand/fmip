---
name: model-language-p3
description: Package 3 (2026-11-06) canvas and facts: model bar inventory, steps and contrast, accuracy page numbers, runtime facts for canvas boards
metadata:
  type: project
---

- Canvas "Stadiomind Model Language": https://claude.ai/artifact/D5urtwcmeoJun3Xbe8rZCk (boards Main, P3-1..P3-6; css assets: base /_blob/b8bbf080104134cbc92c61c8a0b614c3, p3.css /_blob/bb228bf18ce3d7bf72818be21da5d19e; a changed css is a new upload). Report: E:\FMIP\ops\reports\ui-review-2026-11-05\P3-mockups-fa.md. Nobody saw it rendered.
- Inventory 2026-11-06: 10 placements, 6 renderings, 2 colour logics (A tokens model/prob-draw/prob-away; B model/55/25), 2 saffrons for "happened". Proposed one bar: steps by rank bg-model, /75, /50 (Day 5.17/3.26/2.10, Night 8.11/5.11/3.01 on card), ring+tick in text colour, no new token.
- Accuracy page facts 2026-11-06: 727 matches, correct 57.6% vs 33%, RPS 0.203 vs 0.245 (17% less error), 22 competitions (13 with 30+ matches), 5 weekly points (edge 23/16/9/25/12%). Public API has NO calibration bins and NO per-version split (two published versions blended); admin type AdminAccuracySeries has per-version series. Page heights now: desktop 4668, phone 10347.
- Canvas runtime (read dc-runtime.js): nested sc-for works (scope is spread), style attribute holes are parsed fine, tables are handled. A class-number trick (.nN{--n:N}) drives flex-grow/heights without style holes. The type's instructions say write boards with the Write tool, not a generator script.
- Live widths: scores row cell 208 (phone 196, bar 6px), headline bar 802 / 309 phone, version bar 388 / 259, card 276-443. Browser pane was in dark by default (system theme).
