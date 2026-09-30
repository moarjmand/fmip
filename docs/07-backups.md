# 07 — Backups and restore

The database is the product: forecasts, evaluations, users, reputation. This
is the runbook for keeping a copy of it somewhere the VPS provider cannot take
away, and for proving, on a schedule, that the copy restores (T-072, D-032).

Everything here is two scripts (and the `lib.sh` they share) and two pairs
of systemd units in `scripts/backup/`.
Nothing is installed on the host beyond Docker: `pg_dump` runs in the
postgres container, `rclone` in its official image.

## What is backed up

- The whole `fmip` database as a `pg_dump` custom-format archive
  (`fmip-<UTC timestamp>.dump`): every schema (`public`, `training`), all
  data, constraints, triggers, indexes. Owners and privileges are left out so
  the archive restores under any role.
- A **manifest** beside it (`fmip-<timestamp>.manifest`): the list of applied
  migrations, the exact row count of every table, size and SHA-256 of the
  dump. The drill checks the restored copy against this file, so a silently
  truncated or partial dump cannot pass.

Not backed up: Redis (cache and live state, rebuilt from the database and the
providers), container images (rebuilt from the repository), `.env` (kept by
the maintainer in the password manager — a backup without its secrets is
still a backup; a repository with them is a leak).

## Where

| Copy | Location | Kept | Why |
| --- | --- | --- | --- |
| Local | `BACKUP_DIR` on the VPS (default `./backups`) | `BACKUP_KEEP_LOCAL_DAYS`, default 7 | Fast restore after an application mistake |
| Off-provider | `BACKUP_RCLONE_REMOTE`, an rclone remote on **another company's** storage | `BACKUP_KEEP_REMOTE_DAYS`, default 90 | Survives losing the VPS, the account, or the provider |

The off-provider copy is the one that matters. `backup.sh` warns loudly when
`BACKUP_RCLONE_REMOTE` is unset, and refuses to call the run a success if
the remote's reported size differs from the local dump.

### Setting up the off-provider remote (maintainer, once)

1. Create a bucket at a provider that is not the VPS host — Backblaze B2,
   Cloudflare R2, Hetzner Storage Box, Scaleway; any S3-compatible or SFTP
   target rclone supports. Create credentials that can write and delete in
   that bucket only.

   **On Backblaze B2, deleting is not deleting unless you say so.** A new
   bucket keeps every version of every file, and rclone’s B2 backend only
   *hides* a file it is asked to remove. `backup.sh` prunes the remote with
   `rclone delete --min-age 90d`, so without `hard_delete = true` below
   every dump ever uploaded stays stored, and billed, forever, while
   `rclone ls` shows only the last ninety days -- a retention setting that
   looks as if it works. Set the bucket’s lifecycle to "Keep only the last
   version of the file" as well, so anything hidden by some other route is
   removed too. Pick the region when the account is created (it cannot be
   changed later): EU Central, beside a server in Europe. Bucket names are
   global across all of B2, so `fmip-backups` may be taken; whatever name
   you get goes into `remote = b2:<name>` below.
