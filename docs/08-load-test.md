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
| home `/en` | 150.3 / 158 (2026-10-25, T-1502, after T-1495) | 38 / 50 / 200 |
| scores `/en/scores` | 172.2 / 180 (raised 2026-10-25, T-1496, D-264) | 21 / 31 / 150 |
| match centre `/en/match/…0901` | 182.6 / 191 (2026-10-25, T-1502; raised by T-1497, D-264) | 77 / 76 / 300 |
| competition `/en/competition/…0201` | 151.1 / 158 (2026-10-25, T-1502, after T-1498) | 29 / 39 / 150 |

**The raises of 2026-09-29, and the fix that undid them (T-1040, D-138).**
The scores budget was raised from 230 to 236 (T-1004), then home and
competition from 220 to 226 and the match centre from 240 to 246 (#421), as
stopgaps. None of the routes had changed: what grew was the chunk every route
shared, because `src/i18n/messages.ts` imports all eight catalogues and two
client components reached it -- the error pages through `Translated`, the
language picker through `isShippable` -- so every page's first load carried
every language, and each new catalogue key was paid for eight times.

T-1040 keeps the catalogues on the server: a client component is handed
messages already resolved for the reader's locale (D-138), and
`src/i18n/client-catalogues.spec.ts` fails if a client module reaches a
catalogue again. First-load JavaScript fell by about 72 kB gzip on every
route (home 222.4 to 149.8 kB, scores 234.8 to 162.4, the match centre 243.5
to 171.1, competition 222.4 to 149.8), and the four budgets were lowered to
the new measurement plus about 5 % -- a smaller margin than the original 10 %,
so that the next library a page gains is noticed, and no longer eaten by
strings.

**The raise of 2026-10-11 (T-1388, D-206).** The Hybrid data atoms reach
the two live pages' client bundles: the freshness stamp on both live lines
(scores 171 to 173), and on the match centre also the coverage badges with
their icons in the live view and the three-state pick (180 to 184). Both
routes had grown since T-1040, as every route has
(home and competition measure 153.0 against their 149.8 then); with the atoms
the build was 0.4 kB gzip over on scores and 1.8 kB over on the match centre;
the figures in the table are after T-1381's shell merged too (home and
competition 154.4). No library was added. The margins are thin on purpose:
the next addition to either page is a decision, not a drift.

**The raise of 2026-10-11 (T-1387, D-205).** Lite mode for slow connections
is that decision. Its client half is on every page's first load, because
only a script can see a slow connection the server was not told about: the
provider that reads the Network Information API and hands the mode to the
images, the banner with its switch, and the footnote (home and competition
154.4 to 154.8 kB, within 158). The scores page also gains the poll that
replaces its open stream in lite mode (`openLiveSource`): 172.7 to 173.4,
0.4 kB over, so its budget goes from 173 to 174 (173.3 after T-1384's match
centre merged). The match centre measured 182.5 with T-1384 and lite mode
together, within its 184, so its budget is unchanged. No library was added. What lite mode saves a reader
on a slow connection is larger than what it costs everyone: every web font
(four woff2 files on `/en/scores`, six on `/fa/scores`; Mona Sans's Latin
file alone is 98 kB) and every crest and photo.

**The raise of 2026-10-21 (T-1432, D-224).** The per-player expected-goals
card is part of the match centre's live view, so it updates with the rest of
the statistics when the box score arrives after full-time; that keeps its
table in the client bundle. The build measured
184.2 kB gzip against 184, so the budget goes to 185. Drawing the card on the
server instead would have kept the budget but frozen the card at the page's
load, which is the wrong trade for a figure that lands after the match. No
library was added.
T-1429's push offer then joined the page within the 185: only the follow
form's mark is in the first load (`push-offer-mark.tsx`, with the intent
rules alone), and the offer itself is fetched by a plain `import()` after a
follow (`push-offer-lazy.tsx`); `next/dynamic`'s loader would have cost
more than it saved. 184.8 with both.

