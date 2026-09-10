# 07 — Backups and restore

The database is the product: forecasts, evaluations, users, reputation. This
is the runbook for keeping a copy of it somewhere the VPS provider cannot take
away, and for proving, on a schedule, that the copy restores (T-072, D-032).

Everything here is two scripts and two systemd units in `scripts/backup/`.
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
2. On the VPS, write `~/.config/rclone/rclone.conf` with two remotes: the
   storage remote, and a `crypt` remote wrapping it, so the dumps are
   encrypted before they leave the machine:

   ```ini
   [b2]
   type = b2
   account = <key id>
   key = <application key>

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
if not. A failed run leaves a non-zero exit in `journalctl`; wiring that into
the alerting of T-071 is that task's job.

Recovery point: up to 24 hours of data (one dump a day). That is accepted for
Phase 1 — forecasts and evaluations are recomputable from the training store
and the results, and user activity is light. Point-in-time recovery (WAL
archiving) is the upgrade when predictions and reputation carry real weight
(Phase 2); it is a change to `docker-compose.yml`, not to this runbook.

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
```

Exit status 0 is the verdict; the last line reads `DRILL PASSED` or
`DRILL FAILED` with the difference printed above it.

### Monthly checklist

Do this on the first Monday of the month, from the off-provider copy, not the
local one — that is the copy whose existence is in doubt:

- [ ] `rclone ls offsite:` (or the docker equivalent) shows yesterday's dump
      and manifest with plausible sizes.
- [ ] Download both: `rclone copy offsite:fmip-<stamp>.dump ./restore/` and
      the manifest.
- [ ] `bash scripts/backup/restore-drill.sh ./restore/fmip-<stamp>.dump`
      prints `DRILL PASSED`.
- [ ] Note the date and the dump name in `docs/06-session-handoff.md` under
      "Last restore drill".

If any step fails, that is the highest-priority task of the week, ahead of
any feature.

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
