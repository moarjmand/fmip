#!/usr/bin/env bash
# The ops agent's read-only snapshot of production (T-1682, D-328).
#
#     bash .claude/skills/ops-check/ops-check.sh
#
# Feeds server-snapshot.sh to `ssh fmip-prod bash -s`, prints the result and saves it to
# $OPS_OUT (default $OPS_ROOT/reports/ops-release/snapshots when OPS_ROOT is set, else
# E:/FMIP/ops/reports/ops-release/snapshots; <UTC timestamp>.txt) so the next run can be compared
# with it. Nothing on the server is changed.
#
# Fixture mode (T-1895): FMIP_FIXTURE=<dir> replays a saved run and opens no connection: it prints
# <dir>/ops-check.txt and exits with the code in <dir>/ops-check.exit (0 when there is none); the
# replay is saved as a snapshot like a real run, but only where OPS_ROOT or OPS_OUT points, never
# among the real snapshots. Make one with
# `bash ops-check.sh > <dir>/ops-check.txt; echo $? > <dir>/ops-check.exit`.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out_dir="${OPS_OUT:-${OPS_ROOT:+$OPS_ROOT/reports/ops-release/snapshots}}"
out_dir="${out_dir:-/e/FMIP/ops/reports/ops-release/snapshots}"

if [ -n "${FMIP_FIXTURE:-}" ]; then
  fx="$FMIP_FIXTURE/ops-check"
  [ -f "$fx.txt" ] || { echo "OPS-ERROR: FMIP_FIXTURE is set and $fx.txt is missing (no connection was opened)"; exit 2; }
  status=0; [ -f "$fx.exit" ] && status="$(tr -d ' \t\r\n' < "$fx.exit")"
  case "$status" in ''|*[!0-9]*) echo "OPS-ERROR: $fx.exit holds no exit code"; exit 2 ;; esac
  cat "$fx.txt"
  if [ -n "${OPS_OUT:-}${OPS_ROOT:-}" ]; then
    mkdir -p "$out_dir"
    cat "$fx.txt" > "$out_dir/$(date -u +%Y-%m-%dT%H%MZ).txt"
  fi
  exit "$status"
fi

result="$(ssh -o ConnectTimeout=20 fmip-prod 'bash -s' < "$here/server-snapshot.sh" 2>&1)"
status=$?
printf '%s\n' "$result"
if [ "$status" -ne 0 ] || ! printf '%s' "$result" | grep -q '^== end'; then
  echo "OPS-ERROR: exit $status, or the snapshot stopped before its end (ssh down, server unreachable?)"
fi
mkdir -p "$out_dir"
printf '%s\n' "$result" > "$out_dir/$(date -u +%Y-%m-%dT%H%MZ).txt"
exit "$status"
