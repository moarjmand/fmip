---
name: console-security-review-leads
description: Leads for reviewing agents-console security changes (redaction, publisher ssh, CSP/Caddy) and cheap proofs that worked on PRs #944/#947/#949
metadata:
  type: reference
---

- **Caddy ordering proof:** `docker run --rm -e SITE_HOST=example.test -e CONSOLE_HOST=agents.example.test -e ORIGIN_EXTRA_RANGES= -v "<deploy dir>:/etc/caddy:ro" caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile`
  (MSYS_NO_PATHCONV=1, Windows path for -v). Diff the JSON against main's to prove the public site is unchanged. Named path-only
  matchers sort before unmatched `header`; with `defer` the earlier route applies last, so it wins.
- **Redaction proof on real data:** `node <worktree>/packages/console-publisher/src/publish.ts build --out <scratch>` run from the main
  checkout (ROOT = cwd; reads E:/FMIP/ops; read-only except --out). Only the latest brief is published, so also import `redact.ts`
  directly and run it over every `ops/brief/*.md` with the real ledger.
- Team notation that id-based redaction misses: ranges `sec-…-01..12`, `07/09`. The chief of staff lists many agents' ids in one bullet,
  so block-level redaction over-removes (rev-2026-11-19-04/06).
- The publisher's `sync` throws mid-loop on any failed `finishRemote` after `take-commands`. Any CLI contract change is order-dependent (API first).
- CI logs: on 2026-11-19 the blob host behind `actions/jobs/<id>/logs` timed out from this PC; `check-runs/<id>/annotations` still
  gave the failing spec and line.
- `community-search.http.spec.ts:280` (0.667 vs 0.5) is a flaky failure unrelated to the PR (rev-2026-11-19-09).
