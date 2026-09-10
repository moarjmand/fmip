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

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_LOCAL_DAYS="${BACKUP_KEEP_LOCAL_DAYS:-7}"
BACKUP_KEEP_REMOTE_DAYS="${BACKUP_KEEP_REMOTE_DAYS:-90}"
BACKUP_RCLONE_CONFIG="${BACKUP_RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="fmip-$STAMP"
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/$NAME.dump"
MANIFEST="$BACKUP_DIR/$NAME.manifest"

psql_src() {
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1 "$@"
}

echo "==> pg_dump $POSTGRES_DB -> $DUMP"
# Custom format: compressed, restorable table by table, and pg_restore can
# list its contents. --no-owner/--no-privileges so a restore into a database
# owned by another role (the drill, a new VPS) needs no role juggling.
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --compress=6 --no-owner --no-privileges > "$DUMP"

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

# --- off-provider copy --------------------------------------------------------
host_path() {
  # Docker Desktop on Windows wants a Windows path in -v; everywhere else the
  # path is fine as it is.
  if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

rclone() {
  # Path conversion off: the container-side paths must stay POSIX.
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(host_path "$(cd "$BACKUP_DIR" && pwd)"):/data" \
    -v "$(host_path "$BACKUP_RCLONE_CONFIG"):/config/rclone/rclone.conf:ro" \
    rclone/rclone:1 "$@"
}

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
  rclone delete --min-age "${BACKUP_KEEP_REMOTE_DAYS}d" "$BACKUP_RCLONE_REMOTE/"
else
  echo "WARNING: BACKUP_RCLONE_REMOTE is not set; this copy exists only on this machine." >&2
  echo "         A backup on the same provider as the database is not a backup (D-032)." >&2
fi

echo "==> prune local copies older than $BACKUP_KEEP_LOCAL_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'fmip-*.dump' -mtime "+$BACKUP_KEEP_LOCAL_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'fmip-*.manifest' -mtime "+$BACKUP_KEEP_LOCAL_DAYS" -print -delete

echo "OK $NAME"
