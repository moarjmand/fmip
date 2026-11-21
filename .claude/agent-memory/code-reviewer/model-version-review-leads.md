---
name: model-version-review-leads
description: Leads for reviewing a new model version / candidate PR - contract example regeneration vs API specs, harness defaults, model-watch one-look rules, reproducing a fit
metadata:
  type: project
---

- `tests/test_service.py::test_writes_the_contract_examples_apps_api_reads` rewrites
  `apps/model/contract/*.example.json` from the published version on every pytest run; API specs
  (`forecast.http.spec.ts:200` pinned `dixon-coles-elo@0.6.0`) read them. turbo runs `@fmip/model` and
  `@fmip/api` tests concurrently, so a stale example hides on main and breaks deterministically once
  committed (PR #937, rev-2026-11-17-21; fixed: the test now compares, writes only with FMIP_WRITE_CONTRACT_EXAMPLES=1). Grep the API specs for the old version string.
- Since PR #937 (3a898b2a): `version.backtest_version`/`refuse_calibrated` guard inputs, elo_prior, lineups, new_divisions,
  cross_league, compare (default skips calibrated; `published` nameable). NOT guarded: `tune.py --candidate <file>`.
  Lead stays: any version feature applied only in `service/forecaster.py` (e.g. D-450 `calibration`)
  is silently ignored by a harness unless it is refused there.
- `model-watch.sql` has a `one_look` VALUES list (model, from kick-off, look count) that withholds figures;
  a new decision with its own one-look must add a row there and a SKILL clause.
- `model-watch.sql` paired block prints diff + 95% interval for every shadow version weekly, and the
  SKILL's D-140 rule looks at 300 paired: a decision with its own one-look count must amend the skill.
- Scheduled one-off lab runs live in `C:/Users/arjma/.claude/scheduled-tasks/<name>/` (e.g.
  `fmip-xg-forward-test-2027-01`); the lab ledger is `E:/FMIP/ops/model/ledger.json` (print with
  `PYTHONIOENCODING=utf-8`).
- Reproducing a fitter: run its CLI from the worktree's `apps/model` with the main checkout's
  `.venv/Scripts/python.exe -m ...` (cwd shadows the editable install), `--out`/`--reports` into the
  scratchpad, then diff with CR stripped.

**Why:** PR #937 review found all four; the CI failure was invisible from the PR description.
**How to apply:** on any PR adding/promoting a model version or regenerating contract examples.
- Probe `model-watch.sql` blocks without data: build a file with `\set counted '<synthetic SELECT via generate_series>'`
  and `\set cur_model '...'` plus the block's lines, `docker cp` into fmip-postgres-1, run with
  `PGOPTIONS='-c default_transaction_read_only=on' psql -d postgres` (no password needed in the container).
