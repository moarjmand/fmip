#!/usr/bin/env bash
# Module boundaries of the API (CLAUDE.md section 5: a module exposes only its public service, no
# cross-module imports of internals) and the provider boundary (rule 2), for the architect (T-1684).
#
#     bash .claude/skills/fmip-architecture/boundary-check.sh
#
# Prints each import of another module's internal/ folder, and each provider adapter imported from
# outside the ingestion module. Read-only.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
mods=apps/api/src/modules
found=0
for dir in "$mods"/*/; do
  m="$(basename "$dir")"
  while IFS= read -r line; do
    file="${line%%:*}"; rest="${line#*:}"
    target="$(printf '%s' "$rest" | grep -oE "modules/[a-z0-9-]+/internal|\.\./([a-z0-9-]+)/internal" | head -1)"
    other="$(printf '%s' "$target" | sed -E 's#modules/##; s#\.\./##; s#/internal##')"
    if [ -n "$other" ] && [ "$other" != "$m" ]; then
      echo "internal-import | $file | imports $other's internals: $(printf '%s' "$rest" | tr -s ' ' | cut -c1-140)"
      found=$((found + 1))
    fi
  done < <(grep -rnE "from ['\"][^'\"]*(modules/[a-z0-9-]+/internal|\.\./[a-z0-9-]+/internal)" "$dir" --include=*.ts | grep -v '\.spec\.ts:')
done
while IFS= read -r line; do
  echo "adapter-outside-ingestion | $line" | cut -c1-200
  found=$((found + 1))
done < <(grep -rnE "adapters/(api-football|sportmonks|highlightly)" apps/api/src apps/web/src --include=*.ts --include=*.tsx \
          | grep -v "^apps/api/src/modules/ingestion/" | grep -v '\.spec\.ts')
echo "== $found boundary crossings"
echo "== modules importing many others (module | modules it imports; 8 or more is worth a look)"
for dir in "$mods"/*/; do
  m="$(basename "$dir")"
  n="$(grep -rhoE "from ['\"]\.\./[a-z0-9-]+" "$dir" --include=*.ts 2>/dev/null | grep -v "/$m\b" | sed -E "s#.*\.\./##" | sort -u | wc -l)"
  [ "$n" -ge 8 ] && echo "$m | $n"
done
echo "== source files over 1,500 lines"
find apps/api/src apps/web/src packages/*/src apps/model/fmip_model -name '*.ts' -o -name '*.tsx' -o -name '*.py' 2>/dev/null \
  | grep -vE '\.spec\.|/tests?/' | xargs wc -l 2>/dev/null | awk '$2 != "total" && $1 > 1500 {print $1, $2}' | sort -rn
echo "== migrations sharing a timestamp"
ls packages/db/migrations/ | grep -oE '^[0-9]+' | sort | uniq -d | sed 's/^/shared: /'
echo "== end"
