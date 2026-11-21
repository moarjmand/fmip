---
name: numbering-and-lookups
description: How to find the next free D/T numbers and migration timestamps, and lookups that took time (module name clashes, missing console owner role, no encryption at rest) as of 2026-11-15
metadata:
  type: reference
---

- Next free D/T: `git fetch`, then max `^## D-` in `git show origin/main:docs/00-decisions.md`, max `T-1xxx` across all `origin/main` docs, each `origin/t-*` branch's decisions/tasks file, and `gh pr list` titles. Local main lags origin (2026-11-15: local D-425, origin D-426). Looping all branches in one command can exceed 120 s; write the branch list to the scratchpad first.
- Migration timestamps encode the task: `17659018xx000` = T-18xx (e.g. 1765901832000 = T-1832).
- `apps/api/src/modules/social/` is the friends graph, not social media; the publishing module was proposed as `social-publishing` (D-427 draft, 2026-11-15).
- As of 2026-11-15: the agents console has no owner/maintainer role (any console user may do anything); no secret is encrypted at rest anywhere (only HMAC with SESSION_SECRET in identity); `news` exports no read of headlines by entity. Re-check before relying on these.
- 2026-11-17: D-446 and T-1863..T-1867 drafted (renumbered: T-1861 and T-1862 went to the competitions-menu flake and the news betting rule) (not committed) for duplicate-person merges; re-check origin before reusing.
- Person references: 24 FK columns in 22 tables (grep `REFERENCES person` in migrations) plus polymorphic `followed_entity`, `entity_alias`, `entity_media`, `article_entity`, `message.card_id`, `audit_log.target_id`. No forecast/prediction/rating table names a person; `input_snapshot` is trigger-immutable. Per-person provider jobs pick `min(pm.external_id)` (ingestion/internal *-store.ts).
- Decision format on origin: `## D-xxx — title`, `**Status:** ... · **Task:** ...`, `**Context.**`, `**Decision.**` (numbered), `**Rejected.**`, `**Consequences.**`. Task rows: `| \`[ ]\` T-xxxx | what (D-xxx) | depends | \`- [ ]\` criteria |`.
- 2026-11-19: origin max D-453, T-1876; newest migration `1765901886400` (T-1864 broke the 17659018xx000 pattern) -- a new migration must sort after it (node-pg-migrate ^9 refuses an unrun one preceding a run one). D-454 drafted for social video (not committed).
- Server sizing for load questions: compose says 2-core 4 GB VPS, no `mem_limit`/`cpus` on any service; ops snapshots at `E:/FMIP/ops/reports/ops-release/snapshots/` (2026-11-18: 1,735 MB available, load ~2.8). Card fonts are Latin only; Persian face is Vazirmatn (D-089).
