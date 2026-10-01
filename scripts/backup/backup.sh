#!/usr/bin/env bash
# Dumps the FMIP database, writes a manifest the restore drill can check
# against, copies both off-provider, and prunes old copies (T-072, D-032).
#
#     bash scripts/backup/backup.sh
#
# Runs anywhere the compose stack runs: the VPS (from the systemd timer in this
# directory) or a developer machine. Needs docker; pg_dump runs inside the
# postgres container, rclone inside its official image, so nothing else is
# installed on the host.
#
# Settings, all from .env (see .env.example and docs/07-backups.md):
#   BACKUP_DIR               local directory for dumps            (default ./backups)
#   BACKUP_KEEP_LOCAL_DAYS   local copies older than this go      (default 7)
#   BACKUP_RCLONE_REMOTE     rclone destination, e.g. offsite:fmip-backups
#                            (unset = local only, and the script says so)
#   BACKUP_KEEP_REMOTE_DAYS  remote copies older than this go     (default 90)
#   BACKUP_RCLONE_CONFIG     rclone.conf with the remote          (default ~/.config/rclone/rclone.conf)
#   BACKUP_MEDIA_VOLUME      the media volume copied to <remote>/media/ (default fmip_media,
#                            `off` skips it; T-1341)
#   PG_ARCHIVE_MODE          `on`: also the weekly base backup of point-in-time
#                            recovery (pitr.sh base --if-due; T-845, D-157)
#
# Every run, pass or fail, ends with a row in the `backup_run` table (T-805),
# which the API's watchdog reads for its `backup` condition. BACKUP_RECORD=off
# skips that (a rehearsal against a database without the table).

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

# Carriage returns are stripped first (a .env saved by a Windows editor).
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < ./.env)
set +a
# shellcheck source=scripts/backup/lib.sh
. scripts/backup/lib.sh

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_LOCAL_DAYS="${BACKUP_KEEP_LOCAL_DAYS:-7}"
BACKUP_KEEP_REMOTE_DAYS="${BACKUP_KEEP_REMOTE_DAYS:-90}"
BACKUP_RCLONE_CONFIG="${BACKUP_RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
BACKUP_MEDIA_VOLUME="${BACKUP_MEDIA_VOLUME:-fmip_media}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="fmip-$STAMP"
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/$NAME.dump"
MANIFEST="$BACKUP_DIR/$NAME.manifest"
STARTED="$(utc_now)"
STEP='start'

# A run that stops early still says so where the API can read it (T-805):
# the watchdog then raises `backup` at once rather than after 26 quiet hours.
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    record_run backup false "$NAME.dump" "backup.sh stopped with status $status during: $STEP" "$STARTED" || true
  fi
}
trap on_exit EXIT

psql_src() {
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1 "$@"
}

STEP='pg_dump'
echo "==> pg_dump $POSTGRES_DB -> $DUMP"
# Custom format: compressed, restorable table by table, and pg_restore can
# list its contents. --no-owner/--no-privileges so a restore into a database
# owned by another role (the drill, a new VPS) needs no role juggling.
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --compress=6 --no-owner --no-privileges > "$DUMP"

