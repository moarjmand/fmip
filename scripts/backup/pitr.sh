#!/usr/bin/env bash
# Point-in-time recovery (T-845, D-157): Postgres's own WAL archiving, shipped
# through the same rclone crypt remote as the daily dumps. No new component.
#
#     bash scripts/backup/pitr.sh measure           # will it fit? (before switching on)
#     bash scripts/backup/pitr.sh ship              # spool -> remote (fmip-wal-ship.timer, every 5 min)
#     bash scripts/backup/pitr.sh base [--if-due]   # pg_basebackup -> remote, prune (backup.sh, weekly)
#     bash scripts/backup/pitr.sh restore --to '2026-10-01 14:05' [--keep] [--name NAME]
#                                                   # base + WAL replayed to that minute (UTC),
#                                                   # in a throwaway container, never the live one
#
# How the pieces fit (docs/07-backups.md, "Point-in-time recovery"):
#   1. Postgres (PG_ARCHIVE_MODE=on in .env) hands each finished 16 MB WAL
#      segment to wal-archive.sh, which gzips it into the `wal-spool` volume.
#   2. `ship` moves the spool to $BACKUP_RCLONE_REMOTE/wal/ (encrypted there).
#   3. `base` takes a pg_basebackup once a week (backup.sh calls it daily with
#      --if-due) to $BACKUP_RCLONE_REMOTE/base/, and prunes: every base of the
#      last PITR_KEEP_DAYS (7) plus the newest one before that, and the WAL
#      older than the oldest base kept. So any moment of the last 7 days can
#      be replayed to.
#   4. `restore` downloads the newest base finished before the target and the
#      WAL after it, and replays into a throwaway postgres to the target.
#      restore-drill.sh --pitr runs it and checks the result (D-101).
#
# Settings from .env: BACKUP_RCLONE_REMOTE, BACKUP_RCLONE_CONFIG, BACKUP_DIR,
# PG_ARCHIVE_MODE, PITR_KEEP_DAYS (7), PITR_REMOTE_BUDGET_GB (10), and
# BACKUP_DRILL_IMAGE for the throwaway container.

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
PITR_KEEP_DAYS="${PITR_KEEP_DAYS:-7}"
PITR_REMOTE_BUDGET_GB="${PITR_REMOTE_BUDGET_GB:-10}"
IMAGE="${BACKUP_DRILL_IMAGE:-postgres:18-alpine}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"
REMOTE="${REMOTE%/}"
WAL_REMOTE="$REMOTE/wal"
BASE_REMOTE="$REMOTE/base"
SEGMENT_BYTES=$((16 * 1024 * 1024))

die() {
  echo "ERROR: $*" >&2
  exit 1
}

psql_live() {
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1 "$@" | tr -d '\r'
}

need_remote() {
  [ -n "$REMOTE" ] || die "BACKUP_RCLONE_REMOTE is not set: WAL on the machine it protects is not a backup (D-032)"
  [ -f "$BACKUP_RCLONE_CONFIG" ] || die "$BACKUP_RCLONE_CONFIG does not exist"
  mkdir -p "$BACKUP_DIR"
}

# rclone in its official image with BACKUP_DIR at /data and, when
# SPOOL_VOLUME is set, the postgres container's WAL spool at /spool.
SPOOL_VOLUME=''
rclone_x() {
  local extra=()
  if [ -n "$SPOOL_VOLUME" ]; then extra=(-v "$SPOOL_VOLUME:/spool"); fi
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(host_path "$(cd "$BACKUP_DIR" && pwd)"):/data" \
    ${extra[@]+"${extra[@]}"} \
    -v "$(host_path "$BACKUP_RCLONE_CONFIG"):/config/rclone/rclone.conf:ro" \
    rclone/rclone:1 "$@"
}

# base-<finished stamp>-<first WAL segment>.tar.gz: the name alone says when
# the base became usable and which WAL it needs, so choosing and pruning never
# download anything.
BASE_RE='^base-([0-9]{8}T[0-9]{6}Z)-([0-9A-F]{24})\.tar\.gz$'

stamp_epoch() { # 20261001T140500Z -> seconds
  local s="$1"
  date -u -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:${s:11:2}:${s:13:2}" +%s
}

remote_bases() {
  rclone_x lsf --files-only --include 'base-*.tar.gz' "$BASE_REMOTE" 2> /dev/null | tr -d '\r' | grep -E "$BASE_RE" | sort || true
}

