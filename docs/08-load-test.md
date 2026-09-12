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

**Verdict:** pass at 1,000 (every measure inside the threshold). At 2,000
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

1. **One snapshot per distinct query per change**: subscribers with the same
   filters share one read and one serialisation. Most clients on a match day
   watch the same day in the same zone, so this collapses the linear term
   almost entirely. A cache keyed by the parsed filters, invalidated by the
   same debounce that triggers the refresh.
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
