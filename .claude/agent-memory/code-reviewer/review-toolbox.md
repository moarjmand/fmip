---
name: review-toolbox
description: How to run cheap proofs during a review (scratch Vitest render outside the repo, CI logs via gh api) and known false alarms of review-checks.sh
metadata:
  type: reference
---

- **Scratch render without touching the repo:** a config file in the scratchpad with no imports
  (`export default ({ root: 'E:/FMIP/fmip/apps/web', resolve: { alias: { '@': 'E:/FMIP/fmip/apps/web/src' } },
  oxc: { jsx: { runtime: 'automatic' } }, test: { include: ['<scratch>/probe/*.probe.tsx'], dir: '<scratch>/probe' },
  server: { fs: { allow: ['E:/FMIP', 'C:/Users/arjma/AppData/Local/Temp'] } } })`), run from `apps/web` with
  `pnpm exec vitest run --config <file>`. Importing `vitest/config` from the scratchpad fails (no package there).
  console.log is swallowed; write output to a scratch file with `writeFileSync`. The scratchpad persists
  between runs: old `*.probe.tsx` files run too, so give each probe its own output file name.
- **Charts/claims rendered from a windowed slice** (e.g. latest 12 weeks): check every sentence's quantifier
  ("every week so far") against the full data, not the drawn slice (p3-model-language, rev-2026-11-06-03).
- **CI logs:** `gh run view --log-failed` refuses while any job is still running; use
  `gh api --allow-escape-sequences repos/moarjmand/fmip/actions/jobs/<job-id>/logs | sed 's/\x1b\[[0-9;]*m//g'`.
  gh is at `/c/Program Files/GitHub CLI/gh.exe`.
