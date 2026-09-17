# A public address for testing, for free

**What this solves.** Some things cannot be checked on `localhost`: whether the
site looks right on a phone on a real network, whether Android offers to install
the progressive web app (the browser will not even consider it without real
HTTPS), whether a link shared with someone opens. Until the deploy of T-074 runs
on a paid server, there has to be a way to put the development stack on the
public internet for an hour without buying anything.

**What it is not.** None of this is hosting. Everything below is for looking at
the site; the production path is `docs/09-deploy.md`.

---

## What runs today, with no account and nothing to pay

```bash
bash scripts/public-preview.sh start
```

That starts the normal development stack and opens a **Cloudflare quick tunnel**
against the `web` container. Cloudflare hands back a random
`https://<words>.trycloudflare.com` address, the script waits for it, tells the
app it lives there (`SITE_URL` and `WEB_BASE_URL`, so canonical links, the
sitemap, the manifest and the links in e-mails are right), recreates `api` and
`web`, checks that `/en` really answers 200 through the tunnel, and prints the
address.

`bash scripts/public-preview.sh status` prints the current address.
`bash scripts/public-preview.sh stop` closes the tunnel and puts the app back on
localhost.

No Cloudflare account is needed — TryCloudflare exists precisely so that a
developer can do this without one. Nothing is installed on the host either: the
tunnel is a container (`cloudflare/cloudflared:2026.9.1`) behind the `preview`
profile in `docker-compose.yml`, so `docker compose up` never starts it by
accident. It reads the `web` container over the compose network, so no port is
published to the host and no router is touched.

### What works through it, and what does not

| | Through the tunnel |
|---|---|
| Every rendered page, both locales, the right-to-left layout | works |
| Sign-in, predictions, the admin area | works |
| Installing the progressive web app on a phone | works — this is the point |
| **Live scores updating by themselves** | **does not work** |
| Every page saying that its football is fixture data | on, and not optional |

Cloudflare says three things about quick tunnels, and the third is the one that
matters here: no uptime is guaranteed, concurrent requests are capped at 200,
and **server-sent events are not carried**. The live path (T-032, D-034) is SSE,
so through the tunnel the scores page shows its connecting and stale states
instead of updating. That is the page being honest rather than the page being
broken — it is exactly what rule 4 asks for — but it means the live path can
only be tested on localhost or on a real deployment.

### What it serves, and why it says so

The database behind this stack is the seed: invented matches, invented teams,
invented scores. On `localhost` that is obvious, because the person reading them
is the person who loaded them. Through the tunnel it is football on the public
internet, and the distance between those two is what rule 3 is about.

So the tunnel turns `DEMONSTRATION_DATA` on (T-087, D-065) and there is no way
to ask it not to. Every page then carries the band that says what the data is,
the titles are marked, the sitemap is empty and `robots.txt` forbids the whole
site. Setting the variable to anything else does not override it -- the script
stops and says so, the way `deploy/preview/start.mjs` refuses to seed a preview
that would serve its fixtures unmarked. A warning would have been the wrong
shape: by the time anybody read it the address would already be public.

The marker is then **checked on the page that was served**, not assumed from the
variable that was passed: `start` fetches `/robots.txt` through the tunnel and
fails unless it forbids the site. Between the variable and the page is a
container that may not have been recreated, and a guard that only reads its own
intention is a guard that reports success for doing nothing.

Stopping the tunnel puts the app back on localhost without the marker. On a
machine nobody else can reach, the band is noise, and noise is what teaches
everyone to read past a band that matters.

### When it cannot connect at all

On 2026-09-17 this stopped working from the maintainer's network, and the shape
of the failure is worth knowing because it looks like success. `cloudflared`
asks for a quick tunnel, Cloudflare hands back a name, and **cloudflared prints
that name before it has a connection to the edge**. It then retries forever:

```
ERR Failed to dial a quic connection error="timeout: no recent network activity"
WRN ... your machine/network is getting its egress UDP to port 7844 blocked
ERR Unable to establish connection with Cloudflare edge
    error="TLS handshake with edge error: ... 198.41.200.13:7844: i/o timeout"
```

