#!/usr/bin/env bash
# A complete copy of FMIP on the maintainer's own machine (T-1341):
#
#     bash scripts/backup/pull-copy.sh [destination]
#
# destination: the argument, else FMIP_COPY_DIR, else ../fmip-copy. The
# maintainer keeps theirs on an external drive: pull-copy.sh /e/Backup
#
# Run from a checkout on the maintainer's computer, with `ssh fmip-prod`
# working. Writes destination/<UTC stamp>/:
#
#   db/     the server's newest nightly dump and its manifest, the dump's
#           sha256 checked against the manifest after the download
#   media.tar  every file in the media volume: crests, logos, player and
#           news photos (T-1320, T-1322). One archive, not 3,000 files: on an
#           external drive formatted exFAT each small file takes a whole
#           1 MB cluster
#   code/   fmip.bundle, the whole repository with every branch and its
#           history (`git clone fmip.bundle` gives a working checkout)
#   INFO.txt  what was copied, from which commit the server runs
#
# Not copied, on purpose: `.env` and `rclone.conf`. They hold the secrets and
# the backup's encryption keys and stay in the password manager (07-backups).
#
# Settings (environment): FMIP_SSH_HOST (default fmip-prod), FMIP_SERVER_DIR
# (default /opt/fmip), FMIP_MEDIA_VOLUME (default fmip_media),
# FMIP_COPY_KEEP (how many earlier copies to keep, default 3).

set -euo pipefail

cd "$(dirname "$0")/../.."
HOST="${FMIP_SSH_HOST:-fmip-prod}"
SERVER_DIR="${FMIP_SERVER_DIR:-/opt/fmip}"
VOLUME="${FMIP_MEDIA_VOLUME:-fmip_media}"
KEEP="${FMIP_COPY_KEEP:-3}"
DEST_ROOT="${1:-${FMIP_COPY_DIR:-../fmip-copy}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST/db" "$DEST/code"

# A run that stops part way leaves no half copy that looks like a whole one.
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    rm -rf "$DEST"
    echo "FAILED (status $status); the incomplete $DEST was removed. Run it again." >&2
  fi
}
trap on_exit EXIT

# The route to the server drops connections now and then; each step retries,
# and keep-alives notice a dead connection rather than hanging on it.
SSH_OPTS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=30)
retry() {
  local n
  for n in 1 2 3 4 5 6 7 8; do
    "$@" && return 0
    echo "    (attempt $n failed, retrying)" >&2
    sleep 15
  done
  return 1
}

echo "==> newest dump on $HOST"
DUMP="$(retry ssh "${SSH_OPTS[@]}" "$HOST" "ls -1t $SERVER_DIR/backups/fmip-*.dump | head -n 1")"
[ -n "$DUMP" ] || { echo "ERROR: no dump in $SERVER_DIR/backups" >&2; exit 1; }
NAME="$(basename "$DUMP" .dump)"
echo "    $NAME"
retry scp -q "${SSH_OPTS[@]}" "$HOST:$SERVER_DIR/backups/$NAME.manifest" "$DEST/db/"
retry scp -q "${SSH_OPTS[@]}" "$HOST:$SERVER_DIR/backups/$NAME.dump" "$DEST/db/"

WANT="$(grep '^sha256 ' "$DEST/db/$NAME.manifest" | cut -d' ' -f2)"
GOT="$(sha256sum "$DEST/db/$NAME.dump" | cut -d' ' -f1)"
if [ "$WANT" != "$GOT" ]; then
  echo "ERROR: $NAME.dump does not match its manifest ($GOT, expected $WANT)" >&2
  exit 1
fi
echo "    sha256 matches the manifest"

echo "==> media volume $VOLUME"
# tar inside a throwaway container that reads the volume, streamed here.
retry sh -c "ssh ${SSH_OPTS[*]} '$HOST' 'docker run --rm -v $VOLUME:/m:ro alpine tar -C /m -cf - .' > '$DEST/media.tar'"
# Listing the archive end to end is the check that it arrived whole.
MEDIA_FILES="$(tar -tvf "$DEST/media.tar" | grep -c '^-')"
echo "    $MEDIA_FILES files"

echo "==> repository"
git fetch -q origin || echo "    (fetch failed; bundling what this checkout has)" >&2
git bundle create -q "$DEST/code/fmip.bundle" --all
git bundle verify -q "$DEST/code/fmip.bundle"
SERVER_COMMIT="$(retry ssh "${SSH_OPTS[@]}" "$HOST" "git -C $SERVER_DIR rev-parse HEAD")"

{
  echo "FMIP copy taken $STAMP"
  echo "database   db/$NAME.dump ($(wc -c < "$DEST/db/$NAME.dump") bytes, sha256 $GOT)"
  grep -E '^(dumped_at|pg_dump) ' "$DEST/db/$NAME.manifest" | sed 's/^/           /'
  echo "media      media.tar, $MEDIA_FILES files ($(wc -c < "$DEST/media.tar") bytes)"
  echo "code       code/fmip.bundle; the server runs commit $SERVER_COMMIT"
  echo "not here   .env and rclone.conf (password manager)"
  echo "restore    docs/07-backups.md, 'A copy on the maintainer's machine'"
} > "$DEST/INFO.txt"

echo "==> keep the newest $KEEP copies in $DEST_ROOT"
# Stamps sort by time; only directories this script named are touched.
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' | sort -r | tail -n "+$((KEEP + 1))" |
  while read -r old; do echo "    removing $old"; rm -rf "$old"; done

cat "$DEST/INFO.txt"
echo "OK $DEST"
