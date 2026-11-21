---
name: console-six-p12
description: 2026-11-19 agents console six-feature mock-ups: canvas link, how PNGs are built (html + playwright), data facts, tool gotchas
metadata:
  type: reference
---

- Canvas: https://claude.ai/artifact/US59kTNTy7dge7ETmu2YZJ (7 boards, each holds desktop+phone, light+dark PNGs as assets). PNGs, spec.md, generator: `E:/FMIP/ops/reports/console-review-2026-11-19/design/` (`tools/build.mjs [n]`, `tools/contrast.mjs`; the Artifact asset upload only reads the scratchpad, so copy PNGs there first).
- Console language is its own (sidebar at inline end, 20px cards, saffron brand button); tokens copied from tokens.css into `tools/lib.mjs`.
- Real facts: snapshot 2026-11-18 has 180 open (12 major, 110 minor, 58 info, 0 critical), no open decision, no failed run; the 2 same-subject findings `ops-2026-11-09-01` / `ops-2026-11-18-03` make the real "reject as duplicate" example. Scorecard numbers = agent-effectiveness.md table 2.1.
- Gotchas: long build (28 renders) exceeds the 120 s Bash limit, run in background; Persian digits `fa()`; Latin ids need `bdi`/`.ltr`; inline `style` beats class CSS in the generator.