# ---------------------------------------------------------------------------
cmd_measure() {
  echo "==> how much WAL this database writes (T-845's gate, D-157)"
  local now size lsn wal_bytes reset born
  now="$(date -u +%s)"
  size="$(psql_live -c "SELECT pg_database_size(current_database())")"
  lsn="$(psql_live -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint")"
  IFS='|' read -r wal_bytes reset < <(psql_live -c "SELECT wal_bytes, coalesce(extract(epoch FROM stats_reset)::bigint, 0) FROM pg_stat_wal")
  born="$(psql_live -c "SELECT extract(epoch FROM (pg_stat_file('PG_VERSION')).modification)::bigint" 2> /dev/null || echo 0)"

  # Every run appends a sample; the oldest sample at least six days back
  # gives the real week the decision asks for.
  mkdir -p "$BACKUP_DIR"
  local log="$BACKUP_DIR/wal-measure.log"
  echo "$now $lsn" >> "$log"
  local first_t first_l
  read -r first_t first_l < "$log"

  local per_day=0 basis=''
  rate() { # bytes seconds -> bytes per day
    if [ "$2" -gt 0 ]; then echo $(($1 * 86400 / $2)); else echo 0; fi
  }
  if [ $((now - first_t)) -ge $((6 * 86400)) ]; then
    per_day="$(rate $((lsn - first_l)) $((now - first_t)))"
    basis="measured over $(((now - first_t) / 86400)) days of samples in $log"
  else
    local a=0 b=0
    [ "$reset" -gt 0 ] && a="$(rate "$wal_bytes" $((now - reset)))"
    [ "$born" -gt 0 ] && b="$(rate "$lsn" $((now - born)))"
    per_day=$((a > b ? a : b))
    basis="PROVISIONAL: the larger of pg_stat_wal since its reset and the whole cluster's average; run this again in a week for the measured figure (first sample $(date -u -d "@$first_t" +%F))"
  fi

  # How well this database's WAL compresses: gzip the newest finished segments.
  local ratio_pm
  ratio_pm="$(docker compose exec -T postgres sh -c '
      cd "$PGDATA/pg_wal" || exit 0
      t=0; n=0
      for f in $(ls -t | grep -E "^[0-9A-F]{24}$" | sed -n "2,4p"); do
        c=$(gzip -6 -c "$f" | wc -c); t=$((t + c)); n=$((n + 1))
      done
      [ "$n" -gt 0 ] && echo $((t * 1000 / (n * 16777216))) || echo 0' | tr -d '\r')"
  [ "${ratio_pm:-0}" -gt 0 ] || ratio_pm=500 # no finished segment to read: assume half

  local remote_now=0
  if [ -n "$REMOTE" ] && [ -f "$BACKUP_RCLONE_CONFIG" ]; then
    remote_now="$(rclone_x size --json "$REMOTE/" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
  fi

  # Worst case held at once: two bases (the newest and the one before the
  # window, gzipped -- counted at full size to stay on the safe side) and
  # WAL back to the older of them, up to 2 x PITR_KEEP_DAYS days.
  local wal_kept bases projected budget
  wal_kept=$((per_day * 2 * PITR_KEEP_DAYS * ratio_pm / 1000))
  bases=$((2 * size))
  projected=$((remote_now + wal_kept + bases))
  budget=$((PITR_REMOTE_BUDGET_GB * 1024 * 1024 * 1024))

  mb() { echo "$(($1 / 1048576)) MB"; }
  echo "    database size:          $(mb "$size")"
  echo "    WAL written per day:    $(mb "$per_day") ($basis)"
  echo "    WAL per week:           $(mb $((per_day * 7)))"
  echo "    gzip keeps:             $((ratio_pm / 10))% of a segment"
  echo "    remote in use now:      $(mb "$remote_now")${REMOTE:+ ($REMOTE)}"
  echo "    PITR would add at most: $(mb $((wal_kept + bases))) (WAL $(mb "$wal_kept") + two bases $(mb "$bases"))"
  echo "    projected remote total: $(mb "$projected") of the ${PITR_REMOTE_BUDGET_GB} GB budget (PITR_REMOTE_BUDGET_GB)"
  if [ "$projected" -le "$budget" ]; then
    echo "FITS: point-in-time recovery fits the storage already held."
  else
    echo "DOES NOT FIT: stop here. A bigger storage plan is the maintainer's purchase (D-157)."
    return 3
  fi
}

