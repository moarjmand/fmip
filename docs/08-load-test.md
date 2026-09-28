# 08 — Load test: the live path at peak

The live surfaces are one Postgres `LISTEN` connection fanned out to every
open server-sent-event client in the API process (T-032, D-034). This is the
runbook and the record for proving what one process carries at a big-match
peak (T-073, D-047), before and after every change to the live path.

## The threshold (D-047)

One API process must carry **1,000 concurrent stream clients** with:

| Measure | Pass |
| --- | --- |
| Connections refused or dropped during the run | 0 |
| Connect + first snapshot, p95 | under 1.5 s |
| A score change reaching every client, p95 | under 2.5 s |
| Heartbeats | steady (no `stale` event, no gap beyond 20 s) |

1,000 is the launch-stage peak the roadmap plans for: a handful of covered
leagues, one process, one VPS. Beyond it the answer is more processes behind
Cloudflare, not a bigger one — see "What limits it" below.

## The tool

`apps/api/scripts/load-sse.mjs` (Node only, plus the `pg` the API already
has). It inserts a temporary live fixture on a day nothing else uses, opens
N clients on `GET /scores/stream` for that day, then changes the fixture's
score three times through the database — the real trigger path — and
measures, per client: connect + first snapshot, the time from each `UPDATE`
to the new snapshot arriving, heartbeat gaps, drops. It deletes the fixture
when it is done and prints one JSON report.

```bash
# The API, built and running against the migrated, seeded database.
pnpm exec turbo run build --filter=@fmip/api
DATABASE_URL=... SESSION_SECRET=... MODEL_SERVICE_URL=http://127.0.0.1:8000 API_PORT=3151 \
  node apps/api/dist/main.js > apps/api/api-load.log 2>&1 &

# The run: N clients for 60 s, score changes at 10, 25 and 40 s.
DATABASE_URL=... node apps/api/scripts/load-sse.mjs --url http://127.0.0.1:3151 --clients 1000 --seconds 60
```

The temporary fixture goes into the seed's current season between two seeded
clubs. A production database is never seeded: there, name a real current
season and two of its clubs with `--season`, `--home` and `--away`, and run
the tool from the API image on the compose network, so it measures the API
process rather than the edge:

```bash
docker compose run --rm --no-deps -T   -v "$PWD/apps/api/scripts/load-sse.mjs:/app/load-sse.mjs:ro"   --entrypoint node api load-sse.mjs --url http://api:3001 --clients 1000 --seconds 60   --season <season uuid> --home <team uuid> --away <team uuid>
```

The fixture is on 2087-01-05, which no feed or job reaches, and is deleted
when the run ends.

`GET /health/live` reports the subscriber count while it runs (T-071); the
report records what it said at each change.

## The record

2026-09-12, the maintainer's Windows machine (8 logical cores), API and
Postgres (Docker) on the same host, load tool on the same host. Numbers are
milliseconds; the API's resident memory is Windows' working set.

| Clients | Refused / dropped | First snapshot p50 / p95 | Change → client p50 / p95 / max | Heartbeat gap p95 | API RSS |
| --- | --- | --- | --- | --- | --- |
| 500 | 0 / 0 | 576 / 776 | 748 / 1,398 / 1,582 | 4.6 s¹ | — |
| 1,000 | 0 / 0 | 601 / 725 | 1,188 / 1,981 / 2,167 | 4.6 s¹ | 189 MB |
| 2,000 | 0 / 0 | 680 / 1,485 | 1,784 / 3,406 / 3,845 | 15.0 s | 239 MB |

¹ Measured from the previous event, which at these sizes was the change
snapshot ~10 s before the heartbeat; the heartbeat itself is every 15 s.

