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