# ---------------------------------------------------------------------------
cmd_ship() {
  need_remote
  # The spool volume is created root-owned; the archiver runs as postgres.
  # Idempotent, and cheap enough to do every five minutes.
  docker compose exec -T -u root postgres sh -c 'mkdir -p /wal-spool && chown postgres:postgres /wal-spool && chmod 700 /wal-spool'
  local id
  id="$(docker compose ps -q postgres)"
  [ -n "$id" ] || die "the postgres container is not running"
  SPOOL_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/wal-spool"}}{{.Name}}{{end}}{{end}}' "$id")"
  [ -n "$SPOOL_VOLUME" ] || die "postgres has no /wal-spool volume: is COMPOSE_FILE the production file, recreated since T-845?"
  local waiting
  waiting="$(docker compose exec -T postgres sh -c 'ls /wal-spool | grep -c "\.gz$" || true' | tr -d '\r')"
  if [ "$waiting" -gt 0 ]; then
    # move = upload, check the size landed, then delete the local file.
    rclone_x move --include '*.gz' /spool "$WAL_REMOTE/"
  fi
  local mode
  mode="$(psql_live -c 'SHOW archive_mode')"
  echo "shipped $waiting segment(s) to $WAL_REMOTE (archive_mode=$mode)"
  if [ "$mode" != 'on' ]; then
    echo "note: archiving is off (PG_ARCHIVE_MODE); nothing new will arrive in the spool" >&2
  fi
}

# ---------------------------------------------------------------------------
cmd_base() {
  local if_due=0
  [ "${1:-}" = '--if-due' ] && if_due=1
  need_remote
  [ "$(psql_live -c 'SHOW archive_mode')" = 'on' ] || die "archive_mode is off: a base backup without the WAL after it recovers nothing"

  local newest
  newest="$(remote_bases | tail -n 1)"
  if [ "$if_due" -eq 1 ] && [ -n "$newest" ]; then
    local age
    age=$(($(date -u +%s) - $(stamp_epoch "$(echo "$newest" | sed -E "s/$BASE_RE/\\1/")")))
    if [ "$age" -lt $((6 * 86400)) ]; then
      echo "base backup not due: $newest is $((age / 3600))h old (weekly)"
      return 0
    fi
  fi

  local tmp="$BACKUP_DIR/base-inprogress.tar.gz"
  echo "==> pg_basebackup -> $tmp"
  # One gzipped tar on stdout, with the WAL needed to make it consistent
  # inside (-X fetch), so the base restores even before the first ship.
  docker compose exec -T postgres pg_basebackup -U "$POSTGRES_USER" -D - -Ft -X fetch -z --checkpoint=fast > "$tmp"
  local start_wal
  start_wal="$(tar -xzOf "$tmp" backup_label | tr -d '\r' | sed -nE 's/^START WAL LOCATION: .*\(file ([0-9A-F]{24})\)$/\1/p')"
  [ -n "$start_wal" ] || die "no START WAL LOCATION in the base backup's backup_label"
  local name
  name="base-$(date -u +%Y%m%dT%H%M%SZ)-$start_wal.tar.gz"
  mv "$tmp" "$BACKUP_DIR/$name"
  local size
  size="$(wc -c < "$BACKUP_DIR/$name")"
  echo "    $name, $size bytes"

  echo "==> off-provider copy -> $BASE_REMOTE"
  rclone_x copy "/data/$name" "$BASE_REMOTE/"
  local remote_size
  remote_size="$(rclone_x size --json "$BASE_REMOTE/$name" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
  [ "$remote_size" = "$size" ] || die "remote base is $remote_size bytes, local is $size"
  echo "    verified $remote_size bytes on the remote"
  # The newest base stays on the machine for a fast local restore; older go.
  find "$BACKUP_DIR" -maxdepth 1 -name 'base-*.tar.gz' ! -name "$name" -print -delete

  prune
}