STEP='manifest'
echo "==> manifest $MANIFEST"
# Exact row counts of every table in the application schemas, captured right
# after the dump. The drill recomputes them on the restored copy; a mismatch
# fails the drill. n_live_tup would be an estimate, so this generates one
# COUNT(*) per table instead.
COUNT_SQL="$(psql_src -c "
  SELECT string_agg(
           format('SELECT %L AS t, count(*) AS n FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
           ' UNION ALL ' ORDER BY schemaname, tablename)
    FROM pg_tables WHERE schemaname IN ('public', 'training')")"
{
  echo "database $POSTGRES_DB"
  echo "dumped_at $STAMP"
  echo "pg_dump $(docker compose exec -T postgres pg_dump --version | tr -d '\r')"
  psql_src -c "SELECT 'migration ' || name FROM schema_migration ORDER BY id"
  psql_src -c "$COUNT_SQL" | tr '|' ' ' | sed 's/^/rows /'
  echo "size $(wc -c < "$DUMP")"
  echo "sha256 $(sha256sum "$DUMP" | cut -d' ' -f1)"
} | tr -d '\r' > "$MANIFEST"

TABLES="$(grep -c '^rows ' "$MANIFEST")"
ROWS="$(awk '/^rows /{s+=$3} END{print s+0}' "$MANIFEST")"
echo "    $TABLES tables, $ROWS rows, $(grep -c '^migration ' "$MANIFEST") migrations, $(grep '^size ' "$MANIFEST" | cut -d' ' -f2) bytes"

# --- off-provider copy (rclone() is in lib.sh) --------------------------------
STEP='off-provider copy'
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if [ ! -f "$BACKUP_RCLONE_CONFIG" ]; then
    echo "ERROR: BACKUP_RCLONE_REMOTE is set but $BACKUP_RCLONE_CONFIG does not exist" >&2
    exit 1
  fi
  echo "==> off-provider copy -> $BACKUP_RCLONE_REMOTE"
  rclone copy --checksum "/data/$NAME.dump" "$BACKUP_RCLONE_REMOTE/"
  rclone copy --checksum "/data/$NAME.manifest" "$BACKUP_RCLONE_REMOTE/"
  # Re-read what landed. size and sha256 come back from the remote, not from the
  # local file, so a truncated upload fails here rather than on restore day.
  REMOTE_SIZE="$(rclone size --json "$BACKUP_RCLONE_REMOTE/$NAME.dump" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
  LOCAL_SIZE="$(grep '^size ' "$MANIFEST" | cut -d' ' -f2)"
  if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
    echo "ERROR: remote copy is $REMOTE_SIZE bytes, local dump is $LOCAL_SIZE" >&2
    exit 1
  fi
  echo "    verified $REMOTE_SIZE bytes on the remote"
  echo "==> prune remote copies older than $BACKUP_KEEP_REMOTE_DAYS days"
  # Only the top level: media/ and the point-in-time copies keep their own rules.
  rclone delete --max-depth 1 --min-age "${BACKUP_KEEP_REMOTE_DAYS}d" "$BACKUP_RCLONE_REMOTE/"
  COPIES="off-provider copy verified, $REMOTE_SIZE bytes"

  # --- crests, logos, player and news photos (T-1341) -------------------------
  # Not in the database: files in the media volume (T-1320, T-1322). Copied,
  # never synced, so a file deleted on the server is still on the remote;
  # rclone sends only what is new or changed, so a day costs that day's files.
  STEP='media copy'
  if [ "$BACKUP_MEDIA_VOLUME" != 'off' ] && docker volume inspect "$BACKUP_MEDIA_VOLUME" > /dev/null 2>&1; then
    echo "==> media $BACKUP_MEDIA_VOLUME -> $BACKUP_RCLONE_REMOTE/media/"
    # Size and modification time, not --checksum: a crypt remote keeps no hash
    # it shares with the source, and rclone falls back with a notice.
    rclone_media copy /media "$BACKUP_RCLONE_REMOTE/media/"
    MEDIA_COUNT="$(rclone_media size --json "$BACKUP_RCLONE_REMOTE/media/" | sed -E 's/.*"count":([0-9]+).*/\1/')"
    echo "    $MEDIA_COUNT media files on the remote"
    COPIES="$COPIES; $MEDIA_COUNT media files"
  else
    echo "    media: volume $BACKUP_MEDIA_VOLUME not found or off; not copied"
  fi
else
  echo "WARNING: BACKUP_RCLONE_REMOTE is not set; this copy exists only on this machine." >&2
  echo "         A backup on the same provider as the database is not a backup (D-032)." >&2
  COPIES='local only, BACKUP_RCLONE_REMOTE is not set'
fi

# --- weekly base backup for point-in-time recovery (T-845, D-157) -----------
# Only with archiving on. pitr.sh decides whether a week has passed since the
# newest base on the remote, so a missed Sunday is made up the next day; a
# failure fails this run, and the watchdog's `backup` condition says so.
if [ "${PG_ARCHIVE_MODE:-off}" = 'on' ]; then
  STEP='weekly base backup (pitr.sh base --if-due)'
  echo "==> point-in-time recovery: weekly base backup"
  BASE_LOG="$(mktemp)"
  bash scripts/backup/pitr.sh base --if-due | tee "$BASE_LOG"
  COPIES="$COPIES; $(grep -E '^base backup not due|^    base-' "$BASE_LOG" | head -n 1 | sed 's/^ *//')"
  rm -f "$BASE_LOG"
fi

STEP='local prune'
echo "==> prune local copies older than $BACKUP_KEEP_LOCAL_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'fmip-*.dump' -mtime "+$BACKUP_KEEP_LOCAL_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'fmip-*.manifest' -mtime "+$BACKUP_KEEP_LOCAL_DAYS" -print -delete

STEP='record'
echo "==> record"
record_run backup true "$NAME.dump" "$TABLES tables, $ROWS rows; $COPIES" "$STARTED"

echo "OK $NAME"
