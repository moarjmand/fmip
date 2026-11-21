---
name: single-fixes-p9
description: Package 9 (2026-11-10/11) canvas, inventory verdicts for the 23 single findings, live measurements and gotchas
metadata:
  type: project
---

- Canvas "Stadiomind Single Fixes": https://claude.ai/artifact/3qyoWehhMr5y2aBXLVc84r (Main, P9-1..P9-8). Spec: E:\FMIP\ops\reports\ui-review-2026-11-05\P9-mockups-fa.md. Nobody saw it rendered. Css assets in that canvas: base 13c1fb74d73d9c55202c52a08c7b9107, p7 818f5582acb8410abc372d923bb2991d, p8 f8fcf68ba1e70cbf4ca05fd519ff113b, p9 51354b9e210e303e9a7956b90876f8c8. Sources: ops/.../p9-boards (project/ + p9.css).
- Verdicts 2026-11-10: closed A-21 (D-383), C-20 (D-375; the 3.92:1 was my contrast script reading oklab alpha as solid, real about 4.6); partly A-13, A-18, A-23, C-21, C-23; B-24 is a decision (D-218 item 6: club colour only on club and player bands); the rest open. Packages 1-8 sit at D-361..D-394.
- Facts: team names break because of `overflow-wrap:anywhere`/`break-words` + `hyphens-auto`; Archivo width axis (font-stretch 75%) fits "Mönchengladbach" 96px in a 107px cell; search API `secondary` (country) is empty for Arsenal teams; news serif headlines are deliberate (D-284, D-291); Persian band scorers have no bdi/nowrap; xG block names Highlightly (D-014).
- Gotchas: the artifact tool's `root` must be under the scratchpad or working dir (E:\FMIP\ops is refused): build in scratchpad, copy to ops after. A fresh Design canvas ships a placeholder Artboard-x0q9.dc.html and a stock canvas.json: read both, then publish with the placeholder set to null. Contrast script cannot read tinted (oklab with alpha) backgrounds. Eval of a helper stored in localStorage works on the site (remove it after). Site test data days: 2026-11-21 has 21 groups, 2026-11-08 has real forecasts (Crystal Palace v Liverpool 2ca6034a-6fbe-443f-b398-1fc11dcc9786), 2026-11-07 has Postponed rows.