# Keep every base of the last PITR_KEEP_DAYS and the newest one before that
# window (the one a restore to the window's first minute starts from); drop
# the rest, and the WAL older than the oldest base kept.
prune() {
  echo "==> prune bases and WAL beyond $PITR_KEEP_DAYS days"
  local cutoff bases keep=() drop=() older=''
  cutoff=$(($(date -u +%s) - PITR_KEEP_DAYS * 86400))
  bases="$(remote_bases)"
  local b
  for b in $bases; do
    if [ "$(stamp_epoch "$(echo "$b" | sed -E "s/$BASE_RE/\\1/")")" -ge "$cutoff" ]; then
      keep+=("$b")
    else
      [ -n "$older" ] && drop+=("$older")
      older="$b"
    fi
  done
  [ -n "$older" ] && keep=("$older" ${keep[@]+"${keep[@]}"})
  [ "${#keep[@]}" -gt 0 ] || {
    echo "    no base on the remote; WAL is kept"
    return 0
  }
  for b in ${drop[@]+"${drop[@]}"}; do
    echo "    delete $b"
    rclone_x deletefile "$BASE_REMOTE/$b"
  done
  local oldest_wal
  oldest_wal="$(echo "${keep[0]}" | sed -E "s/$BASE_RE/\\2/")"
  local list="$BACKUP_DIR/pitr-prune-$$.list"
  # Segments (and .backup markers) before the oldest kept base's first
  # segment. Timeline .history files are tiny and always kept.
  rclone_x lsf --files-only "$WAL_REMOTE" 2> /dev/null | tr -d '\r' |
    awk -v w="$oldest_wal" '/^[0-9A-F]{24}(\.[0-9A-F]{8}\.backup)?\.gz$/ && substr($0, 1, 24) < w' > "$list" || true
  local n
  n="$(grep -c . "$list" || true)"
  if [ "$n" -gt 0 ]; then
    rclone_x delete --files-from "/data/$(basename "$list")" "$WAL_REMOTE"
  fi
  rm -f "$list"
  echo "    kept ${#keep[@]} base(s) from ${keep[0]}; deleted ${#drop[@]} base(s) and $n WAL file(s)"
}

# ---------------------------------------------------------------------------
cmd_restore() {
  local target='' name="fmip-pitr-$$" keep=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --to)
        target="$2"
        shift
        ;;
      --name)
        name="$2"
        shift
        ;;
      --keep) keep=1 ;;
      *) die "unknown option $1" ;;
    esac
    shift
  done
  [ -n "$target" ] || die "restore needs --to 'YYYY-MM-DD HH:MM' (UTC)"
  need_remote
  local target_s target_sql
  target_s="$(date -u -d "$target" +%s)" || die "cannot read the time '$target'"
  target_sql="$(date -u -d "@$target_s" '+%Y-%m-%d %H:%M:%S+00')"
  echo "==> point-in-time restore to $target_sql"

  # A target in the last minutes needs the segment being written now: close
  # it and ship it, when the live database is there to ask.
  if [ "$(psql_live -c 'SHOW archive_mode' 2> /dev/null)" = 'on' ] && [ "$target_s" -gt $(($(date -u +%s) - 900)) ]; then
    echo "    recent target: switching and shipping the current segment first"
    local before
    before="$(psql_live -c 'SELECT archived_count FROM pg_stat_archiver')"
    # Replay stops at the first commit after the target; on a quiet database
    # there may be none yet, and Postgres then refuses the whole recovery
    # ("recovery ended before configured recovery target was reached"). One
    # empty transaction with an id is a commit stamped now.
    psql_live -c 'SELECT pg_current_xact_id()' > /dev/null
    psql_live -c 'SELECT pg_switch_wal()' > /dev/null
    for _ in $(seq 1 30); do
      [ "$(psql_live -c 'SELECT archived_count FROM pg_stat_archiver')" != "$before" ] && break
      sleep 2
    done
    cmd_ship
  fi

  local base='' b
  for b in $(remote_bases); do
    [ "$(stamp_epoch "$(echo "$b" | sed -E "s/$BASE_RE/\\1/")")" -le "$target_s" ] && base="$b"
  done
  [ -n "$base" ] || die "no base backup on $BASE_REMOTE finished before $target_sql"
  local start_wal
  start_wal="$(echo "$base" | sed -E "s/$BASE_RE/\\2/")"
  echo "    base $base"

  local work="pitr-$$"
  WORK_DIR="$BACKUP_DIR/$work"
  mkdir -p "$WORK_DIR/wal"
  echo "==> download the base and the WAL from $start_wal on"
  rclone_x copy "$BASE_REMOTE/$base" "/data/$work/"
  rclone_x lsf --files-only "$WAL_REMOTE" | tr -d '\r' |
    awk -v w="$start_wal" '/\.history\.gz$/ || (/^[0-9A-F]{24}\.gz$/ && substr($0, 1, 24) >= w)' > "$WORK_DIR/wal.list"
  echo "    $(grep -c . "$WORK_DIR/wal.list" || true) WAL file(s)"
  rclone_x copy --files-from "/data/$work/wal.list" "$WAL_REMOTE" "/data/$work/wal/"

  local volume="$name-data" mount_src
  mount_src="$(host_path "$(cd "$WORK_DIR" && pwd)")"
  RESTORE_CONTAINER="$name"
  RESTORE_VOLUME="$volume"
  docker volume create "$volume" > /dev/null
  echo "==> unpack into a throwaway volume ($volume)"
  MSYS_NO_PATHCONV=1 docker run --rm -v "$volume:/var/lib/postgresql/data" -v "$mount_src:/restore:ro" "$IMAGE" sh -ec "
    d=/var/lib/postgresql/data/pgdata
    mkdir -p \$d
    tar -xzf '/restore/$base' -C \$d
    touch \$d/recovery.signal
    cat >> \$d/postgresql.auto.conf <<'EOF'
