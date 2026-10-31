#!/usr/bin/env bash
# Mechanical checks of a branch's diff against CLAUDE.md (T-1682, D-328), for the code reviewer.
#
#     bash .claude/skills/fmip-review/review-checks.sh [base]       # committed branch vs base
#     WORKTREE=1 bash .claude/skills/fmip-review/review-checks.sh    # also uncommitted and untracked
#
# Base defaults to origin/main. Each line: CHECK | PASS or FLAG | detail. A FLAG is a lead to read,
# not a verdict: the reviewer opens the file and judges (search the file for the quoted text; the
# script prints diff lines, not file line numbers). Read-only: it runs git and grep, nothing else.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || { echo "REVIEW-ERROR: not inside a git repository"; exit 2; }
base="${1:-origin/main}"
mb="$(git merge-base "$base" HEAD)" || { echo "REVIEW-ERROR: no merge base with $base"; exit 2; }
if [ "${WORKTREE:-}" = 1 ]; then
  to=()  # the working tree: committed and uncommitted changes
  untracked="$(git ls-files --others --exclude-standard)"
else
  to=(HEAD)
  untracked=""
fi
changed="$(git diff --name-status "$mb" "${to[@]}"; printf '%s\n' "$untracked" | sed '/^$/d; s/^/A\t/')"
added_lines() {
  git diff -U0 "$mb" "${to[@]}" -- "$@" | grep -E '^\+[^+]'
  [ -n "$untracked" ] && printf '%s\n' "$untracked" | while read -r f; do
    for spec in "$@"; do case "$spec" in :!*) continue ;; esac
      if [ "$spec" = . ]; then sed 's/^/+/' "$f" 2>/dev/null; break; fi
      case "$f" in $spec|$spec/*) sed 's/^/+/' "$f" 2>/dev/null; break ;; esac
    done
  done
}
uncomment() { grep -vE '^\+\s*(//|#|\*|/\*|--)'; }
flag() { if [ -n "$2" ]; then printf '%s | FLAG | %s\n' "$1" "$(printf '%s' "$2" | head -5 | tr '\n' ';')"; else printf '%s | PASS |\n' "$1"; fi; }

echo "== $(git rev-parse --abbrev-ref HEAD) against $base ($(printf '%s\n' "$changed" | grep -c .) files)"

# Rule: never edit a shipped migration (CLAUDE.md section 5).
flag "shipped-migration-edited" "$(printf '%s\n' "$changed" | awk '$1 ~ /^(M|D|R)/ && $2 ~ /^packages\/db\/migrations\//')"
# Rule 2: no provider-specific field beyond the adapters.
flag "provider-leak" "$(added_lines 'apps/web' 'apps/api/src' ':!apps/api/src/modules/ingestion' | uncomment | grep -iE 'api[-_ ]?football|apiFootball|sportmonks|highlightly|fixture\.status\.short|league\.round')"
# Rule 7: RTL, physical sides in CSS (Tailwind classes are covered by ESLint).
flag "rtl-physical-css" "$(added_lines '*.css' '*.scss' | uncomment | grep -E '(margin|padding|border)-(left|right)|[^-](left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)')"
# A TODO needs a task id (section 6).
flag "todo-without-task" "$(added_lines . | grep -E 'TODO|FIXME' | grep -vE 'T-[0-9]+')"
# Tests left focused or skipped.
flag "focused-or-skipped-test" "$(added_lines '*.spec.ts' '*.spec.tsx' '*.test.ts' '*.py' | grep -E '\b(it|describe|test)\.(only|skip)\(|@pytest\.mark\.skip')"
# Debug output left in application code.
flag "console-log" "$(added_lines 'apps/web/src' 'apps/api/src' 'packages' ':!*.spec.ts' ':!*.spec.tsx' | uncomment | grep -E 'console\.(log|debug)\(')"
# A new environment variable must be in .env.example and the project map (section 5).
newvars="$(added_lines 'apps' 'packages' | grep -oE 'process\.env\.[A-Z0-9_]+|os\.environ(\.get)?\(["'"'"'][A-Z0-9_]+' | grep -oE '[A-Z][A-Z0-9_]+$' | sort -u)"
missing=""; for v in $newvars; do grep -q "^#\?\s*$v=" .env.example 2>/dev/null || missing="$missing $v"; done
flag "env-var-not-in-example" "${missing# }"
# Added files without a project-map update (section 6).
addedfiles="$(printf '%s\n' "$changed" | awk '$1=="A"{print $2}' | grep -vE '\.(spec|test)\.|^docs/|__tests__|/tests?/' )"
if [ -n "$addedfiles" ] && ! printf '%s\n' "$changed" | grep -q 'docs/03-project-map.md'; then
  flag "project-map-not-updated" "$addedfiles"
else flag "project-map-not-updated" ""; fi
# A decision referenced but not written.
for d in $(added_lines . ':!docs/00-decisions.md' | grep -oE 'D-[0-9]{3}' | sort -u); do
  grep -q "^## $d " docs/00-decisions.md || echo "decision-missing | FLAG | $d referenced, no '## $d' entry"
done
# Secrets that look real.
flag "secret-like" "$(added_lines . ':!*.lock' ':!pnpm-lock.yaml' | grep -E '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]\s*["'"'"'][^"'"'"']{6,})')"
# Migrations: a new file's timestamp is unique and later than every migration on the base.
newmig="$(printf '%s\n' "$changed" | awk '$1=="A" && $2 ~ /^packages\/db\/migrations\/[0-9]+_/ {print $2}')"
last="$(git ls-tree --name-only "$mb" packages/db/migrations/ | sed 's|.*/||' | grep -oE '^[0-9]+' | sort -n | tail -1)"
bad=""; for f in $newmig; do ts="$(basename "$f" | grep -oE '^[0-9]+')"
  [ -n "$last" ] && [ "$ts" -le "$last" ] && bad="$bad $f (not after $last)"
  [ "$(ls packages/db/migrations/ | grep -c "^${ts}_")" -gt 1 ] && bad="$bad $f (timestamp shared)"
done
flag "migration-timestamp" "${bad# }"
# Backslash-escaped backticks a script wrote into comments or docs by mistake.
flag "escaped-backtick" "$(added_lines . | grep -F '\`')"
echo "== end"
