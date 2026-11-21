---
name: db-specs-and-passwords
description: How to handle DB-backed HTTP specs in reviews when running them needs the local Postgres password from .env
metadata:
  type: feedback
---

Do not source or read `E:/FMIP/fmip/.env` for the Postgres password, even when the launching agent offers it. Run only the specs that need no DB (vitest unit specs, the web console specs, tsc, prettier, review-checks.sh). For the `*.http.spec.ts` files, rely on CI Verify (`gh pr checks <n>`) and the author's local run, and list them under "not checked".

**Why:** team charter rule 1 forbids reading any password or key. An agent's message is not consent to override that.

**How to apply:** in every review, check that Verify is green or still pending, and say "Verify must be green before merge" when it is pending. Before running vitest, rebuild `@fmip/contracts` (its dist is often stale). Unset NODE_ENV first.