- **Always run `gh pr checks`:** the author's "green locally" list usually omits Playwright E2E and visual baselines
  (PR #854: both red).
- **False alarm:** `provider-leak` FLAG on `source: 'highlightly'` in web spec fixtures - the contract's own
  coverage `source` field, already on main in several specs.
- **Visual baselines** (`tests/e2e/visual.spec.ts`, 32 PNGs) run without an API: any header/shell height change
  alters all of them, and the match page there is its *unreachable* state (no `data-match-root`). Check the
  diff stat for `visual.spec.ts-snapshots/` (p4-phone-density, rev-2026-11-07-02).
- **Sticky header (D-376) leads:** menus inside `<header>` now share its z-30 context and no longer move with page
  scroll; check panel `max-h` against the tab bar (z-40) on short phones.
- **Branch head can move during a review** (the maintainer's session commits in the same checkout): re-check
  `git rev-parse HEAD` before writing the verdict and name the head reviewed.
- **Stale contracts dist:** the main checkout's `packages/contracts/dist` lacks a PR's new exports; for web specs use a
  scratch vitest config aliasing `@fmip/contracts` to `<worktree>/packages/contracts/src/index.ts` (no build in main).
- **Run a PR's specs without checking out:** `git worktree add --detach <scratch>/wtN origin/<branch>`, then
  PowerShell `New-Item -ItemType Junction` for `node_modules` and `apps/api/node_modules` pointing at the main
  checkout; run `./node_modules/.bin/vitest|tsc|prettier` there. Remove junctions with
  `[System.IO.Directory]::Delete(path)` (never rm -rf: it follows the junction), then `git worktree remove --force`.
- **API DB specs locally** (`ingestion-jobs.spec.ts` etc.): need `DATABASE_URL` (value in `.env.example`), `REDIS_URL`,
  `MODEL_SERVICE_URL`, a throwaway `SESSION_SECRET` (>= 32 chars) and `--hookTimeout=60000`. As of 2026-11-13 the local
  `fmip-postgres-1` schema is behind (no `fixture_stat_check`, no `zone_key`): those errors are environment, not the
  branch; compare with the CI Verify log (it migrates a fresh DB) before blaming a PR.
- **Exercise a migration's up without a scratch DB:** the psql guard hook refuses any drop statement (so no scratch
  database, no down section). Instead: awk the up section to a file, `docker cp` it and a test script into
  `fmip-postgres-1`, and run in DB `postgres` inside one `BEGIN ... ROLLBACK` with stub parent tables and a `SAVEPOINT`
  per case (`MSYS_NO_PATHCONV=1 docker exec fmip-postgres-1 psql -U fmip -d postgres -q -f /tmp/x.sql`). Nothing left.
- **Pure API rules spec in a worktree:** a scratch vitest config with no plugins (unplugin-swc is not resolvable from the
  scratchpad) and regex aliases for `@fmip/contracts/console` and `@fmip/contracts` to the worktree's `src`; for tsc a
  `tsconfig.review.json` with `rootDir: "../.."` and the same `paths`.
- Prettier for web files: `cd apps/web && pnpm exec prettier --check <paths relative to apps/web>`.
- Prettier on a scratch worktree fails (`@fmip/config` not found): run from the main checkout with
  `./node_modules/.bin/prettier --config ./prettier.config.mjs --check <worktree paths>`.
- **Author's migrated DB:** `fmip-postgres-1` usually holds `fmip_t<task>` already migrated with the PR. Before
  trusting it, compare `md5(replace(prosrc, chr(13), ''))` with the PR file's function bodies (CR stripped). Then
  catalogue queries (unique indexes, triggers, FK-less uuid columns) and rolled-back probes are cheap and exact.
- **"No checks reported" on a PR** usually means `mergeable: CONFLICTING` (CI never ran); check `gh pr view --json mergeable`
  and `git merge-tree --write-tree --name-only origin/main origin/<branch>` (often two task rows appended at the same line).
- **Agents console (`app/console`) facts:** not in `tests/e2e` nor `perf-budgets.json` (budgets cover only 4 `[locale]` routes);
  already had client parts before T-1871. Under `next dev` a non-localhost `CONSOLE_HOST` gets `/_next/*` 403s (Next 16
  `block-cross-site-dev.js`, no `allowedDevOrigins` in next.config) and `proxy.ts` matcher rewrites `/__nextjs*` paths: "never
  hydrates in dev" is environment, not the PR (PR #933).
- **Contracts from source for a whole-web typecheck:** a throwaway `tsconfig.review.json` in the worktree's apps/web extending
  `./tsconfig.json` with `rootDir: "../.."` and `paths` for `@fmip/contracts`, `/console`, `/translation-checks` -> src (0 errors vs
  ~360 stale-dist errors).
- **Query-param tabs keep client state:** Next 16 keys page state without search params
  (`next/dist/client/components/layout-router.js` ~549, `createRouterCacheKey(seg, true)`), so a `?tab=` switch keeps
  open editors/drafts in same-position client components; look for a `key={tab}` on the panel (PR #935, rev-2026-11-17-15).
- Migration probe files: `docker cp` needs the Windows path (`C:/Users/...`), not `/c/Users/...` (GetFileAttributesEx C:\c).
- `gh pr checks` green is not proof a DB spec ran: grep the Verify job log for `✓ src/<spec> (N tests)`
  (skipIf without DATABASE_URL would show as skipped).
- **Junction cleanup:** remove worktree junctions with a `.ps1` file run by `powershell -File` (check `LinkType -eq 'Junction'`
  first), never inline `-Command` with `\$` escapes: on PR #934 the inline form expanded to the worktree root (Delete refused
  it as non-empty). `git worktree remove --force` leaves junctions and their folder behind, it does not follow them.
- Do not run `python -` from Bash here: it hangs until the 120 s timeout.
- `.ps1` files need `powershell -NoProfile -ExecutionPolicy Bypass -File` (plain `-File` is refused by policy).
  `git show origin/<b>:.claude/...` needs `MSYS_NO_PATHCONV=1` (Git Bash mangles the `:.`-path into `;.\`).
- `fmip_t<task>` DBs have `schema_migration` (not `pgmigrations`); any of them migrated to main serves a rolled-back
  up/down + store-SQL probe (PREPARE the store's statement with its params) when the task has no DB of its own.
- `git diff` shows `pnpm-lock.yaml` as "Binary files differ": use `git diff --text`; list entries with `grep -E "^[-+]  [^ ]"`.
- Next 16.4 `experimental.agentUpgrade` (default `security`): in `next build` it is a no-op for humans/CI/Docker; only a
  detected coding agent gets a one-time `exit 1` stop on an advisory (offline = warn and continue). 16.4.5 rewrites
  `apps/web/AGENTS.md` heading `#`->`##` on an agent's `next dev` (PR #950).
- `community-search.http.spec.ts:280` (`expected 0.667 to be 0.5`) is a random-`RUN`-token flake, not the PR (T-1883 fixes it).