**The raise of 2026-10-22 (T-1462, D-242).** The scores list draws its
crests in a client component, so `EntityImage`'s choice of the sized WebP
(`mediaSized`) is in its first load: 173.7 to 174.0 kB gzip against 174.
What it buys is the images: on the homepage 26 crests and logos fall from
1.66 MB to about 60 kB, and the scores page draws more of them. The budget
goes to 175. No library was added to the client.

**The raise of 2026-10-23 (T-1477, D-253).** A penalty shoot-out is found
among the incidents and drawn as its own numbered block, in the match
centre's key events and on the score card: `shootoutStart` and the kick
rows are in both live views' first load, because the key events update
during a shoot-out like the rest of the timeline. Scores 174.0 to 174.9,
within its 175; the match centre 184.8 to 185.4 against 185, so its budget
goes to 186. Finding the kicks on the server would have meant a new field in
the scores and match contracts for a rule the client already has the data
for. No library was added.

**The raise of 2026-10-25 (T-1494, D-264, D-267).** The Stadiomind navigation
is on every page: the header's More (the founder's analysis, Watch and
Highlights, a disclosure that closes when a link is chosen) and the five new
tabs, with their icons and which one is current, are in the shell's client
chunk, which every route loads. The looks were moved into CSS utilities
(`nav-entry`, `more-panel`, `tab-entry` in `globals.css`) so the components
carry no class strings for them; what is left is 0.26 kB gzip. Scores 174.9
to 175.2 against 175, so its budget goes to 176, the first kilobyte of the
5 kB D-264 allows it: the scores page's own rebuild (T-1496) may take it to
180 and no further. Home, the match centre and the competition page stay
within theirs. No library was added.

