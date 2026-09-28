#!/usr/bin/env bash
# Restores a dump into a throwaway Postgres and proves the copy is whole:
# checksum, every migration, and the exact row count of every table must match
# the manifest written at dump time (T-072, D-032).
#
#     bash scripts/backup/restore-drill.sh                 # newest dump in BACKUP_DIR
#     bash scripts/backup/restore-drill.sh path/to/x.dump  # a specific one
#     bash scripts/backup/restore-drill.sh --offsite       # newest dump on BACKUP_RCLONE_REMOTE
#     bash scripts/backup/restore-drill.sh --scheduled     # what the monthly timer runs (T-805)
#     bash scripts/backup/restore-drill.sh --scheduled --dry-run   # say what it would do, do nothing
#
# --scheduled is the monthly timer's run (fmip-restore-drill.timer, D-101):
# the newest dump on the off-provider remote (the local one only when no
# remote is set, and the record says so), which must be at most
# BACKUP_DRILL_MAX_AGE_HOURS old (default 48), and, besides the manifest,
# a comparison with the live database: the restored migrations are the live
# ones (or an earlier prefix, if a deploy landed after the dump), and a few
# key tables' row counts are within BACKUP_DRILL_TOLERANCE_PCT (default 10 %,
# never less than 100 rows) of live.
#
# Exit status is the verdict: 0 means the backup restores and matches; anything
# else means it does not, and the output says where. Every run except a dry
# run ends with a row in `backup_run` (T-805) -- pass or fail -- which the
# API's watchdog reads for its `restore_drill` condition; --no-record (or
# BACKUP_RECORD=off) skips that.
#
# The drill never touches the running database's data or the compose project's
# containers; it runs its own container, which it removes on exit whatever
# happens, with any files it downloaded. It reads the live database (counts
# only) and appends one row to `backup_run`.

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < ./.env)
  set +a
fi
# shellcheck source=scripts/backup/lib.sh
. scripts/backup/lib.sh

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RCLONE_CONFIG="${BACKUP_RCLONE_CONFIG:-${HOME:-}/.config/rclone/rclone.conf}"
IMAGE="${BACKUP_DRILL_IMAGE:-postgres:18-alpine}"
TOLERANCE_PCT="${BACKUP_DRILL_TOLERANCE_PCT:-10}"
MAX_AGE_HOURS="${BACKUP_DRILL_MAX_AGE_HOURS:-48}"
CONTAINER="fmip-restore-drill-$$"
# Tables whose count says "this is our database, and recent": members, their
# predictions and settlements, the forecasts, the fixtures, the messages.
KEY_TABLES=(user_account user_prediction settlement forecast fixture message)

usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
}

SCHEDULED=0
OFFSITE=0
RECORD=1
DRY_RUN=0
DUMP=''
while [ $# -gt 0 ]; do
  case "$1" in
    --scheduled) SCHEDULED=1 ;;
    --offsite) OFFSITE=1 ;;
    --no-record) RECORD=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option $1 (see --help)" >&2
      exit 2
      ;;
    *) DUMP="$1" ;;
  esac
  shift
done
[ "${BACKUP_RECORD:-on}" = 'off' ] && RECORD=0

SOURCE='local'
if [ "$SCHEDULED" -eq 1 ]; then
  if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
    OFFSITE=1
  else
    SOURCE='local (BACKUP_RCLONE_REMOTE is not set)'
  fi
fi
if [ "$OFFSITE" -eq 1 ]; then
  SOURCE='offsite'
  if [ -n "$DUMP" ]; then
    echo "ERROR: a dump path and --offsite/--scheduled with a remote do not go together" >&2
    exit 2
  fi
fi

STARTED="$(utc_now)"
STEP='start'
FAILED=0
REASONS=''
WORKDIR=''
FINISHED=0

fail() {
  echo "FAIL: $*" >&2
  FAILED=1
  REASONS="${REASONS:+$REASONS; }$*"
}