2026-09-25, **the production server**: Hetzner CPX22 (2 shared AMD vCPUs,
4 GB), the tool running from the API image on the compose network against
`http://api:3001` -- so the API process, not the edge -- with Postgres, Redis,
the model, the web app, Caddy and the tool on the same two cores. The
temporary fixture went into the real Premier League 2026/27 season (the
database is not seeded) and was gone after each run.

| Clients | Refused / dropped | First snapshot p50 / p95 | Change → client p50 / p95 / max | Heartbeat gap p95 | Verdict |
| --- | --- | --- | --- | --- | --- |
| 500 | 0 / 0 | 1,023 / 1,348 | 1,124 / 1,765 / 1,903 | 4.6 s¹ | pass |
| 1,000 | 0 / 0 | 1,717 / 2,373 | 1,848 / 3,159 / 3,305 | 4.5 s¹ | **fail**: both latencies outside the threshold |

**Verdict on the server:** every client is served and nothing is dropped at
1,000, but one process on this machine meets D-047's latencies only up to
somewhere between 500 and 1,000 clients. The laptop's pass below does not
carry over to two shared cores. The remedies under "What limits it" are the
answer, in their order; until one lands, 500 is what the launch server is
proven to carry.

**After the first remedy (PR #252), the same server, the same evening:**

| Clients | Refused / dropped | First snapshot p50 / p95 | Change → client p50 / p95 / max | Heartbeat gap p95 | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 0 / 0 | 35 / 68 | 411 / 448 / 461 | 5.8 s¹ | pass |
| 2,000 | 0 / 0 | 15 / 69 | 420 / 473 / 494 | 6.9 s¹ | pass |

Streams asking the same question now share one read, so the linear term is
gone: a change reaches 2,000 clients faster than it reached 500 before, and
the first snapshot dropped from seconds to tens of milliseconds because a
ramp of identical connections joins the read already in flight. **The launch
server carries D-047's 1,000 with room to spare, and 2,000 as well.** The
next limit is not measured here; the second remedy, more processes, is still
the answer when it comes.

**Verdict on the laptop:** pass at 1,000 (every measure inside the threshold). At 2,000
every client is still served and nothing is dropped, but a change takes
3.4 s (p95) to reach everyone — outside the threshold. The knee is between
1,000 and 2,000 clients per process on this hardware.

An earlier run at 1,000 refused 142 connections during a 50-per-20 ms ramp:
the listen backlog, not the server. The tool now ramps at ~1,000
connections a second; real clients never arrive faster than that behind
Cloudflare.

## What limits it

After a change, every subscriber re-reads its own snapshot (`FixturesService.scores`
with its own filters) and serialises it: the work is linear in clients, and
that is the whole slope of the change-propagation column. Two remedies, in
order, when the peak grows past 1,000:

1. **One snapshot per distinct query per change** -- **done on 2026-09-26**,
   after the server run above failed at 1,000: subscribers with the same
   filters (and the same viewer, since favourites are pinned per member)
   share one read and one serialisation, and so do the streams of one match.
   `apps/api/src/modules/fixtures/internal/shared-snapshots.ts` joins a read
   already in flight rather than caching a finished one, and only when no
   change has arrived since that read began, so nothing older than a fresh
   read is ever served (rule 4).
2. **More processes**: the fan-out is per process and Postgres `NOTIFY`
   reaches all of them, so N processes behind Cloudflare carry N × the
   figure above with no coordination.

Neither is needed for launch; the first is the one to do when the record
above stops being true.

## When to run it

- Before T-074 (deploy) on the VPS itself, with the tool on a second
  machine: the numbers above are one host doing everything.
- After any change to `stream.controller.ts`, `change-feed.ts`,
  `scores-store.ts` or the SSE framing.
- Before a known big match, with the expected peak as `--clients`.

Add each run to the record table, with the machine.

## Page budgets (T-808)

The live path above is one limit; the pages are another. The busiest pages
-- home, scores, the match centre and the competition page -- each have two
budgets in `apps/web/perf-budgets.json`, and CI fails when either is
exceeded, naming the route, the number and the budget. Nothing new is
installed for it: the numbers come from the build's own output and from the
production build serving the seeded pages.

| Budget | What it measures | Where CI checks it |
| --- | --- | --- |
| `firstLoadJsGzipKB` | Every script the route's HTML makes the browser fetch at once: the build's root main files plus the entry chunks of the route's layouts, error boundaries and page (from `.next/build-manifest.json` and the route's `page_client-reference-manifest.js`), gzip-summed. The `noModule` polyfill is excluded; chunks a dynamic import loads later are not first-load. | `Verify`, step "Performance budgets (first-load JavaScript)", after the build: `pnpm --filter @fmip/web perf:bundle` |
| `serverResponseMedianMs` | The whole HTML document, request to last byte, against the production build with the API, the migrated database and the seed behind it: two warm-up requests, then the median of nine sequential ones. | `E2E journeys`, step "Performance budgets (server response)": the Playwright project `budgets` |

