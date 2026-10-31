#!/usr/bin/env bash
# The ops agent's read-only snapshot of production (T-1682, D-328).
#
#     bash .claude/skills/ops-check/ops-check.sh
#
# Feeds server-snapshot.sh to `ssh fmip-prod bash -s`, prints the result and saves it to
# $OPS_OUT (default E:/FMIP/ops/reports/ops-release/snapshots/<UTC timestamp>.txt) so the
# next run can be compared with it. Nothing on the server is changed.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out_dir="${OPS_OUT:-/e/FMIP/ops/reports/ops-release/snapshots}"

result="$(ssh -o ConnectTimeout=20 fmip-prod 'bash -s' < "$here/server-snapshot.sh" 2>&1)"
status=$?
printf '%s\n' "$result"
if [ "$status" -ne 0 ] || ! printf '%s' "$result" | grep -q '^== end'; then
  echo "OPS-ERROR: exit $status, or the snapshot stopped before its end (ssh down, server unreachable?)"
fi
mkdir -p "$out_dir"
printf '%s\n' "$result" > "$out_dir/$(date -u +%Y-%m-%dT%H%MZ).txt"
exit "$status"