# The verdict is recorded once, by whichever comes first: the end of the
# script, or an exit on the way there (set -e, or `die`).
finish() {
  local status=$?
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
  if [ -n "$WORKDIR" ]; then rm -rf "$WORKDIR"; fi
  if [ "$FINISHED" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$RECORD" -eq 1 ] && [ "$status" -ne 0 ]; then
    record_run restore_drill false "$(basename "${DUMP:-none}")" \
      "$SOURCE; stopped with status $status during: $STEP${REASONS:+; $REASONS}" "$STARTED" || true
  fi
}
trap finish EXIT
# systemd's TimeoutStartSec ends a stuck drill with SIGTERM: leave through the
# EXIT trap, so the container goes and the failure is recorded.
trap 'exit 143' TERM INT

die() {
  echo "ERROR: $*" >&2
  REASONS="${REASONS:+$REASONS; }$*"
  exit 1
}

psql_live() {
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1 "$@"
}

# --- which dump ---------------------------------------------------------------
STEP='find the dump'
if [ "$OFFSITE" -eq 1 ]; then
  [ -n "${BACKUP_RCLONE_REMOTE:-}" ] || die "--offsite needs BACKUP_RCLONE_REMOTE"
  [ -f "$BACKUP_RCLONE_CONFIG" ] || die "$BACKUP_RCLONE_CONFIG does not exist"
  mkdir -p "$BACKUP_DIR"
  NEWEST="$(rclone lsf --files-only --include 'fmip-*.dump' "$BACKUP_RCLONE_REMOTE" | tr -d '\r' | sort | tail -n 1)"
  [ -n "$NEWEST" ] || die "no fmip-*.dump on $BACKUP_RCLONE_REMOTE"
  DUMP="$BACKUP_DIR/drill-$$/$NEWEST"
elif [ -z "$DUMP" ]; then
  DUMP="$(ls -1 "$BACKUP_DIR"/fmip-*.dump 2> /dev/null | sort | tail -n 1 || true)"
  [ -n "$DUMP" ] || die "no fmip-*.dump in $BACKUP_DIR; run scripts/backup/backup.sh first"
fi
MANIFEST="${DUMP%.dump}.manifest"

# fmip-20260910T120000Z.dump -> seconds since it was taken; empty when the
# name does not carry a stamp (a renamed file).
dump_age_seconds() {
  local stamp
  stamp="$(basename "$1" | sed -nE 's/^fmip-([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})Z\.dump$/\1 \2:\3:\4/p')"
  [ -n "$stamp" ] || return 0
  echo $(($(date -u +%s) - $(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9}" +%s)))
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> dry run: nothing is downloaded, restored or recorded"
  echo "    mode:      $([ "$SCHEDULED" -eq 1 ] && echo scheduled || echo manual), source $SOURCE"
  AGE="$(dump_age_seconds "$DUMP")"
  if [ -n "$AGE" ]; then AGE_TEXT="$((AGE / 3600))h old"; else AGE_TEXT='age unknown'; fi
  echo "    dump:      $(basename "$DUMP") ($AGE_TEXT)"
  echo "    image:     $IMAGE"
  if docker info > /dev/null 2>&1; then echo "    docker:    reachable"; else echo "    docker:    NOT reachable"; fi
  if [ "$SCHEDULED" -eq 1 ]; then
    echo "    live:      compare migrations and ${KEY_TABLES[*]} within ${TOLERANCE_PCT}%"
  fi
  if [ "$RECORD" -eq 1 ]; then
    if [ -n "${POSTGRES_USER:-}" ] && [ "$(psql_live -c "SELECT to_regclass('public.backup_run') IS NOT NULL" 2> /dev/null | tr -d '\r')" = 't' ]; then
      echo "    record:    backup_run (present)"
    else
      echo "    record:    backup_run is NOT reachable -- the result would not reach the API"
    fi
  else
    echo "    record:    off"
  fi
  exit 0
fi

echo "==> drill: $DUMP ($SOURCE)"

if [ "$OFFSITE" -eq 1 ]; then
  STEP='download from the off-provider copy'
  WORKDIR="$BACKUP_DIR/drill-$$"
  mkdir -p "$WORKDIR"
  echo "==> download $NEWEST and its manifest from $BACKUP_RCLONE_REMOTE"
  rclone copy "$BACKUP_RCLONE_REMOTE/$NEWEST" "/data/drill-$$/"
  rclone copy "$BACKUP_RCLONE_REMOTE/${NEWEST%.dump}.manifest" "/data/drill-$$/"
fi
[ -f "$DUMP" ] || die "$DUMP not found"
[ -f "$MANIFEST" ] || die "$(basename "$MANIFEST") not found beside the dump"

if [ "$SCHEDULED" -eq 1 ]; then
  STEP='dump age'
  AGE="$(dump_age_seconds "$DUMP")"
  if [ -z "$AGE" ]; then
    fail "cannot tell the age of $(basename "$DUMP") from its name"
  elif [ "$AGE" -gt $((MAX_AGE_HOURS * 3600)) ]; then
    fail "the newest $SOURCE dump is $((AGE / 3600))h old (more than ${MAX_AGE_HOURS}h): the daily backup is not reaching it"
  else
    echo "==> age: $((AGE / 3600))h"
  fi
fi

STEP='checksum'
echo "==> checksum"
EXPECTED="$(grep '^sha256 ' "$MANIFEST" | cut -d' ' -f2)"
ACTUAL="$(sha256sum "$DUMP" | cut -d' ' -f1)"
if [ "$EXPECTED" = "$ACTUAL" ]; then echo "    ok $ACTUAL"; else fail "sha256 is $ACTUAL, manifest says $EXPECTED"; fi

STEP='throwaway postgres'
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

STEP='pg_restore'
echo "==> pg_restore"
# --exit-on-error: a partially restored database must not pass. The dump was
# taken with --no-owner/--no-privileges, so the drill role owns everything.
#
# A failure here is reported like every other check rather than killing the
# script: `set -e` on this one line meant the most likely failure of all -- the
# dump does not restore -- ended the run before the verdict was printed, so a
# maintainer running this monthly got a wall of pg_restore output and no
# answer. The checks below are then skipped, because a half-restored database
# fails all of them for the same single reason and the diff would bury it.
RESTORED=1
if docker exec -i "$CONTAINER" pg_restore -U drill -d drill --no-owner --no-privileges --exit-on-error < "$DUMP"; then
  echo "    ok"
else
  RESTORED=0
  fail "pg_restore did not complete: this dump does not restore as it stands (its reason is above)"
fi

SUMMARY=''
if [ "$RESTORED" -eq 1 ]; then
  STEP='migrations'
  echo "==> migrations"
  EXPECTED_MIGRATIONS="$(grep '^migration ' "$MANIFEST" | cut -d' ' -f2-)"
  ACTUAL_MIGRATIONS="$(psql_drill -c "SELECT name FROM schema_migration ORDER BY id" | tr -d '\r')"
  if [ "$EXPECTED_MIGRATIONS" = "$ACTUAL_MIGRATIONS" ]; then
    echo "    ok $(printf '%s\n' "$ACTUAL_MIGRATIONS" | grep -c .) migrations, last: $(printf '%s\n' "$ACTUAL_MIGRATIONS" | tail -n 1)"
  else
    fail "migrations differ from the manifest"
    diff <(printf '%s\n' "$EXPECTED_MIGRATIONS") <(printf '%s\n' "$ACTUAL_MIGRATIONS") >&2 || true
  fi

  STEP='row counts'
  echo "==> row counts"
  COUNT_SQL="$(psql_drill -c "
    SELECT string_agg(
             format('SELECT %L AS t, count(*) AS n FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
             ' UNION ALL ' ORDER BY schemaname, tablename)
      FROM pg_tables WHERE schemaname IN ('public', 'training')")"
  EXPECTED_ROWS="$(grep '^rows ' "$MANIFEST" | cut -d' ' -f2- | sort)"
  ACTUAL_ROWS="$(psql_drill -c "$COUNT_SQL" | tr -d '\r' | tr '|' ' ' | sort)"
  TABLE_COUNT="$(printf '%s\n' "$ACTUAL_ROWS" | grep -c .)"
  ROW_COUNT="$(printf '%s\n' "$ACTUAL_ROWS" | awk '{s+=$2} END{print s+0}')"
  if [ "$EXPECTED_ROWS" = "$ACTUAL_ROWS" ]; then
    echo "    ok $TABLE_COUNT tables, $ROW_COUNT rows"
  else
    fail "row counts differ from the manifest"
    diff <(printf '%s\n' "$EXPECTED_ROWS") <(printf '%s\n' "$ACTUAL_ROWS") >&2 || true
  fi
  SUMMARY="$(printf '%s\n' "$ACTUAL_MIGRATIONS" | grep -c .) migrations, $TABLE_COUNT tables, $ROW_COUNT rows"

  STEP='constraints and triggers'
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

  if [ "$SCHEDULED" -eq 1 ]; then
    # The manifest proves the dump is whole; this proves it is *ours, and
    # recent*: a whole dump of the wrong database, or of last spring's, passes
    # every check above.
    STEP='compare with live'
    echo "==> compared with the live database"
    LIVE_MIGRATIONS="$(psql_live -c "SELECT name FROM schema_migration ORDER BY id" | tr -d '\r')"
    if [ "$LIVE_MIGRATIONS" = "$ACTUAL_MIGRATIONS" ]; then
      echo "    ok migrations are live's"
    elif [ "${LIVE_MIGRATIONS#"$ACTUAL_MIGRATIONS"$'\n'}" != "$LIVE_MIGRATIONS" ]; then
      echo "    ok migrations are live's up to a later deploy"
    else
      fail "the restored migrations are not live's (nor an earlier prefix of them)"
    fi
    for table in "${KEY_TABLES[@]}"; do
      LIVE_N="$(psql_live -c "SELECT count(*) FROM public.$table" | tr -d '\r')"
      DRILL_N="$(psql_drill -c "SELECT count(*) FROM public.$table" | tr -d '\r')"
      DELTA=$((LIVE_N > DRILL_N ? LIVE_N - DRILL_N : DRILL_N - LIVE_N))
      ALLOWED=$((LIVE_N * TOLERANCE_PCT / 100))
      [ "$ALLOWED" -lt 100 ] && ALLOWED=100
      if [ "$DELTA" -le "$ALLOWED" ]; then
        echo "    ok $table: $DRILL_N restored, $LIVE_N live"
      else
        fail "$table: $DRILL_N restored against $LIVE_N live (more than ${TOLERANCE_PCT}% apart)"
      fi
    done
    SUMMARY="$SUMMARY; within ${TOLERANCE_PCT}% of live"
  fi
fi

STEP='record'
FINISHED=1
if [ "$FAILED" -ne 0 ]; then
  [ "$RECORD" -eq 1 ] && record_run restore_drill false "$(basename "$DUMP")" "$SOURCE; $REASONS" "$STARTED"
  echo "DRILL FAILED: $DUMP" >&2
  exit 1
fi
[ "$RECORD" -eq 1 ] && record_run restore_drill true "$(basename "$DUMP")" "$SOURCE; $SUMMARY" "$STARTED"
echo "DRILL PASSED: $DUMP restores and matches its manifest"
