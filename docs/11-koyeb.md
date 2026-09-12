# The Koyeb preview

**What this is.** A public HTTPS address with a **stable** name, on which the
whole product runs — including the live scores stream, which the quick tunnel of
T-085 cannot carry. It is where the live path gets tested in public before there
is a server (T-074).

**What it is not.** Production. A Koyeb free Instance sleeps when nobody is
looking and its database has five compute-hours a month. `docs/09-deploy.md` is
still where the product goes to live.

---

## The shape, and why

A free Koyeb organisation gets **one** Free Instance: 512 MB, 0.1 vCPU, one
region, asleep after an hour without traffic. Five containers do not fit in one,
so this is what runs and what does not.

| | Where |
|---|---|
| Web app (Next.js) | in the container, on the published port |
| API (NestJS) | in the same container, on `127.0.0.1:3001` |
| Postgres | a Koyeb database, outside the container |
| Model service | **not deployed** — forecasts say `model_unreachable` |
| Redis | **not deployed** — only the ingestion scheduler needs it |

**One port carries everything, including the stream.** Nothing in the browser
talks to the API directly: the Next.js route handlers at `/api/scores/stream`
and `/api/fixtures/:id/stream` proxy server-sent events from the API
server-side. So a single published port serves the whole product, which is
exactly what makes one free Instance enough — and what a quick tunnel could not
do.

**No model service, said out loud.** `MODEL_SERVICE_URL=off` is how a deployment
declares it has no model service. Every forecast is then recorded as
`model_unreachable` with that reason and the pages show it the way they already
show any unavailable forecast. Forgetting the variable still refuses to boot;
`off` is a statement, not an omission.

**No scheduler.** A container that scales to zero cannot poll a provider on a
schedule, and pretending otherwise would leave gaps that look like outages.
`INGESTION_SCHEDULE=off`, and the preview's data is whatever the database holds.

---

## What the maintainer does by hand

Three things. An agent session does not create accounts and does not handle
secrets, so these are yours.

### 1. The account and the database

1. Sign up at <https://www.koyeb.com/> (free; they may ask for a card only to
   verify you are a person, and the free Instance itself is not billed).
2. Create a **Postgres** database service in the same region you will run the
   app in — **Frankfurt (`fra`)** is what `deploy.sh` defaults to, because a
   free Instance can only be in Frankfurt or Washington.
3. Copy the connection string from the database's **Connection Details** tab.

Two things to check while you are there, because both would fail later and
neither is guessable: the database's **Postgres version must be 14 or newer**,
and the migrations create the `pg_trgm` and `unaccent` extensions (T-038). If
the plan does not allow `CREATE EXTENSION`, the first deploy fails on that
migration with a clear error — tell me and the search migration gets a
preview-safe path.

### 2. The two secrets

Never in a file, never in a command this repository records:

```bash
koyeb secrets create fmip-database-url
koyeb secrets create fmip-session-secret
```

The CLI prompts for each value. The session secret is 32+ random bytes; any
password manager will make one. `deploy.sh` refuses to run until both exist, and
references them as `{{secret.…}}` so the values never appear in an environment
listing.

### 3. Log in, then run the script

```bash
koyeb login
bash deploy/koyeb/deploy.sh create
```

The script never pushes an image: Koyeb clones this repository, builds
`deploy/koyeb/Dockerfile` itself, and runs it. The first build takes a while;
after that a push to `main` redeploys.

---

## After the first deploy

```bash
bash deploy/koyeb/deploy.sh status
```

Once the `*.koyeb.app` address is known, tell the app its own name — otherwise
canonical links, the sitemap, the manifest and the links in e-mails all still
say `localhost`:

```bash
koyeb services update fmip/preview \
  --env SITE_URL=https://<your-address> \
  --env WEB_BASE_URL=https://<your-address>
```

To load the development fixtures so there is something to look at:

```bash
koyeb services update fmip/preview --env PREVIEW_SEED=on
```

That is development fixture data, not product data, and the start-up log says so
every time. The seed runner refuses a production database on purpose; the
preview declares itself with `NODE_ENV=preview` for that one step, which is why
the variable is named and logged rather than quietly set.

---

## Checking it

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<address>/en
curl -N 'https://<address>/api/scores/stream?from=2026-09-13&to=2026-09-13&tz=UTC'
```

The second is the one that matters: a `snapshot` event followed by `ping`
heartbeats is the live path working through a real proxy, which is the thing
this deployment exists to prove.

**Verified locally on 2026-09-13** before any of the above: the image builds,
migrations run, the API becomes healthy, the web app starts, `GET /en` and
`GET /en/scores` answer 200, and `/api/scores/stream` delivers the snapshot
event and heartbeats through the single published port. What has not been
verified is Koyeb itself — that needs the account.

---

## When it misbehaves

| Symptom | Cause |
|---|---|
| First request takes ~30 s | The instance was asleep. There is no way to disable that on the free plan. |
| `DATABASE_URL is not set` in the log | The secret is missing or misnamed. |
| The build fails on `CREATE EXTENSION` | The database plan forbids it — see above. |
| Forecasts all say unavailable | Expected: there is no model service. |
| Scores never change | Expected: there is no ingestion scheduler. |
| The database stops answering mid-month | The five free compute-hours are spent. |

Logs: `bash deploy/koyeb/deploy.sh logs`.
