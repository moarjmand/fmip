# 19 — Launch-day safety runbook (the three invitation weeks)

> **خلاصه:** این صفحه برای سه هفتهٔ دعوت است: برای سنجش هفتگی، بستن و بازکردن ثبت‌نام، تعلیق حساب و اعتراض، پیام‌ها و گزارش‌ها، پشتیبان و آزمون بازگردانی، برگرداندن آخرین استقرار، و کندی یا خوابیدن سایت، فرمان دقیق و نتیجهٔ درست را می‌گوید.
> هر خطی که **writes** دارد سرور را تغییر می‌دهد و فقط با «بله»ی تو اجرا می‌شود؛ ایمیل سایت تا T-1952 کار نمی‌کند و هم‌تیمی هنوز نقش `moderator` ندارد (بخش ۴).

T-1971, launch phase (D-459). Every read-only command here was run once against production on
2026-11-27, and the "good result" quoted is what it printed then. Server commands run as `fmip`
in `/opt/fmip` (`ssh fmip-prod`, then `cd /opt/fmip`); long ones in `tmux`, because a long-held
ssh session gets closed. A line marked **writes** changes production: it is the maintainer's, or
the engineering session's with his yes. No agent runs one.

| Situation | Section |
|---|---|
| Monday: how is the launch doing | 1 |
| Too many sign-ups, spam, a bad day | 2 |
| A member misbehaves | 3 |
| A member writes, reports or appeals | 4 |
| Data lost or wrong; the monthly drill | 5 |
| The last deploy broke something | 6 |
| The site is slow or down | 7 |

## 1. The weekly measure (every Monday)

Run on the maintainer's PC by the growth analyst, not on the server. The queries reach the
database only through `data-audit/run.sh`'s read-only session.

```bash
bash .claude/skills/growth-funnel/launch-measure.sh <invitation date yyyy-mm-dd> E:/FMIP/data-audit/launch-internal-ids.txt
```

- **The ids file** holds the internal accounts' ids (the maintainer's, the teammate's, the test
  accounts), one per line, with `#` for a comment. It lives outside every git tree, and the
  command refuses a file git would take. Never paste it into chat or a report.
