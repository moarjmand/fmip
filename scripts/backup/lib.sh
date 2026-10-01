# Shared by backup.sh and restore-drill.sh (T-072, T-805). Sourced, not run:
# the caller has already cd'd to the checkout and read .env.
# shellcheck shell=bash

host_path() {
  # Docker Desktop on Windows wants a Windows path in -v; everywhere else the
  # path is fine as it is.
  if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# rclone in its official image, with BACKUP_DIR mounted at /data.
rclone() {
  # Path conversion off: the container-side paths must stay POSIX.
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(host_path "$(cd "$BACKUP_DIR" && pwd)"):/data" \
    -v "$(host_path "$BACKUP_RCLONE_CONFIG"):/config/rclone/rclone.conf:ro" \
    rclone/rclone:1 "$@"
}

# The same, with the media volume read-only at /media instead (T-1341).
rclone_media() {
  MSYS_NO_PATHCONV=1 docker run --rm     -v "$BACKUP_MEDIA_VOLUME:/media:ro"     -v "$(host_path "$BACKUP_RCLONE_CONFIG"):/config/rclone/rclone.conf:ro"     rclone/rclone:1 "$@"
}

utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# record_run KIND OK SUBJECT DETAIL STARTED_AT
#
# One row in `backup_run` (T-805), which is how the API's watchdog learns that
# a backup or a drill happened and how it went. Written through psql in the
# running postgres container, with every value a psql variable (never spliced
# into the SQL). A failure to record is a warning, not the run's failure: the
# dump or the drill is what it is either way, and a backup that stops being
# recorded shows up on its own as the `backup` condition ageing past 26 hours.
record_run() {
  local kind="$1" ok="$2" subject="$3" detail="$4" started="$5"
  if [ "${BACKUP_RECORD:-on}" = 'off' ]; then
    echo "    not recorded (BACKUP_RECORD=off)"
    return 0
  fi
  if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
    echo "WARNING: POSTGRES_USER/POSTGRES_DB not set; this $kind is not recorded for the API" >&2
    return 0
  fi
  # psql interpolates :'var' only in its input, not in -c, so the statement
  # goes in on stdin.
  if printf '%s\n' "INSERT INTO backup_run (kind, started_at, finished_at, ok, subject, detail)
      VALUES (:'kind', :'started'::timestamptz, :'finished'::timestamptz, :'ok'::boolean,
              NULLIF(:'subject', ''), NULLIF(left(:'detail', 2000), ''));" |
    docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -v ON_ERROR_STOP=1 \
      -v kind="$kind" -v ok="$ok" -v subject="$subject" -v detail="$detail" \
      -v started="$started" -v finished="$(utc_now)" > /dev/null; then
    echo "    recorded: $kind ok=$ok"
  else
    echo "WARNING: could not write this $kind to backup_run (is the migration applied and postgres up?)." >&2
    echo "         The API's watchdog will not see it (docs/07-backups.md)." >&2
  fi
}