**The raise of 2026-10-25 (T-1497, D-264, D-272).** The Stadiomind match
centre: the live view gains the timeline's axis, each side's scorers in the
score band, the best rated with the rating chip and the live badge's minute
bar, all of which move during a match. The Summary's forecast card, its
versions and receipt are drawn on the server and cost the client nothing.
185.7 (after T-1494's navigation) to 187.6; T-1522's pitch, its stacked
follow-up, adds about 0.3. The budget goes to 191, D-264's one-off ceiling
for this page, leaving about 3 kB for the shared components (T-1493). No library was added.

**The raise of 2026-10-25 (T-1496, D-264, D-268).** Matches and predictions
are one page: each row has a Pick that opens the match's preview, and the
preview holds the pick form (`PredictionForm`, the match centre's own), so
the form and its server action's client reference are in the scores page's
first load: 174.9 to 177.0 kB gzip. The budget goes to 180, the once-only
5 kB D-264 allows a rebuilt page. With T-1493's change merged (the error page
no longer pulls in the `ui` barrel) the page measures 172.2. The row's percentages, its Pick and the
"Not picked yet" view add little: they are a link, a thin bar and a filter
over the snapshot the list already holds. No library was added.

**After the redesign (T-1502, 2026-10-25).** Measured on main once every
rebuilt page had landed (T-1493..T-1500 and their follow-ups, `0e7993bd`):
home 150.3, scores 172.2, match centre 182.6, competition 151.1 kB gzip.
D-264 allowed each page one raise of at most 5 kB, to home 163, scores 180,
match centre 191 and competition 163. Scores and the match centre took
theirs (180, 191). Home and competition did not need theirs, so their
budgets stay at 158; D-264's 163 remains the most they may be raised to,
once, for new behaviour the canvas shows.

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

## Visual baseline (T-1502)

`apps/web/tests/e2e/visual.spec.ts` keeps a picture of every page the
Stadiomind redesign rebuilt (home, scores, the match centre on the seed's
`…0901`, a competition, a club, a player) in Night and Day, at 1280 px and at
390 px: 24 full-page shots in `tests/e2e/visual.spec.ts-snapshots/`. They are
taken against the production build without an API, as the rest of the
`chromium` project runs, so each page is in its unreachable state with the
whole shell, the type and the colours.

What makes a shot repeatable: both clocks are fixed at 2026-10-24 18:00 UTC
-- the browser's by `page.clock.setFixedTime`, the web server's by
`tests/e2e/fixed-clock.cjs`, loaded with
`NODE_OPTIONS=--require=<its absolute path>` (the server writes
"today" into the scores day strip, the date picker and the home page's date
line; the clock is shifted, not stopped, so timers still run) -- and the spec
refuses to run without it. Motion is reduced (the device and
`fmip_motion=reduce`) and Playwright stops animations and hides the caret;
`document.fonts` has loaded every face before the shot; lite mode is off
(`fmip_lite=off`, so the web fonts are drawn and not the system stack); the
browser's language (`en-GB`) and time zone (`Europe/London`) are set and the
service worker is blocked.

**Linux only.** The committed pictures are rendered by CI's Ubuntu runner;
Windows and macOS anti-alias text differently, so the spec skips itself on any
platform but Linux and a picture made on one must never be committed.

**In CI** the E2E job compares the pictures in its own step, "Visual
baseline", the only place the server's clock is fixed: the main "Run
Playwright" step skips the spec, because its other specs must see the real
date. The pictures were committed on 2026-10-25, rendered by the runner from
`0e7993bd` plus the T-1502 changes, once every rebuilt page had landed.

**Remaking a picture after an intended change.** When a page differs from
its picture, the step fails, and the next step renders the new pictures on
the same runner (`--update-snapshots=changed`) and uploads the whole folder
as the artifact `visual-baseline`. Download it from the failed run
(`gh run download <run> -n visual-baseline -D apps/web/tests/e2e/visual.spec.ts-snapshots`),
look at what moved, and commit the pictures in the pull request that changed
the page, saying which pages moved and why. To render them without CI, use
the Playwright image of the pinned version, from the root of a clean clone
(never a checkout whose `node_modules` were installed on Windows: the
install inside would overwrite them):
`docker run --rm -v "$PWD":/w -w /w/apps/web -e NODE_OPTIONS=--require=/w/apps/web/tests/e2e/fixed-clock.cjs mcr.microsoft.com/playwright:v1.63.0-noble sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm exec playwright test visual.spec.ts --update-snapshots=changed"`.

## PageSpeed after the redesign (T-1502)

PageSpeed Insights (Lighthouse 13.5.0; mobile is a Moto G Power on slow
4G, desktop a 1350 x 940 window) against production, https://traveltohormuz.ir,
on 2026-10-25 between 18:22 and 20:04 UK time, a Sunday with matches in
play. The match page is Liverpool v Brighton
(`/en/match/2cddf547-22ca-48de-90b4-d4cb2ce00289`, full time). Production
served the rebuilt home and Matches pages.

| Page | Form | Performance | FCP | LCP | TBT | CLS | Speed Index |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/en` | mobile | **97** | 1.8 s | 1.8 s | 19 ms | 0.068 | 1.8 s |
| `/en` | desktop | 75 | 0.5 s | 0.6 s | 6 ms | 0.811 | 1.1 s |
| `/en/scores` | mobile | **97** | 2.1 s | 2.3 s | 9 ms | 0.001 | 2.1 s |
| `/en/scores` | desktop | 76 | 0.5 s | 0.6 s | 5 ms | 0.802 | 0.5 s |
| match | mobile | 89 | 2.9 s | 3.2 s | 45 ms | 0.021 | 2.9 s |
| match | desktop | 75 | 0.6 s | 0.7 s | 9 ms | 0.824 | 0.8 s |

**The bar is met.** T-1502 asks for 90 or better on mobile for `/en` and
`/en/scores`; both score 97. The same day, before T-1494..T-1500 reached
production (about 13:50 UK time), `/en` scored 99 on mobile (LCP 1.7 s,
CLS 0.003) and `/en/scores` had an LCP of 1.8 s on mobile and 0.7 s on
desktop with a CLS of 0.01; those runs' desktop scores were not read
reliably and are not recorded.

**The biggest causes, largest first.**
1. **The desktop header wraps when Archivo arrives (CLS about 0.80 on every
   page, desktop only).** Lighthouse's filmstrip shows the header on one row
   in the fallback face, then the Sign-in button drops to a second row once
   Archivo has loaded, so the header grows and `#content` moves down
   (0.802 of the shift on every page; the culprit named is
   `archivo-latin-wdth-normal.woff2`). Production's header also carries the
   «فارسی» link, which the no-API build in CI does not draw, so the visual
   baseline at 1280 px never sees the wrap. In a warm browser at 1290 and
   1350 px the row still fits; with a cold cache it does not. T-1534.
   Fixed in T-1534 (D-273): the row no longer wraps at any width, the search
   field shrinks first and folds into a link below 1280 px, and
   `tests/e2e/header-row.spec.ts` checks one 64 px row at 1024, 1280 and
   1350 px with the language link, in the fallback face and in Archivo.
2. **The match centre's LCP on a phone (3.2 s, 89).** The largest paint is
   the forecast-against-reality note, with 580 ms of element render delay
   after a 2.9 s first paint. T-1536.
3. **Font-swap shifts on a phone.** The home page's live strip shifts by
   0.068 when Archivo and Newsreader arrive, over D-264's 0.05; the match
   centre's outcome bar by 0.021. T-1536.
4. **Smaller, on every page:** about 55 kB of unused JavaScript and 24 kB of
   legacy JavaScript (polyfills for features every supported browser has),
   and a 4-5 kB cache-lifetime saving. Not worth a task each yet.

**Not performance, found on the way.** The scores page's selected row (the
one with `aria-current`) draws the model's three percentages below 4.5:1
on its highlight (Lighthouse's colour-contrast audit, on production's data).
CI's axe runs see the page without an API and so without rows. T-1535.

