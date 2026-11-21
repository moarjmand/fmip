---
name: hook-and-ops-tool-review
description: How to test .claude hooks (team-guard.mjs, guard.mjs) and ops tools (finding.mjs) from a PR without touching the repo or E:/FMIP/ops; environment traps that fake failures
metadata:
  type: reference
---

- **Hook PR tree on disk:** `git clone -q --no-checkout E:/FMIP/fmip <scratch>/clone`, then
  `git fetch -q E:/FMIP/fmip refs/remotes/origin/<b>:refs/heads/pr refs/remotes/origin/main:refs/remotes/origin/main`
  and checkout. guard.mjs's shipped-migration cases need git (a `git archive` copy fails 3 of them).
- **team-guard.mjs (T-1885) inside the temp folder treats the repo as scratchpad** (21 false WRONGs): run
  `TEMP=<scratch>/faketemp TMP=<scratch>/faketemp node .claude/hooks/test-guard.mjs`. S.repo comes from the hook
  file's own path, so repo-relative probes (memory, finding door) need cwd/paths in the clone, not E:/FMIP/fmip.
- Probe harness: feed JSON with `agent_type`, `cwd`, `scratchpad_dir`, `tool_name`, `tool_input` to the hook via
  spawnSync; write cases with the Write tool (heredocs eat backslashes). ~0.2 s per call is Node startup.
- **Under T-1885 (from f358c056) PR code on disk is allowed only into scratch/temp:** `git worktree add --detach <scratch> <ref>`,
  `git archive <ref> | tar -x -C <scratch>`, `git clone --local <repo> <scratch>`. Not `-b`, not into the repo.
- **Use a fresh scratch clone per review round:** on 2026-11-20 the round-1 clone held 462 lines of edits nobody in this
  review made (someone reproduced in it). Check `git status --short` before trusting a reused clone.
- A changed hash of `E:/FMIP/ops/findings/*` after a test run is usually the daily team run writing today's file:
  hash all files except today's before blaming the tests.
- **finding.mjs tests:** `OPS_ROOT=<temp>` isolates; prove it with md5 of `E:/FMIP/ops/findings/*` before/after.
  Read-only `OPS_ROOT=E:/FMIP/ops node .../finding.mjs check` is safe (no lock, no write).
- C:\Users\arjma\Desktop\Mohammad\fmip is a junction to E:\FMIP\fmip (a second project path for sessions).
- No WebFetch in this agent: official-doc claims (e.g. hook input `agent_type`) are "not verified".
