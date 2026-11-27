#!/usr/bin/env bash
# The data audit's invariants on production, read-only (T-1680, D-326).
#
#     bash .claude/skills/data-audit/run.sh            # prints the table, saves it
#     bash .claude/skills/data-audit/run.sh drill.sql  # any other read-only query file
#
# The session is opened with default_transaction_read_only=on and a 60 s statement
# timeout: a statement that writes is refused by Postgres itself, whatever the file says.
# The database credentials stay inside the container; nothing reads /opt/fmip/.env.
# A failed statement stops the file (ON_ERROR_STOP) and the run ends with AUDIT-ERROR and
# a non-zero exit; a file that prints nothing says AUDIT-EMPTY. Never a silent pass.
# Each run of invariants.sql is saved to $AUDIT_OUT (default $OPS_ROOT/data-audit/runs when
# OPS_ROOT is set, else E:/FMIP/data-audit/runs), outside the repository, as <UTC timestamp>.txt,
# so a later run can be compared with it.
#
# Fixture mode (T-1895, ../team-charter/bin/fixture-replay.sh): FMIP_FIXTURE=<dir> with
# FMIP_FIXTURE_OK=1 replays a saved run between two "FIXTURE REPLAY" lines and opens no connection:
# <dir>/run.txt for invariants.sql, <dir>/run-<name>.txt for another query file <name>.sql, and the
# code in the matching .exit file (0 when there is none). Make one with
# `bash run.sh > <dir>/run.txt; echo $? > <dir>/run.exit`. A successful replay of invariants.sql is
# saved like a real run, but only where OPS_ROOT or AUDIT_OUT points, never among the real runs.
# FMIP_FIXTURE without FMIP_FIXTURE_OK=1, or a missing fixture, is AUDIT-ERROR, never the server.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
file="${1:-$here/invariants.sql}"
out_dir="${AUDIT_OUT:-${OPS_ROOT:+$OPS_ROOT/data-audit/runs}}"
out_dir="${out_dir:-/e/FMIP/data-audit/runs}"

if [ ! -f "$file" ]; then
  echo "AUDIT-ERROR: $file not found" >&2
  exit 2
fi

if [ -n "${FMIP_FIXTURE:-}" ]; then
  . "$here/../team-charter/bin/fixture-replay.sh"
  if [ "$file" = "$here/invariants.sql" ]; then fixture_replay run AUDIT; else fixture_replay "run-$(basename "$file" .sql)" AUDIT; fi
  if [ "$FX_STATUS" -eq 0 ] && [ "$file" = "$here/invariants.sql" ] && [ -n "${AUDIT_OUT:-}${OPS_ROOT:-}" ]; then
    mkdir -p "$out_dir"
    cat "$FX_FILE" > "$out_dir/$(date -u +%Y-%m-%dT%H%MZ).txt"
  fi
  exit "$FX_STATUS"
fi

remote="/tmp/data-audit-$$.sql"
copied=""
for attempt in 1 2 3; do
  if scp -q "$file" "fmip-prod:$remote"; then copied=1; break; fi
  sleep $((attempt * 5))  # a transient "Connection closed" passes on a retry
done
if [ -z "$copied" ]; then
  echo "AUDIT-ERROR: could not copy the file to the server (3 tries)" >&2
  exit 2
fi
result="$(ssh fmip-prod "cd /opt/fmip && docker compose exec -T postgres sh -c 'PGOPTIONS=\"-c default_transaction_read_only=on -c statement_timeout=60000\" psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -q -X -v ON_ERROR_STOP=1' < $remote 2>&1; status=\$?; rm -f $remote; exit \$status")"
status=$?

printf '%s\n' "$result"
if [ "$status" -ne 0 ]; then
  echo "AUDIT-ERROR: exit $status (the statement above failed; nothing after it ran)"
  exit "$status"
fi
if [ -z "$result" ]; then
  echo "AUDIT-EMPTY: the file printed nothing"
fi
if [ "$file" = "$here/invariants.sql" ]; then
  mkdir -p "$out_dir"
  printf '%s\n' "$result" > "$out_dir/$(date -u +%Y-%m-%dT%H%MZ).txt"
fi
