---
name: review-techniques-sql
description: How to prove SQL-rewrite PRs (old vs new query) in FMIP review; pg_trgm threshold float4/float8 boundary trap; local test DBs are empty
metadata:
  type: feedback
---

For a "same results, faster" SQL rewrite, run old and new SQL side by side in one transaction
on the local test DB, insert the boundary row yourself, then ROLLBACK. Scripts: plain node
`.cjs` in the scratchpad, `require(require.resolve('pg', {paths:[<worktree>/apps/api]}))`
(no psql on the host). Old SQL: `git show origin/main:<path>` and slice the template string.

**Why:** PR #902 (T-1842, 2026-11-16) claimed identical rows from a 30-query production
comparison, but `<%` compares float4 word_similarity to the float8 GUC threshold while
`score >= $4` compared in real, so ws exactly 9/20 was dropped. Only a constructed boundary
row shows it; sample comparisons never do.

**How to apply:** for any index pre-filter that must be a superset of a score filter, check the
types on both sides (`pg_typeof`) and test the exact boundary. The local `fmip_t1842`-style
test DBs have 0 people/teams/aliases, so broad old-vs-new comparisons there prove nothing;
say so in "not checked".