2. On the VPS, **as `fmip`**, write `~/.config/rclone/rclone.conf` --
   `/home/fmip/.config/rclone/rclone.conf`, because the timer runs the backup
   as `fmip` (the unit's `User=`) and reads the config from that account's
   home -- with two remotes: the
   storage remote, and a `crypt` remote wrapping it, so the dumps are
   encrypted before they leave the machine:

   ```ini
   [b2]
   type = b2
   account = <key id>
   key = <application key>
   # Without this, a pruned dump is hidden, not removed (see step 1).
   hard_delete = true

   [offsite]
   type = crypt
   remote = b2:fmip-backups
   password = <rclone obscure ...>
   password2 = <rclone obscure ...>
   ```

   Keep a copy of this file (it holds the encryption keys) in the password
   manager. Without it the off-provider copies are noise.

3. In `.env`: `BACKUP_RCLONE_REMOTE=offsite:` (the crypt remote), and the
   retention values if the defaults are wrong.
4. Run `bash scripts/backup/backup.sh` once by hand and read its output to
   the end: it must print `verified <n> bytes on the remote` and `OK`.

## Schedule

`fmip-backup.timer` runs `backup.sh` daily at 03:30 UTC (plus up to ten
minutes of jitter) and catches up after a reboot:

```bash
sudo cp scripts/backup/fmip-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fmip-backup.timer
systemctl list-timers fmip-backup.timer
journalctl -u fmip-backup.service -n 50
```

The unit assumes the checkout lives at `/opt/fmip`; edit `WorkingDirectory`
if not. A failed run leaves a non-zero exit in `journalctl` **and a row in
`backup_run`** (below), which is how an administrator hears of it.

`fmip-restore-drill.timer` runs the drill on the **first Monday of each month
at 04:40 UTC** (plus up to five minutes of jitter), an hour after that
morning's backup, from the off-provider copy (T-805, D-101):

```bash
sudo cp scripts/backup/fmip-restore-drill.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fmip-restore-drill.timer
systemctl list-timers fmip-restore-drill.timer    # NEXT is a Monday, day 1-7
# See what it would do without doing it, as the account the unit runs as:
sudo -u fmip bash -lc 'cd /opt/fmip && bash scripts/backup/restore-drill.sh --scheduled --dry-run'
# Run it now rather than waiting for the Monday (optional; takes minutes):
sudo systemctl start fmip-restore-drill.service
journalctl -u fmip-restore-drill.service -n 60
```

The service runs `restore-drill.sh --scheduled`, which downloads the newest
dump and manifest from `BACKUP_RCLONE_REMOTE` into `BACKUP_DIR/drill-<pid>/`,
fails if that dump is more than `BACKUP_DRILL_MAX_AGE_HOURS` (48) old, runs
every check below, then compares the restored copy with the live database --
the migrations must be live's (or an earlier prefix of them, if a deploy
landed after the dump), and `user_account`, `user_prediction`, `settlement`,
`forecast`, `fixture` and `message` must be within
`BACKUP_DRILL_TOLERANCE_PCT` (10 %, never under 100 rows) of live. A whole dump
of the wrong database, or of last spring's, passes the manifest; it does not
pass this. The throwaway container and the downloaded files are removed
whatever happens. With no remote set, it drills the newest local dump and the
record says so.

### Where the API reads it (`backup_run`)