### T-1536: the phone's loading figures

Measured locally on 2026-10-26 against the seed's played match and `/en`
(the API on Postgres and Redis in Docker, `next start`), on a 412 x 823 phone
with slow 4G (150 ms, 1.6 Mbps) and a 4x slower CPU, the layout shifts read
by a `PerformanceObserver`. The machine was shared with other work, so its
own Lighthouse scores (61 to 87 on the same build) are not comparable with
PageSpeed's and are not recorded; what is recorded does not depend on its load.

| | main | T-1536 |
| --- | --- | --- |
| CLS when the fonts arrive, `/en` (with the seed's day on the strip) | 0.13 | 0.0001 |
| CLS when the fonts arrive, the match page | 0.051-0.057 | 0.006 |
| the same with no Arial or its clones on the device, `/en` / match | -- | 0.0008 / 0.01 |
| the match page's HTML (raw / gzip) | 436 / 75.2 kB | 366 / 62.8 kB |
| `/en`'s HTML (raw / gzip, no matches on the day) | 322 / 56.9 kB | 247 / 43.9 kB |
| the match page's answer with every API call at 150 ms (fastest of 10) | 0.70 s | 0.56 s |

The causes and what was done are D-279: fallback faces for each weight and
width Archivo is drawn at, the home's heading link on its own line on a
phone, `global-error`'s copy of the stylesheet out of every page's HTML, and
the match page's reads started together and the match asked once.
`journeys/font-swap.spec.ts` holds every web font back for 1.2 s on a phone
and requires the swap to shift `/en` and the match page by under 0.05; main
fails it on the match page (0.057).

The match page's LCP on PageSpeed waits on its answer: production answers an
edge miss in about 1.1 s for both `/en` and the match page (0.4 s for
`/health`, 0.2 s for an edge hit, read from the built-in browser), and `/en`
is usually an edge hit when PageSpeed asks for it while a match page is not.
The PageSpeed re-run against production after the deploy is the
coordinator's.

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

### T-902: the send pool sized

D-106. `NOTIFICATION_SEND_CONCURRENCY` measured at 16, 32 and 64, against the
API's `pg` pool of 10. In production one process serves the members' requests
and runs the jobs, and they share that pool. A larger send pool is faster
only until the sends queue for connections the members' requests need.

**What the pool sees.** The captured push above never touches the database,
but the Web Push channel does: it reads the member's devices before each
send and touches them after (`push-subscriptions.ts`). `--push-reads` makes
the captured push do the same two statements through the API's own pool.
Each tick then reports `api_pool`:

- `waiting_max`: the most requests waiting for a connection;
- `waiting_share`: the share of 10 ms samples in which any waited;
- `probe_ms`: a `SELECT 1` through the same pool every 100 ms, timed from
  asking to answer. That is what a member's request to the process waits for
  a connection.

**Starving the pool** means a member's request waits noticeably for a
connection. The rule applied here: `probe_ms` p95 over 100 ms, or the live job
more than 1.5 times slower than at 16. Queued sends alone are not
starvation. Connections free in milliseconds, and the pool serves waiters in
order.

**Record, 2026-09-29, the laptop**, same machine and shape: 10,000 members,
a kick-off of 90 matches and one burst of 10 goals, `--queue --push-ms 50
--push-reads`. Two runs at each value, interleaved (16, 32, 64, 16, 32, 64),
while the machine was otherwise quiet:

| Send pool | Tick | Live job | Push p50 / p95 / max (ms) | Pool waiting max / share | Probe p50 / p95 / max (ms) | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | kick-off (90) | 3.9–4.8 s | 36,041–44,006 / 55,499–63,503 / ≤65,728 | 8 / 16–19 % | 2 / 6–23 / ≤2,595 | fail once, by 3.5 s |
| 16 | 10 goals | 2.8–3.2 s | 10,324–11,239 / 16,094–17,376 / ≤18,042 | 7–8 / 15–18 % | 2 / 5–7 / ≤133 | pass |
| 32 | kick-off (90) | 2.7–4.3 s | 24,963–27,843 / 35,774–38,694 / ≤39,945 | 24 / 20–21 % | 2 / 11–20 / ≤587 | pass |
| 32 | 10 goals | 2.5–3.2 s | 6,799–7,571 / 9,973–10,522 / ≤10,917 | 24 / 18–20 % | 2 / 6–8 / ≤14 | pass |
| 64 | kick-off (90) | 3.3 s | 18,762–21,080 / 25,339–27,624 / ≤28,416 | 56 / 21–22 % | 2 / 10–18 / ≤438 | **pass** |
| 64 | 10 goals | 2.4–2.9 s | 5,232–5,691 / 6,872–7,260 / ≤7,487 | 55 / 20–21 % | 2 / 8 / ≤18 | pass |

Nothing was left for the timer in any run.

**Verdict on the laptop: 64.** It halves the kick-off's p95 against 16, and
the pool is not starved at any of the three:

- A member's request waited 2 ms at the median at every size, and at most
  23 ms at p95.
- The live job stayed at 2.4–4.8 s.
- The probe's rare spikes (0.4–2.6 s) came at every size, 16 included, while
  the audiences were being written. They are the database being busy, not
  the pool.

The queue for connections grows with the send pool (`waiting_max` is about
the pool size less 8). It stays short because each statement holds a
connection for about a millisecond.

At 64 the sends are no longer what a kick-off waits on: 10,056 pushes ×
50 ms ÷ 64 is 8 s of its 25 s. The rest is writing the audiences and claiming
the pages.

Two earlier series ran while another session's load tests shared the machine
and its Postgres. The same kick-off then ranged from 25 to 98 s at any of the
three values, and the live job sometimes took 16–34 s. Those runs are not in
the table; they measured the neighbour.

**The production server is the lead's measurement.** It has 2 shared vCPUs,
where the laptop has 8 cores. Every statement is slower there, so the queue
for connections is longer, and 64 may starve the pool where 32 does not. Run
this on the server when nothing live is on (the international break until
2026-10-08, or a weekday morning). It shares the machine with production for
about 15 minutes. It uses a scratch database and a throwaway Redis, and removes
both:

```bash
ssh fmip-prod
cd /opt/fmip && set -a && . ./.env && set +a
# The API image's build stage has the built API, the scripts and the dev dependencies.
docker build --target build -f apps/api/Dockerfile -t fmip-loadtool .
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE fmip_load"
LOAD_DB="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/fmip_load"
docker compose run --rm -e DATABASE_URL="$LOAD_DB" migrate
docker run -d --name fmip-redis-load --network fmip_default redis:8-alpine
for c in 16 32 64; do
  docker run --rm --network fmip_default -e DATABASE_URL="$LOAD_DB" \
    -e REDIS_URL=redis://fmip-redis-load:6379 -e MODEL_SERVICE_URL=none \
    -e SESSION_SECRET=load-test-only-not-a-real-secret-000000000000 \
    -e NOTIFICATION_SEND_CONCURRENCY=$c fmip-loadtool \
    node apps/api/scripts/load-match-alerts.mjs --competitions 15 --matches 6 \
      --members 10000 --teams-per-member 2 --competition-share 0.3 --ticks 1 \
      --goals-per-tick 10 --push-ms 50 --queue --push-reads > "$HOME/t902-c$c.json"
done
docker rm -f fmip-redis-load
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE fmip_load"
docker image rm fmip-loadtool
```

Choose the largest value that passes the rule above. That means `probe_ms`
p95 within 100 ms, and a live job within 1.5 times the 16 run's, in each
tick's `api_pool` and `job_ms`. Set it as `NOTIFICATION_SEND_CONCURRENCY` in
the server's `.env`; the production compose file forwards it since T-902.

**Production, 2026-09-29 (the lead's run).** The command above, on the
server during the international break, with nothing live on:

| Value | Tick | Live job | Pushes p95 | All alerts done | Pool waiting (max, share) | Probe p95 / max |
|---|---|---|---|---|---|---|
| 16 | kick-off | 1.1 s | 46.8 s | 48.7 s | 7, 1.3% | 2 / 12 ms |
| 16 | goals | 1.0 s | 12.9 s | 13.5 s | 6, 0.8% | 2 / 17 ms |
| 32 | kick-off | 1.3 s | 32.6 s | 33.8 s | 23, 5.8% | 5 / 14 ms |
| 32 | goals | 0.9 s | 7.6 s | 8.0 s | 23, 3.1% | 2 / 6 ms |
| 64 | kick-off | 1.1 s | 25.5 s | 26.2 s | 55, 10.4% | 10 / 71 ms |
| 64 | goals | 1.1 s | 5.4 s | 5.6 s | 55, 8.9% | 9 / 11 ms |

The alert jobs queue for connections at 64 (up to 55 waiters), but a
member's request does not: the probe stays far inside 100 ms and the live
job inside 1.5 times the 16 run's. **64 is the server's value** (D-106).
Then `bash deploy/rollout.sh api`, and record the figures in a table like the
one above and the value in D-106.

### T-925: a real Saturday

Saturday 2026-10-17 (the UTC day), read from production's own rows on
2026-10-19: `match_alert`, `notification`, `notification_delivery` and the
live job's `ingest_run`. Time runs from the start of the live tick before the
alert was recorded, as in the threshold above.

- 116 fixtures kicked off; 1,350 live ticks ran (1,305 succeeded, 45
  partial), p95 3.7 s, longest 14.8 s.
- 4 member accounts. One followed clubs that played and was told 22 times
  (4 kick-offs, 14 goals, 4 full-times).
- No member had a push subscription, so the carrier answered `skipped` for
  all 22. Delivery to a device was not measured; it waits for the first
  members with push switched on.

| Path | Alerts | p50 | p95 | Max | Over 60 s |
| --- | --- | --- | --- | --- | --- |
| Kick-off, tick to expanded | 100 | 3.2 s | 7.7 s | 7.7 s | 0 |
| Goal, tick to expanded | 281 | 3.0 s | 6.4 s | 201.9 s | 2 |
| Full-time, tick to expanded | 93 | 5.5 s | 86.3 s | 253.6 s | 5 |
| All three | 474 | 3.3 s | 11.7 s | 253.6 s | 7 |
| The member's notifications, tick to the carrier | 22 | 3.7 s | 7.8 s | 12.2 s | 0 |

T-834's synthetic figures for comparison: 2,000 members, goal bursts carried
in 12–15 s, and the kick-off of 90 matches the one that failed.

**The misses (7 of 474).** Each was first seen by the half-hourly
`post_match` run, not the live tick. That happens to a full-time or a late
goal the live list no longer carried. `postMatch` dispatched what it raised
only at the end of its run, after the backlog, the re-asks and the coverage
pass (146–224 s that day), so the worker could claim those alerts only 137 to
204 s after they were recorded. Not re-run: the cause is fixed in T-1419,
which hands each recent match's alerts over as soon as that match is written.

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
the suite. Before T-903 it was about 100,000 queries over four to seven minutes, and
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

### T-903: emission set-based (D-107)

The runs above spent most of the send on emission: `emit()` one member at a
time, about six round trips each, and then one outcome row per member.
`CampaignsService.send` now does what match alerts do (T-835). It takes the
audience in pages of 500 (`EMIT_PAGE`), and each page is two statements:

- `NotificationsService.emitToAudience` writes the page's notifications,
  with the same rules as `emit` (the kind's switch, the category, team and
  competition mutes, quiet hours holding and never dropping, the dedupe
  key). It returns whom it wrote, now or held.
- `PostgresCampaignStore.recordPage` writes the page's `campaign_send` rows
  and returns the count of each outcome. A member written now is `sent`, and
  one held is `delayed`. A member the inbox did not write is `duplicate` if
  they already hold this campaign's notification (its dedupe key), and
  `muted` otherwise. A page the inbox could not write at all is `failed`,
  and the next page is still sent.

Each member is in exactly one page. Nobody is reached twice: the dispatch
claim comes first, and the notification's dedupe key and `campaign_send`'s
primary key are second and third guards (D-075). The campaign-scale spec is
unchanged. `campaigns.http.spec.ts` now also covers a `delayed` and a
`duplicate` member, and checks that the report's counts equal the rows.

These runs were on 2026-09-29, on the same machine, against a scratch
database of their own (migrated and seeded), with
`FMIP_CAMPAIGN_SCALE_MEMBERS=10000`:

| Run | Emit (20 pages, 40 statements) | Carry (drain) | Carried per second | Whole send |
| --- | --- | --- | --- | --- |
| 1 | 16.7 s | 30.3 s | 331 | 46.9 s |
| 2 ¹ | 12.9 s | 24.9 s | 401 | 37.9 s |
| 3 | 9.9 s | 24.1 s | 416 | 34.0 s |
| 4 | 10.2 s | 24.6 s | 406 | 34.8 s |

¹ With timing around each statement (removed again). Each page's inbox
statement took 0.4 to 1.0 s for 500 members, and its outcome statement took
50 to 180 ms.

**Before:** 132 to 346 s of emission. **Now:** 10 to 17 s, and the whole
send, carriage included, finishes in under a minute. The 1,000-member suite
run takes 2.3 s to emit and 4.5 s in all. The carry also ran about four
times faster than in the runs above, because T-836's send pool now applies
to it.

**What is left.** Emission now runs at about 1 ms a member, nearly all of it
inside the inbox's one statement: the per-member checks (switch, mutes,
quiet hours) and the block-guard trigger on each row. That statement is
T-835's and is shared with match alerts, so tuning it belongs there.
Carriage is now the larger half of the send.