Both transports were tried. The default is QUIC on **UDP 7844**; `--protocol
http2` is the same tunnel over TCP, and cloudflared dials **TCP 7844** for it,
not 443. This network drops both, so the address never resolves for anybody --
including the person who was just handed it.

`start` catches this, which is the only reason it is a footnote rather than an
afternoon: it fetches `/en` through the tunnel before printing anything, and
stops when that does not answer 200. An address that was printed and never
worked is exactly the kind of thing rule 4 is about.

There is no way around it from here -- the block is on the path to Cloudflare's
edge, not on anything this repository configures. Where a public address is
actually needed, the Render preview (`docs/11-preview.md`) is the venue: it is
already public, already HTTPS, and already marked as demonstration data.

The address also changes every time the tunnel restarts. For a session of
testing that is fine; for anything anybody is expected to come back to, it is
not.

---

## If a stable address is needed

Everything from here needs an account, and creating accounts is not something an
agent session does — so the options below were **not** signed up for or
measured. Each one says what to check and what to hand back.

Ranked for what FMIP actually needs: a container, a Postgres, HTTPS, and a
connection that survives server-sent events.

### 1. A container platform with its own subdomain

Koyeb (`*.koyeb.app`) and Render (`*.onrender.com`) both run a Docker image on a
free plan and give an HTTPS hostname with it. Unlike the quick tunnel these are
ordinary reverse proxies, so **server-sent events work**, which makes them the
first real option for testing the live path in public.

The free plans have real limits — a small amount of memory, and the service
sleeps when idle and takes a while to wake.

> **Settled, twice.** Koyeb was chosen first (D-051, 2026-09-13). It was
> acquired in February 2026 and withdrew its free Instance from new accounts, so
> the preview now runs on **Render** with a **Neon** database (D-064,
> 2026-09-15). The runbook is `docs/11-preview.md`. This section is kept as
> written because the comparison it makes is what the second choice was made
> from — and because it is a fair record of how quickly the terms under a free
> plan can move.

Worth knowing before choosing: the stack is five containers, and a free plan
that runs one service will not hold all of them. The realistic shape is the web
app and the API on the platform, Postgres on whatever managed free database the
platform offers, and the model service off — which means forecasts report
`unavailable`, honestly, the way they already do.

### 2. A free always-on virtual machine

Oracle Cloud's Always Free tier includes an ARM virtual machine large enough to
run the whole stack exactly as `docs/09-deploy.md` describes it — Caddy,
Cloudflare in front, the rollout script, all of it, with nothing changed. That
is by some distance the best free option, and the catch is the sign-up: it asks
for a card for identity verification, and the ARM capacity is often unavailable
in a given region.

If that account gets created, T-074's close-out can happen on it, and this whole
document stops being needed.

### 3. A free subdomain pointing at this machine

DuckDNS gives a free `*.duckdns.org` name pointing at any address you tell it,
and `nip.io` / `sslip.io` need no account at all: `203-0-113-9.nip.io` already
resolves to `203.0.113.9`, which was confirmed from this machine.

Both need a public IP with ports 80 and 443 reachable from outside, which a home
connection behind carrier-grade NAT does not have. Try it only if the router can
actually forward those ports. The quick tunnel exists to avoid exactly this
problem, and it is the better answer unless the address has to be stable.

### 4. A domain

There is no genuinely free top-level domain any more; the one that used to be
handed out is gone. Free *subdomains* are what the three options above give, and
that is the honest limit of "free" here. A real domain is cheap enough that it
is a decision about whether the project wants its own name, not a cost problem —
and it is yours to make, not mine.

---

## Which one for which job

| Job | Use |
|---|---|
| Look at the site on a phone | the quick tunnel |
| Install the PWA on Android (T-084) | the quick tunnel |
| Show someone a branch for ten minutes | the quick tunnel |
| Test the live scores stream in public | a container platform (option 1) |
| A link that still works tomorrow | option 1 or 2 |
| Close out T-074 | option 2, or a paid server |