Both scripts end every run, pass or fail, by appending one row to the
`backup_run` table (kind, start, finish, ok, the dump's name, and what failed)
through `psql` in the postgres container -- the same way they already reach
the database. A run that dies half way records the step it died in. The
watchdog reads the table every minute (T-801, D-095, D-101):

| Condition | Measured | `degraded` | `failing` |
| --- | --- | --- | --- |
| `backup` | since the newest successful backup | 26 h, **or the newest run failed** | 50 h, or no success on record |
| `restore_drill` | since the newest drill that passed | 35 days | 70 days, **or the newest drill failed** |

Both are `unknown` while nothing has been recorded on the deployment (a
laptop, or a server whose timers are not installed), never `ok`. Leaving `ok`
is an alert to every administrator (T-802), so **a failed backup or drill
reaches an administrator's device within minutes**. It recovers when a later
run succeeds. `BACKUP_RECORD=off` skips the row (a rehearsal against a
database without the table); a row that cannot be written is a warning in
the run's output, not a failed backup.

Recovery point: up to 24 hours of data from the dumps alone (one a day).
With point-in-time recovery switched on (below, T-845, D-157) it is about ten
minutes, to any minute of the last seven days.

With `PG_ARCHIVE_MODE=on` the `backup` condition also watches the WAL archiver
(`pg_stat_archiver`, Postgres's own view): `degraded` when finished segments
have waited 30 minutes to be archived or the newest attempt was refused,
`failing` at two hours. The worse of the dump and the archiver decides; the
observed number stays the dump's age. With archiving off nothing changes.

## Point-in-time recovery (T-845, D-157)

The daily dump loses up to a day. Point-in-time recovery keeps every change:
Postgres's own WAL archiving, shipped through the same crypt remote. No new
component -- Postgres, rclone and systemd, as for the dumps.

```
postgres --archive_command--> wal-archive.sh --gzip--> `wal-spool` volume
                               (inside the container, once per 16 MB segment)
fmip-wal-ship.timer (5 min) --pitr.sh ship--> $BACKUP_RCLONE_REMOTE/wal/
backup.sh (daily) --pitr.sh base --if-due--> $BACKUP_RCLONE_REMOTE/base/  (weekly)
restore-drill.sh --pitr --pitr.sh restore--> throwaway postgres, replayed to a minute
```

- **Archiving.** `PG_ARCHIVE_MODE=on` in `.env`, read by
  `deploy/docker-compose.prod.yml` (`archive_mode`, `archive_command`,
  `archive_timeout` = `PG_ARCHIVE_TIMEOUT`, 300 s, and `wal_recycle=off`).
  Changing it restarts Postgres. `wal-archive.sh` gzips each finished segment
  into the spool; a segment closed early by the timeout is mostly zeros and
  gzips to about 16 KB, so a quiet day costs about 5 MB.
- **Back-pressure.** If a spooled segment has waited 30 minutes, the shipper
  has stopped, and `wal-archive.sh` refuses the next one. Postgres keeps it in
  `pg_wal` and retries every minute, and the watchdog raises `backup`. The
  server's disk is what fills while this lasts; the alert is the reason to act.
- **Shipping.** `pitr.sh ship`, from `fmip-wal-ship.timer` every five
  minutes: `rclone move` from the spool (upload, check, delete locally) to
  `wal/`. It also makes the spool directory writable by the postgres user, so
  the first run after switching on is what lets archiving start.
- **Base backups.** `pitr.sh base`: `pg_basebackup` as one gzipped tar with
  the WAL it needs inside, named `base-<finished UTC>-<first segment>.tar.gz`,
  copied to `base/` and checked by size. `backup.sh` calls it every day with
  `--if-due`, which does nothing unless the newest base on the remote is six
  days old -- so it is weekly, and a failed one is retried the next morning.
  A failure fails that morning's backup run, which the watchdog reports. The
  newest base stays in `BACKUP_DIR` as well.
- **Retention.** Every base of the last `PITR_KEEP_DAYS` (7) and the newest
  one before that window, and the WAL from the oldest kept base on. So any
  minute of the last seven days can be replayed to, and at most about two
  weeks of WAL are held. The dumps keep their 90 days (`backup.sh`'s remote
  prune reaches `wal/` and `base/` only past 90 days, long after this one).
- **Restore.** `pitr.sh restore --to 'YYYY-MM-DD HH:MM'` (UTC): the newest
  base finished before that minute and the WAL after it, unpacked into a new
  Docker volume and replayed in a throwaway `postgres:18-alpine` with
  `recovery_target_time` and `recovery_target_action = promote`. For a target
  in the last fifteen minutes it first closes and ships the live database's
  current segment. It prints where replay stopped in Postgres's own words
  (`recovery stopping before commit ... time ...`, `last completed transaction
  was at log time ...`). `--keep` leaves the container for inspection or a
  dump; without it everything is removed.

### Before switching it on: the measurement (D-157's gate)

```bash
sudo -u fmip bash -lc 'cd /opt/fmip && bash scripts/backup/pitr.sh measure'
```

It prints the database size, the WAL written per day, how well this
database's own segments gzip, what the remote holds now, and the projected
total with point-in-time recovery against `PITR_REMOTE_BUDGET_GB` (10 GB,
B2's free allowance), ending `FITS` or `DOES NOT FIT` (exit 3). Every run
appends a sample to `BACKUP_DIR/wal-measure.log`; the first run's figure is
marked `PROVISIONAL` (the larger of `pg_stat_wal` since its reset and the
cluster's whole-life average, which counts the initial backfill), and a run
six or more days later measures the real week. **If it does not fit, stop:
a bigger storage plan is the maintainer's purchase, and nothing here is
switched on.** The projection counts two base backups at the database's full
size and two weeks of WAL, so it errs high.

### The drill

`restore-drill.sh --pitr '<minute>'` runs `pitr.sh restore` into its own
container and checks what D-101 checks without a manifest: the forecast
CHECK and the immutability trigger, and with `--scheduled` the migrations and
key tables against live, and that the last transaction replayed is within 15
minutes before the stated minute (the live database writes every minute, so
a larger gap means WAL missing from the archive). The monthly
`fmip-restore-drill.service` runs `--scheduled --pitr auto` (an hour before
the drill) after the dump drill; both record a `restore_drill` row, the
replay's subject being `pitr <minute>`. With archiving off it exits 0 and
records nothing.

### Recovering for real to a minute

When the damage has a time (a bad migration at 14:07, an operator mistake):

```bash
# 1. Replay to the minute before it, into a throwaway container, and keep it.
bash scripts/backup/pitr.sh restore --to '2026-10-01 14:06' --keep --name fmip-pitr
# 2. Look: docker exec -it fmip-pitr psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
# 3. Carry it over the way a dump is restored (below): dump from the replay,
#    restore beside live as fmip_restore, inspect, swap.
docker exec fmip-pitr pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  --no-owner --no-privileges > backups/pitr-20261001T1406.dump
# ...then "The data is wrong, the server is fine" below, with this file.
docker rm -f fmip-pitr && docker volume rm fmip-pitr-data
```

On a new server the same works once `.env` (with `BACKUP_RCLONE_REMOTE`) and
`rclone.conf` are back and Postgres is up: `restore` reads only the remote.

Switching it on and rolling it back on the server: `09-deploy.md`,
"Point-in-time recovery".

### Rehearsed on 2026-09-30

On the maintainer's laptop: the production compose file under its own
project (`COMPOSE_PROJECT_NAME=fmip-pitr`), `PG_ARCHIVE_MODE=on`,
`PG_ARCHIVE_TIMEOUT=60`, a `type = local` rclone remote inside `BACKUP_DIR`
(as in "Verifying on a developer machine" below), loaded with the
development database (106 migrations).

- Before the first `ship`, Postgres refused segment 1 with
  `fmip-wal-archive: /wal-spool is missing or not writable` -- why the
  switch-on runs `ship` at once. After it, a segment arrived every minute.
- `pitr.sh base`: a 5 MB base, verified on the remote; the one segment older
  than it pruned.
- **The proof.** A row `before` written at 23:53:11 UTC; the target stated as
  23:54; a row `after` written at 23:54:19. `pitr.sh restore --to '2026-09-29
  23:54' --keep` closed and shipped the current segment, downloaded the base
  and four segments, and replayed: `recovery stopping before commit of
  transaction 1840, time 2026-09-29 23:54:19.52`, `last completed transaction
  was at log time 2026-09-29 23:53:11.56`. The restored copy held `before`
  and not `after`, 106 migrations and 64 fixtures, on timeline 2 (promoted).
  About two minutes end to end.
- **The drill.** `restore-drill.sh --scheduled --pitr '2026-09-30 00:12'`:
  last transaction 3 minutes before the stated minute, the CHECK and the
  trigger present, migrations live's, the six key tables equal to live,
  `DRILL PASSED`, and a `restore_drill` row. An earlier attempt at a minute
  after which the quiet database had committed nothing failed with Postgres's
  `recovery ended before configured recovery target was reached`; `restore`
  now commits one empty transaction before closing the current segment, and
  says what that message means when it appears.
- **Back-pressure.** A spooled file dated a day back made the next segment
  refused (`... has waited more than 30 minutes; fmip-wal-ship.timer is not
  shipping`, `last_failed_time` after `last_archived_time`, which is what the
  watchdog reads); one `ship` later the next segment archived.
- Segments closed by the timeout gzipped to about 16 KB each.

## The restore drill

A backup nobody has restored is a hope. `restore-drill.sh` restores a dump
into a **throwaway** Postgres container (never the running one), and passes
only if all of these hold:

1. The dump's SHA-256 matches the manifest.
2. `pg_restore --exit-on-error` completes.
3. The applied migrations are exactly the manifest's list.
4. The row count of **every** table equals the manifest's.
5. The forecast probability CHECK and the immutability trigger exist in the
   restored copy (a schema-only or data-only mistake would lose them).

```bash
bash scripts/backup/restore-drill.sh                       # newest local dump
bash scripts/backup/restore-drill.sh backups/fmip-20260910T120000Z.dump
bash scripts/backup/restore-drill.sh --offsite             # newest dump on the remote
bash scripts/backup/restore-drill.sh --scheduled           # what the timer runs
bash scripts/backup/restore-drill.sh --scheduled --dry-run # what it would do; does nothing
```

Exit status 0 is the verdict; the last line reads `DRILL PASSED` or
`DRILL FAILED` with the difference printed above it.

### Is any of this running?

```bash
bash deploy/check-setup.sh
```

The `Backups` line reads the newest dump in `BACKUP_DIR` rather than a
switch, because a timer that is installed and failing looks exactly like one
that is working: `off` when nothing was ever written, `ON` with the age when
it is current, `STALE` past 48 hours (the timer runs daily, so one missed run
is still inside that), and a note whenever `BACKUP_RCLONE_REMOTE` is unset --
a copy on the machine it is a backup of does not survive losing that machine.

The `Restore drill` line reads the newest drill from `backup_run` and whether
`fmip-restore-drill.timer` is enabled: `ON` with the age of the newest pass
and the next run, `STALE` past 35 days, `FAILED` when the newest drill
failed, `off` when neither a drill nor the timer exists.

### Monthly checklist

`fmip-restore-drill.timer` does the drill itself on the first Monday of the
month, from the off-provider copy, not the local one — that is the copy whose
existence is in doubt. What is left for a person that Monday:

- [ ] `journalctl -u fmip-restore-drill.service -n 60` ends in `DRILL PASSED`,
      and the admin System page shows `restore_drill` `ok`. If it failed, the
      steps below by hand find out where.
- [ ] Note the date and the dump name in `docs/06-session-handoff.md` under
      "Last restore drill".

By hand (the timer's steps, for a failed run or a machine without the timer):

- [ ] `rclone ls offsite:` (or the docker equivalent) shows yesterday's dump
      and manifest with plausible sizes.
- [ ] Download both: `rclone copy offsite:fmip-<stamp>.dump ./restore/` and
      the manifest.
- [ ] `bash scripts/backup/restore-drill.sh ./restore/fmip-<stamp>.dump`
      prints `DRILL PASSED` (and records it, so the watchdog recovers).

If any step fails, that is the highest-priority task of the week, ahead of
any feature.

### What the drill caught on 2026-09-20

The first run against this laptop's development database **failed**, and the
reason is worth knowing before it happens on a server: `pg_restore` could not
recreate a foreign key, because the dump held rows whose parent was gone --
eight `community_analysis_draft` rows with no `community_analysis`, then
thirty-nine `conversation` rows with no `user_group`.

A row like that cannot be written while the key is enforced. It gets in when
the key is *not* enforced, which is exactly what the test-cleanup convention
does: `SET session_replication_role = 'replica'` to delete immutable rows also
turns off foreign-key triggers, so a delete that should have cascaded does not,
and the children survive their parent. Nothing complains at the time. The
database keeps working for months. **It simply stops being restorable**, and
the only thing that says so is this drill.

Two consequences. A cleanup that disables triggers must put the setting back
before deleting anything whose children matter -- already the convention in
`03-project-map.md`, and this is what forgetting it costs. And every foreign key
in the schema can be checked at once, which is how both families above were
found rather than one drill run at a time:

```sql
-- for each fk: rows in the child with no parent. The catalogue knows them all;
-- generate one count per constraint from pg_constraint and run them together.
SELECT c.conname, c.conrelid::regclass, c.confrelid::regclass
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE c.contype = 'f' AND n.nspname IN ('public', 'training');
```

After deleting the orphans the same dump restored and matched: 58 migrations,
105 tables, 477 rows, `DRILL PASSED`.

## Restoring for real

Two situations.

**The data is wrong, the server is fine** (a bad migration, an operator
mistake): restore into a *new* database beside the live one, inspect, then
swap.

```bash
docker compose exec -T postgres createdb -U "$POSTGRES_USER" fmip_restore
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d fmip_restore \
  --no-owner --no-privileges --exit-on-error < backups/fmip-<stamp>.dump
# inspect fmip_restore; when satisfied, stop api/model, then in psql:
#   ALTER DATABASE fmip RENAME TO fmip_broken; ALTER DATABASE fmip_restore RENAME TO fmip;
docker compose up -d
```

**The server is gone**: on the new VPS, clone the repository, restore `.env`
and `rclone.conf` from the password manager, `docker compose up -d postgres`,
fetch the newest dump and manifest from the remote, run the drill against
them first (it is the same restore, minus the risk), then restore into the
real database with the `pg_restore` line above targeting `fmip`, and bring
the stack up. Expect this to take under an hour; the drill is the rehearsal
of exactly these steps.

## Verifying on a developer machine

The same scripts run against the compose stack on a laptop (`.env` present,
`docker compose up -d postgres`). To rehearse the off-provider path without
a real bucket, point rclone at a directory inside the mounted backup folder:

```bash
printf '[offsite]\ntype = local\n' > /tmp/rclone.conf
BACKUP_RCLONE_REMOTE=offsite:/data/offsite-rehearsal \
BACKUP_RCLONE_CONFIG=/tmp/rclone.conf bash scripts/backup/backup.sh
bash scripts/backup/restore-drill.sh
```

`backups/` is git-ignored.
