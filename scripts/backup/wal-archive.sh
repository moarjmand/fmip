#!/bin/sh
# Postgres's archive_command (T-845, D-157). Runs INSIDE the postgres
# container, as the postgres user, once per finished WAL segment:
#
#     archive_command = '/bin/sh /usr/local/bin/fmip-wal-archive %p %f'
#
# (deploy/docker-compose.prod.yml mounts this file there, read-only). It
# gzips the segment into /wal-spool, the `wal-spool` volume; the host's
# fmip-wal-ship.timer moves what is there through the rclone crypt remote
# (`pitr.sh ship`). Exit 0 tells Postgres the segment is safe and may be
# recycled; anything else and Postgres keeps it in pg_wal and asks again.
#
# Back-pressure: when a spooled segment is older than SPOOL_MAX_AGE_MIN, the
# shipper has stopped, and this refuses. Postgres then retries every minute,
# `pg_stat_archiver.last_failed_time` moves, and the watchdog's `backup`
# condition leaves `ok` -- rather than the spool quietly filling with
# segments that never leave the machine. The cost is pg_wal growing on the
# server's disk until shipping resumes, which the alert is there to prevent.
#
# busybox sh (postgres:18-alpine): no bashisms.

set -eu

SPOOL=/wal-spool
SPOOL_MAX_AGE_MIN=30

src="$1"
name="$2"

if [ ! -d "$SPOOL" ] || [ ! -w "$SPOOL" ]; then
  echo "fmip-wal-archive: $SPOOL is missing or not writable by $(id -un); run: bash scripts/backup/pitr.sh ship" >&2
  exit 1
fi

stale="$(find "$SPOOL" -maxdepth 1 -name '*.gz' -mmin +"$SPOOL_MAX_AGE_MIN" | head -n 1)"
if [ -n "$stale" ]; then
  echo "fmip-wal-archive: $stale has waited more than $SPOOL_MAX_AGE_MIN minutes; fmip-wal-ship.timer is not shipping" >&2
  exit 1
fi

dest="$SPOOL/$name.gz"
tmp="$dest.tmp"

# gzip -n: no name or time in the header, so the same segment always gives the
# same bytes, and a retry after a crash can be recognised below.
gzip -n -6 -c "$src" > "$tmp"

if [ -f "$dest" ]; then
  # Asked again for a segment already spooled (Postgres crashed between our
  # exit 0 and its own bookkeeping). The same bytes are success; different
  # bytes must never overwrite what was archived.
  if cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    exit 0
  fi
  rm -f "$tmp"
  echo "fmip-wal-archive: $dest exists with different content; refusing to overwrite" >&2
  exit 1
fi

# On disk before Postgres is told it may recycle the original.
sync "$tmp" 2> /dev/null || sync
mv "$tmp" "$dest"
