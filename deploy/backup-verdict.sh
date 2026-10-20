# The Backups line of check-setup.sh (T-075, T-1427, D-219), as a function of
# what was read, so the decision can be tested without a server. Sourced by
# check-setup.sh and by its spec (apps/api/src/modules/health/backup-verdict.spec.ts).
#
#     backup_verdict <dump age in hours, or empty> <off-site remote, or empty> \
#                    <watchdog level, or empty> <watchdog since> <watchdog note> \
#                    <the dump directory, for the `off` line>
#
# Prints one line, `<state>|<detail>|<note>`, and returns 1 when the run must
# fail. The watchdog's `backup` condition (D-101, D-157) is the verdict that
# counts: it reads every run's result from backup_run and Postgres's WAL
# archiver, so it sees a dump that was written here but never reached the
# remote. The age of the newest local dump cannot: pg_dump succeeds before the
# off-site copy is tried, so between 2026-10-12 and 2026-10-20 the line said ON
# while every copy was refused. An empty level (nothing read: SETUP_CHECK_API,
# or no database) and `unknown` leave the local reading as it was.

backup_verdict() {
  local age_h="$1" remote="$2" level="$3" since="$4" note="$5" dir="${6:-./backups}"
  local copies detail
  if [ -n "$remote" ]; then
    copies="off-site copy to $remote"
  else
    copies='local only'
  fi
  # The note is the watchdog's own sentence; one line, and short enough to
  # read in a terminal (the admin console has it whole).
  note="$(printf '%s' "$note" | tr -d '\r' | tr '\n|' '  ')"
  if [ "${#note}" -gt 200 ]; then
    note="${note:0:200}..."
  fi

  if [ "$level" = 'degraded' ] || [ "$level" = 'failing' ]; then
    detail="watchdog $level since $since UTC: $note"
    printf 'FAILED|%s|%s\n' "$detail" \
      "Backups: the watchdog's backup condition is $level since $since UTC, so a recent copy is missing from $([ -n "$remote" ] && echo "$remote" || echo 'this machine'). Read why: journalctl -u fmip-backup -n 50 and journalctl -u fmip-wal-ship -n 50 (a full remote says 'storage cap exceeded'); then docs/07-backups.md."
    return 1
  fi

  if [ -z "$age_h" ]; then
    printf 'off|%s|%s\n' "no dump in $dir -- nothing has been backed up here" \
      'Backups: nothing has ever been backed up. Install scripts/backup/fmip-backup.timer and point BACKUP_RCLONE_REMOTE at a bucket at another company (docs/07-backups.md).'
    return 0
  fi

  # The timer runs daily, so one missed run is still inside 48 hours; past that
  # something is wrong rather than merely late.
  if [ "$age_h" -gt 48 ]; then
    printf 'STALE|%s|%s\n' "newest dump is ${age_h}h old, $copies" \
      "Backups: the newest dump is ${age_h} hours old and the timer runs daily. Look at it: systemctl status fmip-backup.timer, then journalctl -u fmip-backup (docs/07-backups.md)."
    return 0
  fi

  detail="newest dump ${age_h}h old, $copies"
  if [ "$level" = 'ok' ]; then
    detail="$detail, watchdog ok"
  fi
  if [ -z "$remote" ]; then
    printf 'ON|%s|%s\n' "$detail" \
      'Backups: local only. A copy on the machine it is a backup of does not survive losing that machine -- set BACKUP_RCLONE_REMOTE (docs/07-backups.md).'
  else
    printf 'ON|%s|\n' "$detail"
  fi
  return 0
}
