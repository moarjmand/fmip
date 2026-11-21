---
name: empty-states-p6
description: Package 6 (2026-11-08) canvas, live measurements and gotchas for empty cards, coverage, freshness stamps, Live-empty and followers
metadata:
  type: project
---

- Canvas "Stadiomind Empty States and Freshness": https://claude.ai/artifact/WoemWz8CudHrtZ6b3irJnm (Main, P6-1..P6-7). Spec: E:\FMIP\ops\reports\ui-review-2026-11-05\P6-mockups-fa.md. Nobody saw it rendered. Css assets (this canvas): base 2bf0bcb8..., p3 f76a7985..., p4 72374de6..., p5 6264946d..., p6 e5282e955b3df3e8cabfb7d561991058 (.pr0 today's card, .pr1 one-line details row, .gh6 group heading, .nsA/B/C row label, .nx6 next-match card). Working folder scratchpad p6build. Copying assets between canvases: publish asset:true from_url asset_ids.
- Facts 2026-11-08: home phone hero still has full empty founder (111) + community (237) cards + note (60); match-page ProductRow is 97px on a phone (FA 78/99/78), not D-365's 72; "Available" shows 11 times on a fully available match page (coverage block 334px); scores phone has 24 group stamps = 624px, only 6 of 24 fit inline even when shortened; LIVE-empty page keeps a founder card; "0 followers" moved from hero to Team details.
- The rail's "next" card is a curated pick (Crystal Palace v Liverpool 14:00), not the earliest kick-off (Rizespor v Erzurumspor 10:30): "next kick-off" copy must use the earliest.
- Gotchas: a second browser tab (tab-1) can appear unprompted: always pass tabId "seed" to browser calls; Bash has no python3 (use node/sed); a very long Bash `ls` of the claude temp dir floods output.
