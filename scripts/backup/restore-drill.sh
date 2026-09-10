#!/usr/bin/env bash
# Restores a dump into a throwaway Postgres and proves the copy is whole:
# checksum, every migration, and the exact row count of every table must match
# the manifest written at dump time (T-072, D-032).
#
#     bash scripts/backup/restore-drill.sh                 # newest dump in BACKUP_DIR
#     bash scripts/backup/restore-drill.sh path/to/x.dump  # a specific one
#
# Exit status is the verdict: 0 means the backup restores and matches; anything
# else means it does not, and the output says where. Run it monthly (the
# runbook in docs/07-backups.md has the checklist) and after any change to the
# backup script or the database image.
#
# The drill never touches the running database or the compose project; it runs
# its own container, which it removes on exit whatever happens.

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < ./.env)
  set +a
fi
BACKUP_DIR="${BACKUP_DIR:-./backups}"
IMAGE="${BACKUP_DRILL_IMAGE:-postgres:18-alpine}"
CONTAINER="fmip-restore-drill-$$"

if [ $# -ge 1 ]; then
  DUMP="$1"
else
  DUMP="$(ls -1 "$BACKUP_DIR"/fmip-*.dump 2> /dev/null | sort | tail -n 1 || true)"
  if [ -z "$DUMP" ]; then
    echo "ERROR: no fmip-*.dump in $BACKUP_DIR; run scripts/backup/backup.sh first" >&2
    exit 1
  fi
fi
MANIFEST="${DUMP%.dump}.manifest"
[ -f "$DUMP" ] || { echo "ERROR: $DUMP not found" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "ERROR: $MANIFEST not found beside the dump" >&2; exit 1; }

echo "==> drill: $DUMP"
FAILED=0
fail() { echo "FAIL: $*" >&2; FAILED=1; }

echo "==> checksum"
EXPECTED="$(grep '^sha256 ' "$MANIFEST" | cut -d' ' -f2)"
ACTUAL="$(sha256sum "$DUMP" | cut -d' ' -f1)"
if [ "$EXPECTED" = "$ACTUAL" ]; then echo "    ok $ACTUAL"; else fail "sha256 is $ACTUAL, manifest says $EXPECTED"; fi

cleanup() { docker rm -f "$CONTAINER" > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> throwaway postgres ($IMAGE)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill \
  "$IMAGE" > /dev/null
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U drill -d drill > /dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U drill -d drill > /dev/null

psql_drill() {
  docker exec -i "$CONTAINER" psql -U drill -d drill -tA -v ON_ERROR_STOP=1 "$@"
}

echo "==> pg_restore"
# --exit-on-error: a partially restored database must not pass. The dump was
# taken with --no-owner/--no-privileges, so the drill role owns everything.
docker exec -i "$CONTAINER" pg_restore -U drill -d drill --no-owner --no-privileges --exit-on-error < "$DUMP"

echo "==> migrations"
EXPECTED_MIGRATIONS="$(grep '^migration ' "$MANIFEST" | cut -d' ' -f2-)"
ACTUAL_MIGRATIONS="$(psql_drill -c "SELECT name FROM schema_migration ORDER BY id" | tr -d '\r')"
if [ "$EXPECTED_MIGRATIONS" = "$ACTUAL_MIGRATIONS" ]; then
  echo "    ok $(printf '%s\n' "$ACTUAL_MIGRATIONS" | grep -c .) migrations, last: $(printf '%s\n' "$ACTUAL_MIGRATIONS" | tail -n 1)"
else
  fail "migrations differ"
  diff <(printf '%s\n' "$EXPECTED_MIGRATIONS") <(printf '%s\n' "$ACTUAL_MIGRATIONS") >&2 || true
fi

echo "==> row counts"
COUNT_SQL="$(psql_drill -c "
  SELECT string_agg(
           format('SELECT %L AS t, count(*) AS n FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
           ' UNION ALL ' ORDER BY schemaname, tablename)
    FROM pg_tables WHERE schemaname IN ('public', 'training')")"
EXPECTED_ROWS="$(grep '^rows ' "$MANIFEST" | cut -d' ' -f2- | sort)"
ACTUAL_ROWS="$(psql_drill -c "$COUNT_SQL" | tr -d '\r' | tr '|' ' ' | sort)"
if [ "$EXPECTED_ROWS" = "$ACTUAL_ROWS" ]; then
  echo "    ok $(printf '%s\n' "$ACTUAL_ROWS" | grep -c .) tables, $(printf '%s\n' "$ACTUAL_ROWS" | awk '{s+=$2} END{print s+0}') rows"
else
  fail "row counts differ (expected < > restored)"
  diff <(printf '%s\n' "$EXPECTED_ROWS") <(printf '%s\n' "$ACTUAL_ROWS") >&2 || true
fi

echo "==> constraints and triggers came along"
# Two things a schema-only or data-only mistake would lose: the forecast
# probability CHECK (must refuse 0.5/0.3/0.3) and the immutability trigger.
if psql_drill -c "SELECT 1 FROM pg_constraint WHERE conname = 'forecast_probabilities_total_one'" | grep -q 1; then
  echo "    ok forecast_probabilities_total_one"
else
  fail "forecast_probabilities_total_one is missing"
fi
if psql_drill -c "SELECT 1 FROM pg_trigger WHERE tgname = 'forecast_immutable'" | grep -q 1; then
  echo "    ok forecast_immutable"
else
  fail "forecast_immutable trigger is missing"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "DRILL FAILED: $DUMP" >&2
  exit 1
fi
echo "DRILL PASSED: $DUMP restores and matches its manifest"