The same Playwright spec also checks that each route's served HTML names
exactly the scripts the JavaScript budget counts, so a Next upgrade that
changes what its manifests mean fails CI instead of quietly moving the
measurement.

**How the budgets were set (2026-09-28).** First-load JavaScript is
deterministic for a given build (the CI runner's Linux build measured the
same bytes as the maintainer's Windows one), so its budget is the measured
size plus about 10 % headroom: a change that adds a library to a page fails,
a small component does not. Server response is not deterministic, so its
budget is about four to seven times the median CI measured on the first run
(GitHub's `ubuntu-latest`, PR #355), with 150 ms as the floor: wide enough
that a shared runner does not fail it on a bad minute, narrow enough that a
page which starts waiting on something slow -- an unindexed query, a call
made per row, a timeout -- does.

| Route | First-load JS measured / budget (gzip kB) | Server response median, CI / laptop / budget (ms) |
| --- | --- | --- |
| home `/en` | 200.3 / 220 | 38 / 50 / 200 |
| scores `/en/scores` | 210.1 / 230 | 21 / 31 / 150 |
| match centre `/en/match/…0901` | 218.5 / 240 | 77 / 76 / 300 |
| competition `/en/competition/…0201` | 200.3 / 220 | 29 / 39 / 150 |

**Running them locally.** After `pnpm exec turbo run build --filter=@fmip/web`:
`pnpm --filter @fmip/web perf:bundle`. For the response budgets, start the
API against the migrated, seeded database (as for the journeys), then
`E2E_API_URL=http://127.0.0.1:3001 pnpm --filter @fmip/web exec playwright test --project=budgets`;
each result prints its samples.

**Raising a budget.** A budget is raised on purpose, never to make a red CI
green without looking: edit the number in `apps/web/perf-budgets.json` in the
same pull request as the change that needs it, say in the pull request what
the page gained and why it is worth the bytes or the milliseconds, and update
the measured / budget table above. Lowering one after a page gets lighter is
the same edit and needs no reason. A new route is budgeted by adding an
entry: `appRoute` as `.next/server/app` lays it out, `path` a real address of
it in the seed.

## Match alerts (T-834)

The second live path: a goal becomes a push (T-830, D-098). The live job
reads the provider every minute, writes the score, derives the events,
writes one notification per follower (`NotificationsService.emit`: the
switches, the mutes, the hourly cap, quiet hours), and at the end of the run
carries what it raised, one push per member (`MatchAlertsService.deliver`
→ `carry`). Everything happens inside the live job's run.

**Since T-835 (D-105)** the live job only records the events (`match_alert`)
and hands them to the `match-alerts` BullMQ queue. A worker writes each
event's notifications in one statement and carries them; see "T-835: the
alerts off the live job" below. The record and the gap that follow are of
the path before it, and the reason for it.

### The threshold

**A goal's push leaves within 60 seconds of the live tick that first sees
the goal.** That is one live-job interval. A push that takes longer is late
by more than the tick that found it, and the live job is also what keeps the
scores current: the next tick cannot start while this one runs (the
`ingest_run` lock skips it). Time is measured from the start of the tick to
the moment the push is handed to the push service. The provider's own delay
and the push service's delivery to the device come on top and are not ours.

### The tool

`apps/api/scripts/load-match-alerts.mjs` (Node, the built API and its dev
dependencies). It boots the ingestion module as the tests do. A scripted
provider stands in for the network, and a capturing push channel stands in
for Web Push. `--push-ms N` makes each send wait N ms, as the carrier
sends them (one after another until T-836, sixteen at a time since). The
script then:

- creates C competitions of M simultaneous matches;
- creates N members who follow `--teams-per-member` teams at random, and a
  `--competition-share` of them a competition as well;
- plays a kick-off tick (every match at once, three o'clock);
- plays G goal ticks, each a burst of `--goals-per-tick` goals in different
  matches, through the real `IngestionJobsService.live`.

After each tick it drains what the tick did not carry with the timer's own
`carry()`. It reports per tick:

- the job's duration;
- the alerts and notifications written;
- the pushes carried in the tick, and their time from the tick's start;
- the pushes left for the five-minute timer, and how many passes it took;
- the database's work (`pg_stat_database`: transactions, rows inserted and
  fetched).

**Scratch database only.** The script refuses a database named `fmip` and
deletes what it made. It also deletes the provider's `ingest_run` rows from
the last day, so never point it at a database whose runs matter.

```bash
# A scratch database in the compose Postgres, migrated and seeded.
docker exec fmip-postgres-1 psql -U fmip -d postgres -c "CREATE DATABASE fmip_load"
DATABASE_URL=postgresql://fmip:...@localhost:5432/fmip_load pnpm --filter @fmip/db migrate up
DATABASE_URL=... pnpm --filter @fmip/db seed
pnpm exec turbo run build --filter=@fmip/api

# A Saturday: fifteen competitions of six matches, 2,000 members, three bursts of ten goals.
DATABASE_URL=... SESSION_SECRET=... MODEL_SERVICE_URL=http://127.0.0.1:8000 \
  node apps/api/scripts/load-match-alerts.mjs --competitions 15 --matches 6 \
  --members 2000 --teams-per-member 2 --competition-share 0.3 --ticks 3 --goals-per-tick 10

docker exec fmip-postgres-1 psql -U fmip -d postgres -c "DROP DATABASE fmip_load"
```

### The record

2026-09-28, the maintainer's Windows machine (8 logical cores), Postgres in
Docker on the same host, a fresh migrated and seeded scratch database. Shape
in every run:

- 15 competitions × 6 simultaneous matches (90 matches, 180 clubs);
- each member follows 2 clubs, and 30 % of members also follow one competition;
- goal ticks are bursts of 10 goals in 10 different matches.

Times are milliseconds from the tick's start to the push handed to the carrier.

**Before the fix in this change**, 2,000 members:

- A tick carried at most one page: 100 notifications, whatever it raised.
  88 of 7,756 kick-off notifications were carried in the tick, and 78 to 97
  of each goal burst's ~850.
- The rest waited for the five-minute timer, which also carries 100 a pass:
  9,483 pushes needed 100 passes, **about eight hours**.

**`deliver` now passes again until the run's members have nothing due**
(at most 500 passes). With that change:

| Members | Push send | Tick | Notifications | Pushed in the tick | Push p50 / p95 / max | Left for the timer | Job | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | instant | kick-off (90) | 7,756 | 7,284 ¹ | 81,989 / 102,624 / 104,525 | 0 | 104.5 s | **fail** |
| 2,000 | instant | 10 goals, ×3 | 827–890 | 789–873 | 9,714–12,699 / 11,804–15,146 / ≤15,377 | 0 | 12–15 s | pass |
| 2,000 | 50 ms each | kick-off (90) | 7,756 | 7,280 | 296,647 / 509,650 / 532,849 | 0 | 533 s | **fail** |
| 2,000 | 50 ms each | 10 goals, ×2 | 827–890 | 789–869 | 33,335–35,737 / 56,140–60,933 / ≤63,653 | 0 | 59–64 s | **at the limit** |
| 10,000 | instant | kick-off (90) | 38,304 | 38,304 | 462,898 / 610,625 / 621,998 | 0 | 622 s | **fail** |
| 10,000 | instant | 10 goals, ×3 | 4,142–4,336 | 4,142–4,336 | 50,132–51,515 / 62,534–68,378 / ≤69,992 | 0 | 64–70 s | **fail** |

¹ Fewer pushes than notifications because a member's alerts of one run leave
as one push (the batch, D-098).

Database work for one burst of ten goals:

- **2,000 members:** ~7,000 transactions, ~1,700 rows inserted.
- **10,000 members:** ~31,000 transactions, ~8,500 rows inserted, 0.2–0.5 M
  rows fetched.

That is about seven round trips per member told, and no single statement is
slow.

**Verdict.** The stated time holds for a burst of goals up to about 2,000
members on this machine, with pushes that cost nothing to send. It does not
hold:

- at 10,000 members;
- once each Web Push request takes ~50 ms;
- for a three o'clock kick-off at any of these sizes.

The production server (2 shared vCPUs) will be slower than this laptop, not
faster.

### The gap, and its cause

**Cause.** The work is linear in the number of members told, and it is done
one member at a time inside the live job:

- **Writing:** `emit` makes about five queries per member per event (the
  switch, the mutes, the hourly cap, the quiet hours, the insert).
- **Carrying:** about three per member (the claim, the send, the record).
- **Sending:** the pushes go one after another.

At ~12 ms per member told, 4,300 members is about a minute, and a kick-off
of 90 matches is 38,000 members told at once. **While that runs, the live
job cannot start its next tick, so the scores are late too.** The alerts
delay the product's primary job, not only themselves.

**What would close it, in order:**

1. **Take the alerts out of the live job's run.** Record the event, then
   emit and carry it from a BullMQ job. The scores keep their minute
   whatever the audience.
2. **Emit a match alert as one statement per event.** An `INSERT ... SELECT`
   over the followers, with the switches, mutes, cap and quiet hours as
   joins, instead of a loop over members.
3. **Send pushes concurrently,** with a bounded pool, and claim and record
   deliveries in bulk.

Each of these is a change to the notification path's shape and has its own
task. Until the first one lands, a Saturday's peak is safe to about 2,000
following members.

**Not match alerts, found on the way.** A campaign is carried the same way,
with one `carry()` for its audience (`campaigns.service.ts`). So is
everything the five-minute timer carries. Each pass is 100 notifications, so
a campaign to 10,000 members would reach its first hundred at once and the
rest over about eight hours. That is left for its own task: the loop added
here is the match alerts' only.

### T-835: the alerts off the live job

Remedies 1 and 2 above (D-105):

- **The live job records and hands over.** `MatchAlertsService.after`
  records each event in `match_alert` and returns its key; at the end of
  the run `dispatch` adds one job to the `match-alerts` queue with the
  run's keys. The live job's run no longer waits on any audience.
- **One statement per event.** The worker claims each pending event
  (`FOR UPDATE SKIP LOCKED`, a two-minute lease), reads the audience once
  per match, and writes every follower's notification with one
  `INSERT ... SELECT` (`NotificationsService.emitToAudience`: the switch,
  the category, team and competition mutes, quiet hours, the dedupe key).
  Then it carries what it wrote, in pages of 500.

`--queue` runs the script through the queue, with a worker in the same
process, as production runs it. It needs `REDIS_URL` pointing at a
throwaway Redis (the queue is emptied). `job_ms` is then the live job
alone, and `alerts_done_ms` is until the worker has nothing left.

```bash
docker run -d --name fmip-redis-load -p 127.0.0.1:6391:6379 redis:7-alpine
DATABASE_URL=... REDIS_URL=redis://127.0.0.1:6391 SESSION_SECRET=... MODEL_SERVICE_URL=none \
  node apps/api/scripts/load-match-alerts.mjs --competitions 15 --matches 6 \
  --members 10000 --teams-per-member 2 --competition-share 0.3 --ticks 3 \
  --goals-per-tick 10 --queue
docker rm -f fmip-redis-load
```

**Record, 2026-09-28**, same machine and shape as above, Redis 7 in Docker,
pushes instant (`--push-ms 0`):

| Members | Tick | Live job | Notifications | Pushes | Push p50 / p95 / max | Left for the timer | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 10 goals, ×3 | 2.7–3.9 s | 827–890 | 669–786 | 5,403–7,611 / 8,042–9,797 / ≤9,975 | 0 | pass |
| 10,000 | 10 goals, ×3 | 3.1–3.5 s | 4,142–4,336 | 3,933–4,223 | 19,108–21,102 / 32,818–34,611 / ≤36,021 | 0 | **pass** (was 62.5–68.4 s) |
| 10,000 | kick-off (90) | 3.8 s | 38,304 | 35,862 | 168,163 / 291,081 / 304,778 | 0 | fail (T-836) |

**The live job now takes 3–4 s whatever the audience,** at 10,000 members
as at 2,000, so no live tick waits on alerts (it took 64–70 s per goal burst
at 10,000 before, and a Saturday's kick-off held it for ten minutes). The
goal burst at 10,000 members is within the 60 s threshold with room. What
is left is the carrying: claim, send and record one after another, about
7 ms per notification. That is T-836.

One more fix the run forced: `recordDelivery` writes
`carried_at = greatest(now(), claimed_at)`. The database clock here steps
back now and then (the Docker VM resyncing), the `carried_after_claim`
check refused one record, and the exception stopped the whole carry, which
left 4,019 kick-off pushes for the timer.

### T-836: pushes sent concurrently

Remedy 3 above. `NotificationsService.carry` now sends its messages through
a bounded pool: at most `NOTIFICATION_SEND_CONCURRENCY` (16) at once. Each
message claims, sends and records on its own, so at most 16 are in flight
when a process stops, and the claim still makes each notification leave at
most once. A member's batch is claimed and recorded in one statement each.
A carry scoped to members reads its page member by member, so a burst is one
push per member rather than two or three. A record that fails no longer
stops the pass. The Web Push channel is unchanged: one request per device,
and a gone endpoint is removed.

**Record, 2026-09-28**, same machine and shape, `--queue`, each push held
50 ms (`--push-ms 50`), 16 at a time:

| Members | Tick | Live job | Notifications | Pushes | Push p50 / p95 / max | Left for the timer | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | kick-off (90) | 4.2 s | 7,756 | 2,009 | 15,432 / 20,793 / 21,415 | 0 | **pass** (was 509.7 s) |
| 2,000 | 10 goals, ×3 | 3.1–4.1 s | 827–890 | 624–740 | 5,114–5,799 / 6,676–6,956 / ≤7,080 | 0 | pass (was 56–61 s) |
| 10,000 | 10 goals, ×3 | 3.4–4.0 s | 4,142–4,336 | 3,177–3,631 | 12,574–14,760 / 19,113–23,625 / ≤24,553 | 0 | pass |
| 10,000 | kick-off (90) | 4.1 s | 38,304 | 10,050 | 44,105 / 70,079 / 73,208 | 0 | fail, by 10 s |

**Verdict.** Every target is met on this machine, with pushes that cost
50 ms each:

- a Saturday's kick-off of 90 matches at 2,000 members;
- a goal burst at 10,000 members;
- and the live job stays at 3–4 s throughout.

The one run past the threshold is a kick-off of 90 matches at 10,000
members (p95 70 s). Its floor is the sending itself: 10,050 pushes × 50 ms
÷ 16 is 31 s, and claiming and recording ~38,000 notifications takes the
rest. A higher `NOTIFICATION_SEND_CONCURRENCY` would lower it, at the cost
of more open requests and more waiting for the database pool (10
connections). The production server (2 shared vCPUs) is slower than this
laptop, so the margins above are smaller there.

### T-901: the carry set-based

D-106. What T-836 left was the carrying: about three round trips per
notification (a claim, then a record, per message) around the sends.

- **One claim statement a page.** `claimDue` selects the due page and
  inserts its claims in one statement (a CTE with `INSERT ... ON CONFLICT DO
  NOTHING RETURNING`) and returns the page with what this carrier won. A
  second carrier that read the same page waits on those keys and wins none,
  so a notification still leaves at most once (`carry.http.spec.ts` races
  two carriers over one page of 60).
- **One record statement a page.** `recordOutcomes` writes every outcome of
  the page with one `UPDATE ... FROM unnest(...)`. If Postgres refuses it,
  each row is recorded on its own, so one bad row does not lose the page.
- **The next page is claimed while this one sends.** `drain` overlaps them;
  match alerts' `deliver` is now a drain in pages of 500, bounded by passes.

**What the measurement found: the claim scanned.** With the claim and record
set-based, the first 10,000-member kick-off was *slower* (p95 82–92 s).
Postgres's log (`log_min_duration_statement`, `auto_explain`) showed why: the
page statements took 3 to 12 s each at the start of the burst. The planner
had not seen the 38,000 rows written a second earlier (autovacuum had not
analysed them), so it expected about 80 candidates and a claim table of a
few rows. It chose a nested loop that scanned the whole claim table once per
candidate (37.8 million rows removed by the join filter on one page). Then,
with the candidates' own columns re-joined to `notification`, a second one
(19 million).

The fix is in the statement, not an index. "No claim yet" is a probe of the
claim's primary key per candidate. It is written as a scalar subquery, which
Postgres does not flatten into a join. The page carries the columns the rest
of the statement reads, so nothing joins back. The statement runs in its own
transaction with `SET LOCAL enable_seqscan = off`, so the probe is the
primary key's index whatever the statistics say. After that, no page
statement was over 1.5 s. Across a burst they took about 12 s in all, and
the overlap with the sends hides most of it. **No index was needed**, so
migration `1764890000000` is not used.

**Record, 2026-09-29**, same machine and shape, `--queue`, `--push-ms 50`,
16 at a time. Another session's load runs shared the machine and its
Postgres for part of the evening. Runs taken while it was busy were 10–25 %
slower, and the ones below were taken when it was quiet.

| Members | Tick | Live job | Notifications | Pushes | Push p50 / p95 / max | Left for the timer | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | kick-off (90) | 3.7 s | 7,756 | 2,011 | 12,211 / 15,943 / 16,382 | 0 | pass (was 20.8 s) |
| 2,000 | 10 goals, ×3 | 2.6–2.9 s | 827–890 | 625–740 | 4,400–4,634 / 5,611–5,957 / ≤6,084 | 0 | pass |
| 10,000 | 10 goals, ×3 | 2.7–3.4 s | 4,142–4,336 | 3,175–3,630 | 10,677–11,614 / 16,412–18,218 / ≤18,971 | 0 | pass (was 19–24 s) |
| 10,000 | kick-off (90) | 3.9–4.1 s | 38,304 | 10,051 | 34,361–34,741 / 53,011–53,231 / ≤55,403 | 0 | **pass** (was 70 s) |

Two 10,000-member runs, both within a second of each other. **Every target
is met on this laptop**, the kick-off at 10,000 members included. The live
job stays at 3–4 s, so no live tick is skipped. A kick-off's page statements
are now 77 claims and 77 records, where they were about 115,000 round trips.

What is left in the kick-off's 53 s: about 10 s writing the 90 events'
audiences (T-835's statements) before the first push, and then the sends
themselves. 10,051 pushes × 50 ms ÷ 16 is 31 s, and the carry takes 43 s,
because each page of 500 notifications is about 130 messages, a little over
eight rounds of 16. The pool size is T-902's question.

## Every carrier drains (T-837)

That task. `NotificationsService.drain(scope)` carries page after page
(`carry()`, 100 each) until a page comes back short, so nothing in scope is
due. Each notification is claimed (`notification_delivery`'s key) before it
is sent, so racing carriers never send one twice. A full page that claimed
nothing means another carrier holds the rest; the drain stops rather than
spin.

**Bounded.** A drain stops after 500 pages (50,000 notifications) or four
minutes of wall time, checked between pages. What it leaves is still due,
and the next timer tick carries it.

**Who drains:**

- **A campaign** drains its reached members inside the send.
- **The five-minute timer** drains everyone's due notifications. A tick that
  finds the previous one still running skips.
- **Match alerts** keep their own loop, now in the queued worker of T-835
  (pages of 500). This task leaves it alone.

### The record

`apps/api/src/modules/campaigns/campaign-scale.http.spec.ts` sends one
campaign through `CampaignsService.send`, with capturing e-mail and push
channels. In the suite it sends to 1,000 members: ten pages, enough to prove
the send drains past the first. With `FMIP_CAMPAIGN_SCALE_MEMBERS=10000` it
sends to 10,000; that is the measured run below. The 10,000 run is not in
the suite. It is about 100,000 queries over four to seven minutes, and
beside the other suites on the one database it pushed their 5-second tests
over the limit. The spec checks:

- every member is reached;
- every notification is claimed exactly once;
- 10,000 e-mails and 10,000 pushes go out, one per member;
- a second drain finds nothing.

It prints the times. These runs were on 2026-09-28, on the maintainer's
Windows machine, with Postgres in Docker on the same host. That Postgres was
shared with another session's load runs, so the spread is wide:

| Run | Emit (10,000 `emit()` + send rows) | Carry (drain) | Carried per second | Whole send |
| --- | --- | --- | --- | --- |
| 1 | 132.6 s | 114.4 s | 87 | 247.0 s |
| 2 ¹ | 346.1 s | 83.3 s | 120 | 429.4 s |
| 3 ¹ | 152.3 s | 99.3 s | 101 | 251.6 s |

¹ The composer reads a campaign's words once per campaign instead of once
per member. Campaigns are immutable (D-075).

**Before:** the send carried the first 100, and the timer carried 100 every
five minutes. The rest took **about eight hours**. **Now:** all 10,000 are
carried in the send, in about **1.5 to 2 minutes** of carrying. The spec
allows 15 minutes for a 10,000 send (scaled down for a smaller audience,
two minutes at least), to leave room for a slower machine.

```bash
# The measured run, against a scratch database (migrated and seeded, with REDIS_URL set).
cd apps/api
FMIP_CAMPAIGN_SCALE_MEMBERS=10000 DATABASE_URL=... pnpm exec vitest run \
  src/modules/campaigns/campaign-scale.http.spec.ts --silent=false
```

**What is left.** Emission is now the larger half: about six round trips per
member, one member at a time. T-835's `emitToAudience` (one statement per
audience) would apply here too. Campaigns stay on `emit` for now, because
`send` records each member's outcome row. The carry is about three round
trips per notification, with the sends one after another; T-836's bounded
push pool applies to it too. The runs above were before T-835's
`greatest(now(), claimed_at)` fix. One earlier attempt, inside the full
suite, died on that clock step, and the rest waited for the timer.