- **Good result:** a Persian table with one row per invitation week (week 1 is the invitation
  day's first seven days, UTC): sign-ups, verified e-mails, active members, predictions, and
  predictions per active member. Then a «همه» row, the 7-day return line (seen again on or after
  day 7, and predicted on or after day 7), and `written: E:/FMIP/ops/reports/growth-analyst/<date>-launch-measure.md`.
  A cell under 5 reads «کمتر از ۵». That is the privacy floor, not a fault.
- **Bad result:** `MEASURE-ERROR: ...` and no file. The line says which: the date is not a day or
  is after today, a line of the ids file is not an id (its number is given), the file is inside a
  git tree, or the queries did not run (run.sh's `AUDIT-...` line above it; check ssh as in 7).
- **Limits, stated every week:** "seen again" comes from `session.last_seen_at`, which a tab left
  open also moves. A signed-out visit, and anyone who never registers, are not measured. How many
  people were invited is the maintainer's count, not the site's.
- **Status:** the command is PR #966 (T-1966, T-1968), **not merged on 2026-11-27**. It was run
  once from that branch, with launch `2026-11-01` and an empty ids file: four weeks of
  «کمتر از ۵», totals 1 signed up, 0 verified, 0 predictions, return «۰ از ۱».

## 2. Close sign-ups, and reopen them

The switch is `SIGNUPS_CLOSED` in the server's `.env` (T-1970). **To confirm when T-1970 merges
and is deployed:** on 2026-11-27 it was still on the open branch `t-1970-close-signups`. Until a
full `bash deploy/rollout.sh` of that release, the line does nothing and the only way to stop
sign-ups is a deploy.

Close sign-ups (**writes**; about a minute, no build, no migration):

```bash
cd /opt/fmip
grep -q '^SIGNUPS_CLOSED=' .env && sed -i 's/^SIGNUPS_CLOSED=.*/SIGNUPS_CLOSED=on/' .env || echo 'SIGNUPS_CLOSED=on' >> .env
bash deploy/rollout.sh api
```

Reopen them the same way with `off`, then `bash deploy/rollout.sh api`.

- **What it does:** `POST /auth/register` answers 403 `registration_closed`, and the sign-up
  form (`/en/register`, `/fa/register`) says, after Submit, "Sign-ups are closed for now. If you
  already have an account, you can still sign in." («ثبت‌نام فعلاً بسته است. ...»). Sign-in,
  password reset, verification and everything else keep working.
- **A typo is loud:** any value other than `on`, `off` or empty stops the new api container at
  boot. `rollout.sh` then keeps the old one serving and exits non-zero. Read its last lines.
- **Good result (closed):** `rollout.sh api` ends without an error.
  `docker compose logs --since 5m api | grep -c identity.signups_closed` prints `1` or more (the
  API says it once at start-up; `0` on 2026-11-27, switch not deployed). A sign-up from a private
  window gets the sentence above, and the maintainer still signs in.
- **Good result (reopened):** the same grep prints `0`, and the sign-up form takes a new account.
  An account made only to test this is a test account: list it for T-1970's clean-up.

## 3. Suspend a member, and how they appeal

There is no CLI for either tool below: the web pages are the way. Both write the audit row
(actor, time, reason, previous value; rule 10).

| To stop | Where | Who | Effect |
|---|---|---|---|
| The whole account | `/en/admin` → **Members** → search (username, e-mail or display name) → **Account status: Suspend**, **Reason**, submit. API `POST /admin/users/:id/status` `{status, reason}` | `admin` only | Every session stops at its next request and sign-in is refused (both accept only `status = 'active'`). The content stays. **Reinstate** in the same form undoes it. An admin cannot suspend themselves |
| One thing, for some days or for good | `/en/admin/moderation` (the queue) → `/en/admin/moderation/<username>` (history, decide). API `POST /admin/moderation/decisions`: outcome `warned`, `content_removed` or `sanctioned` with `sanction {scope, days or permanent}`. Lift: `POST /admin/moderation/sanctions/:id/lift` with a reason | `moderator` or `admin` | Scope `contact` stops friend requests, `messaging` stops messages. The member still reads and predicts |

- **Good result:** the form says "Account active → suspended, recorded.", and
  `/en/admin/members/<username>` lists the new audit row. On 2026-11-27 no account was suspended
  and no report had ever been filed.
- **Appeal of a restriction:** the API exists (`POST /me/sanctions/:id/appeal`). The member's
  page for it, Settings → «محدودیت‌های حساب» / "Restrictions on your account" (`/en/settings`),
  and where a moderator reads appeals, are T-1973: **to confirm when T-1973 merges**. Until then a
  member appeals as in 4.
- **Appeal of a whole-account suspension:** a suspended member cannot sign in, so cannot use the
  site's appeal. They answer the person who invited them (4). If the maintainer reinstates, he
  writes the reason in the same form.

## 4. Where a member's message or report arrives, and who answers

Decided 2026-11-27: in the first weeks **the maintainer and the teammate** moderate and answer.

| A member... | Arrives | Answered by |
|---|---|---|
| reports a member in the site | the queue at `/en/admin/moderation` (`POST /reports`) | the maintainer or the teammate, once a day. The content-community agent prepares cases from the queue and never decides |
| appeals a restriction | see 3 (T-1973) | where possible, the moderator who did not make the decision |
| sends feedback or a question | **no channel in the site yet**: the "Send feedback" link is T-1965, which waits for T-1952. Members reply on the channel the invitation came through (the maintainer sends each invitation himself, T-1956) | the maintainer |
| cannot sign in, or forgot a password | reset is by e-mail, which does not work (below). There is no admin password reset in the code | the maintainer: wait for T-1952; never set a password for anyone |

**Before day 1 (writes, the maintainer's).** On 2026-11-27 production had exactly one role
holder, one `admin`, and **no `moderator`**. Once the teammate has a site account:

```bash
docker compose run --rm migrate node scripts/grant-role.mjs \
  --email <teammate's address> --role moderator --reason "launch-week moderation (D-459)" --by <maintainer's address>
```

Good result: `/en/admin/moderation` opens for the teammate. `--list` on the same tool shows every
grant; it prints addresses, so the maintainer runs it, not an agent. `moderator` gives the queue
and the restrictions, not `/en/admin`: a whole-account suspension stays the maintainer's unless
he also grants `admin`.

**The site's e-mail is down until T-1952.** `check-setup.sh` says `E-mail ... ON smtp` because
the setting is there, but the sends fail: 216 failures (T-1967, finding `ops-2026-11-27-01`).
Promise no verification, reset or notification e-mail, and never tell a member to "check your
inbox". Signing in and predicting do not need a verified address.

## 5. Backups and the restore drill

| What | When / where | Last seen (2026-11-27) |
|---|---|---|
| Nightly `pg_dump` and manifest (`scripts/backup/backup.sh`) | `fmip-backup.timer`, 03:30 UTC plus up to 10 min. Local copies kept 7 days in `/opt/fmip/backups` | `fmip-20261127T033246Z.dump`, 1,187,400,152 bytes, 212 tables, 32,088,229 rows, 383 s |
| Off-site copy | the same run, rclone remote `offsite:` (another company's storage, kept 90 days within a 7 GiB budget), with the media volume | "off-provider copy verified", 64,362 media files |
| Monthly drill (`restore-drill.sh --scheduled`) | `fmip-restore-drill.timer`, first Monday 04:40 UTC | next on Mon 2026-12-07 04:43 UTC |
| Point-in-time recovery | paused while the remote is on a free plan (`07-backups.md`) | — |
| Not backed up | Redis, images, `.env` (kept in the maintainer's password manager) | — |

```bash
bash deploy/check-setup.sh                 # Backups ... ON, newest dump 7h old, off-site copy to offsite:, watchdog ok
                                           # Restore drill ... ON, passed 25d ago on fmip-20261102T103116Z.dump
ls -la backups | tail -n 4                 # today's .dump (about 1.19 GB) and .manifest
systemctl list-timers --all 'fmip-*'       # 2 timers: backup within a day, drill on the first Monday
journalctl -u fmip-backup.service -n 6     # ends "recorded: backup ok=true" and "OK fmip-<stamp>"
```

**The last drill:** 2026-11-02 11:19 UTC, **passed** in 229 s, on the local dump
`fmip-20261102T103116Z.dump`: 169 migrations, 185 tables, 28,174,236 rows. That day's scheduled
drill at 04:43 had failed on row counts, the fault T-1712 fixed.

**A drill by hand.** The restore goes into a throwaway container and never touches the live
database. Run it in a match-free hour, away from the backup (03:30 to 03:50 UTC) and from a deploy.

```bash
bash scripts/backup/restore-drill.sh --scheduled --dry-run   # says what it would do; does nothing
tmux new -d -s drill "cd /opt/fmip && { date -u '+start %F %T'; bash scripts/backup/restore-drill.sh --no-record; echo DRILL_EXIT=\$?; date -u '+end %F %T'; } > \$HOME/drill.log 2>&1"
tail -n 20 ~/drill.log                                       # repeat until DRILL_EXIT= appears
```

- **Which dump:** with no argument, the newest local dump, the same file whose off-site copy was
  verified by size. `--offsite` downloads it from the remote first (about 1.2 GB), which counts
  against the free remote's daily download cap (`07-backups.md`, "A daily download cap").
- **`--no-record`** writes nothing to the database. Without it, the drill adds one `backup_run`
  row, which is how the System page and `check-setup` learn of a drill.
- **Good result:** `ok <sha256>`, `ok N migrations, last: ...`, `ok 212 tables, <rows> rows`,
  `ok forecast_probabilities_total_one`, `ok forecast_immutable`,
  `DRILL PASSED: ... restores and matches its manifest`, then `DRILL_EXIT=0`. Anything else is
  `DRILL FAILED` with the difference printed above it, and it is the week's first task.
- **Load:** one `postgres:18-alpine` container, restored by a single `pg_restore` stream. That is
  about one of the server's 2 vCPUs, plus heavy disk writes, for about 4 to 5 minutes (229 s at
  28.2 M rows; 32.1 M now). The restored copy needs about the live database's size on disk
  (8.3 GB, with 38 GB free), and the drill frees it at the end (T-1735). The unit's `Nice=10` does
  not reach the container, so the restore competes with live Postgres as an equal.

**Drill of 2026-11-27, COORDINATOR TO FILL IN:** started `__:__` UTC, ended `__:__` UTC (`___` s),
dump `fmip-________T______Z.dump`, `___` migrations, `___` tables, `__________` rows, result
`DRILL ______`, run with / without `--no-record`.

**Restoring for real** (data lost or wrong): `07-backups.md`, "Restoring for real". Restore
beside live as `fmip_restore`, inspect, then swap. That is the maintainer's call, never an agent's.

## 6. Roll back the last deploy

A deploy is `git pull --ff-only` on the server, then `bash deploy/rollout.sh` (`09-deploy.md`
§6). A rollout that fails rolls itself back: a new container that never turns healthy is
removed, the old one keeps serving, and `ROLLOUT_EXIT` is non-zero. This section is for a
rollout that succeeded and is wrong.

```bash
git reflog -3 --date=iso     # line 1 is live, line 2 is the deploy before it
                             # 2026-11-27: 51c9bb11 (07:47 UTC, #963), then 4938749b (2026-11-22)
git log --oneline -3         # the merge commits on top
```

The fast way (**writes**: a deploy that rebuilds the images from the older tree; the deploy of
2026-11-27 took about 4 minutes):

```bash
cd /opt/fmip
git checkout --detach <line-2 sha>
tmux new -d -s deploy "cd /opt/fmip && { bash deploy/rollout.sh; echo ROLLOUT_EXIT=\$?; } > \$HOME/rollout.log 2>&1"
grep ROLLOUT_EXIT= ~/rollout.log     # repeat until it prints ROLLOUT_EXIT=0
bash deploy/check-setup.sh           # ends PASS
```

Then the lasting fix, the same day. Revert the bad PR's merge commit on `main` in its own PR
(`git revert -m 1 <merge sha>`) and merge it when CI is green. Then, on the server:
`git checkout main && git pull --ff-only`, and `bash deploy/rollout.sh` in tmux as above.

- **While the checkout is detached,** the usual deploy line (`git pull --ff-only`) refuses
  ("not currently on a branch"), so nobody redeploys the bad release by accident.
- **Migrations stay applied.** The older code's `migrate` step finds nothing to run, because
  node-pg-migrate compares only the migrations both trees know. The older code works with the
  newer schema, because every release's migrations must (`09-deploy.md` §6, "Rule for
  migrations"). Never run a
  down migration to roll back.
- **An `.env` change** is undone by putting the line back and running `bash deploy/rollout.sh api`
  (no build).
- **Good result:** `ROLLOUT_EXIT=0`, `check-setup` ends PASS, and `ops-check` shows the older
  commit under "deployed commit" with the site probes at 200.

## 7. The site is slow or down

**Who:** only the maintainer has the server, Cloudflare and the hosting account, so he is the
one to call. The engineering session acts with his yes, and the ops agent (ops-release) reads and
proposes. The teammate reports what he saw: the page, the time and a screenshot.

**Check first, in this order** (all read-only):

1. `curl -si https://traveltohormuz.ir/health`, from anywhere. Good: `200` and
   `{"status":"ok",...}` (1.5 s on 2026-11-27). A `503` means the web app answers and the API
   does not. No answer at all means Cloudflare, the server or the network.
2. `bash .claude/skills/ops-check/ops-check.sh` on the maintainer's PC (it needs `ssh fmip-prod`).
   Good: every container `(healthy)`, disk under 80 % (49 %), load under about 4 on 2 vCPUs
   (2.80), the six site probes `200` (0.13 s to 0.95 s), no watchdog condition listed as not ok,
   `HTTP 5xx ... none`, `failed queue jobs ... none`. It saves the snapshot under
   `E:/FMIP/ops/reports/ops-release/snapshots/`, so the next run compares with it.
3. `ssh fmip-prod 'cd /opt/fmip && bash deploy/check-setup.sh'`. Good:
   `PASS -- everything required is healthy.` (8 s).
4. If the API is failing: `ssh fmip-prod 'cd /opt/fmip && docker compose logs --since 30m api | grep -c "\"level\":\"error\""'`
   (`0` on 2026-11-27), and the watchdog on the admin System page, `/en/admin/system`.
5. If nothing on the server is wrong: https://www.cloudflarestatus.com and https://status.hetzner.com.

**Then** (each **writes**, with the maintainer's yes):

- one service is stuck: `docker compose restart web` (or `api`);
- the disk is full of build cache: `docker builder prune -f --filter until=72h`;
- a bad release: section 6.

Never `docker compose down`, never restart Postgres, never remove a volume.

**Do not count on the outside check** to notice an outage within the hour.
`.github/workflows/uptime.yml` is scheduled every 10 minutes, and GitHub e-mails the owner when a
run fails. But GitHub ran it only three times in the 24 hours to 2026-11-27 (10:54, 19:53 and
02:29 UTC).