# T-845 point-in-time restore
restore_command = 'test -f /restore/wal/%f.gz && gunzip -c /restore/wal/%f.gz > %p'
recovery_target_time = '$target_sql'
recovery_target_action = 'promote'
archive_mode = 'off'
EOF
    chown -R postgres:postgres \$d
    chmod 700 \$d"

  echo "==> replay to $target_sql in $name"
  MSYS_NO_PATHCONV=1 docker run -d --name "$name" \
    -e PGDATA=/var/lib/postgresql/data/pgdata \
    -v "$volume:/var/lib/postgresql/data" -v "$mount_src:/restore:ro" "$IMAGE" > /dev/null
  local state='' i
  for i in $(seq 1 1800); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2> /dev/null)" != 'true' ]; then
      docker logs --tail 30 "$name" >&2 || true
      if docker logs "$name" 2>&1 | grep -q 'recovery ended before configured recovery target'; then
        die "the archive holds no transaction after $target_sql: WAL is missing from $WAL_REMOTE, or it has not been shipped yet (run: pitr.sh ship)"
      fi
      die "the restored postgres stopped during replay (its log is above)"
    fi
    state="$(docker exec "$name" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c 'SELECT pg_is_in_recovery()' 2> /dev/null | tr -d '\r' || true)"
    [ "$state" = 'f' ] && break
    sleep 1
  done
  [ "$state" = 'f' ] || die "replay did not finish in 30 minutes"

  # Where replay stopped, in Postgres's own words.
  local stopped
  stopped="$(docker logs "$name" 2>&1 | grep -E 'recovery stopping (before|after)|last completed transaction was at log time' | tail -n 2 | sed 's/^.*LOG: *//' || true)"
  echo "$stopped" | sed 's/^/    /'
  REPLAYED_TO="$(echo "$stopped" | sed -nE 's/.*last completed transaction was at log time ([0-9: .+-]+).*/\1/p' | tail -n 1)"
  echo "RESTORED to $target_sql${REPLAYED_TO:+ (last transaction replayed: $REPLAYED_TO)}"

  rm -rf "$WORK_DIR"
  WORK_DIR=''
  if [ "$keep" -eq 1 ]; then
    echo "    kept: docker exec -it $name psql -U $POSTGRES_USER -d $POSTGRES_DB"
    echo "    remove: docker rm -f $name && docker volume rm $volume"
    RESTORE_CONTAINER=''
    RESTORE_VOLUME=''
  fi
}

WORK_DIR=''
RESTORE_CONTAINER=''
RESTORE_VOLUME=''
cleanup() {
  if [ -n "$RESTORE_CONTAINER" ]; then docker rm -f "$RESTORE_CONTAINER" > /dev/null 2>&1 || true; fi
  if [ -n "$RESTORE_VOLUME" ]; then docker volume rm "$RESTORE_VOLUME" > /dev/null 2>&1 || true; fi
  if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi
  rm -f "$BACKUP_DIR/base-inprogress.tar.gz"
}
trap cleanup EXIT

case "${1:-}" in
  measure) cmd_measure ;;
  ship) cmd_ship ;;
  base)
    shift
    cmd_base "$@"
    ;;
  restore)
    shift
    cmd_restore "$@"
    ;;
  *)
    sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
