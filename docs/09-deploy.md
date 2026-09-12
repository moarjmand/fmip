# Production deployment

The runbook for T-074 (decision D-048): one VPS running the compose stack in
`deploy/docker-compose.prod.yml`, Caddy as the origin behind Cloudflare, and a
redeploy that replaces containers without dropping a request. Every step is a
command to copy; the few that need a browser say so. Read `07-backups.md` right
after the first deploy — a database without a backup is not in production.

## What is where

```
browser ──HTTPS──▶ Cloudflare (edge TLS, cache, WAF)
                      │ HTTPS, origin certificate, SSL mode "Full (strict)"
                      ▼
                   caddy :443 (:80 redirects)          deploy/Caddyfile
                      │ http, Docker DNS "web", refreshed every second
                      ▼
                   web :3000  ──http──▶ api :3001 ──▶ postgres, redis, model
                   (Next.js; proxies /api/*/stream)   (none published; postgres
                                                       and redis on 127.0.0.1)
```

- The browser only ever talks to `web`. The API is not on the network; the
  two server-sent-event streams reach the browser through the web app's
  `/api/scores/stream` and `/api/fixtures/:id/stream` routes.
- `postgres` and `redis` keep their `127.0.0.1` ports so `scripts/backup/`,
  `psql` and an SSH tunnel work exactly as in development.
- `migrate` (`packages/db/Dockerfile`) is a tool image: `docker compose run
  --rm migrate`. Nothing on the VPS needs Node or pnpm.
- `.env` at the checkout root holds everything, including
  `COMPOSE_FILE=deploy/docker-compose.prod.yml`, so a plain `docker compose`
  on the server means the production stack — the backup scripts rely on
  that.

## What you need before starting

| Item | Minimum | Why |
|---|---|---|
| VPS | Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB SSD | The images are built on the server; the web build wants ~2 GB free. 1,000 stream clients cost the API 189 MB (`08-load-test.md`). |
| Domain | any, nameservers moved to Cloudflare (Free plan) | Edge TLS, caching, the origin certificate |
| Cloudflare | account with the zone active | DNS, SSL/TLS, origin certificate |
| Backup bucket | see `07-backups.md` | Off-provider copies |

Nothing else. No registry, no CI deploy key: the server pulls the repository
and builds.

## 1. Prepare the server (once, ~10 minutes)

As root on a fresh Ubuntu 24.04:

```bash
apt-get update && apt-get -y upgrade
adduser --disabled-password --gecos '' fmip && usermod -aG sudo fmip
mkdir -p /home/fmip/.ssh && cp /root/.ssh/authorized_keys /home/fmip/.ssh/ && chown -R fmip:fmip /home/fmip/.ssh
# Docker Engine + Compose plugin, from Docker's repository
curl -fsSL https://get.docker.com | sh
usermod -aG docker fmip
systemctl enable --now docker
# 2 GB of swap: the Next.js build spikes above 4 GB otherwise
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Firewall: SSH, HTTP, HTTPS only
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
# Unattended security updates
apt-get -y install unattended-upgrades && dpkg-reconfigure -f noninteractive unattended-upgrades
```

Log in again as `fmip` for everything below.

## 2. Check out and configure

```bash
sudo mkdir -p /opt/fmip && sudo chown fmip:fmip /opt/fmip
git clone https://github.com/moarjmand/fmip.git /opt/fmip
cd /opt/fmip
cp .env.example .env
```

Edit `.env` (`nano .env`). Set these and leave the rest at their defaults:

| Variable | Value |
|---|---|
| `COMPOSE_FILE` | `deploy/docker-compose.prod.yml` — uncomment it |
| `SITE_HOST` | the public host name, e.g. `fmip.example` |
| `NODE_ENV` | `production` |
| `POSTGRES_PASSWORD` | output of `openssl rand -base64 36` |
| `SESSION_SECRET` | output of `openssl rand -base64 48` (a different one) |
| `API_FOOTBALL_KEY` etc. | the provider key(s) once T-025 is decided; empty until then |
| `BACKUP_RCLONE_REMOTE` | per `07-backups.md` |

`SITE_URL` and `WEB_BASE_URL` are derived from `SITE_HOST` by the compose
file; do not set them. `HTTP_PORT`/`HTTPS_PORT` stay at 80/443.

Then check the file parses and points at the production stack:

```bash
docker compose config --services
```

The list must include `caddy`. If it does not, `COMPOSE_FILE` is not set.

## 3. Cloudflare DNS (browser)

Cloudflare dashboard → the zone → DNS → Records:

- `A` record, name `@` (or the sub-domain you chose), content = the VPS
  IPv4, **Proxied** (orange cloud).
- If you want `www`, a `CNAME www → fmip.example`, proxied.

SSL/TLS → Overview: mode **Full (strict)**.
SSL/TLS → Edge Certificates: **Always Use HTTPS** on, **Automatic HTTPS
Rewrites** on, Minimum TLS 1.2. Speed → Optimization: leave **Rocket Loader
off** (it rewrites scripts and breaks the service worker registration).

## 4. Origin certificate (browser, then server)

SSL/TLS → Origin Server → **Create Certificate**: RSA (2048), host names
`fmip.example` and `*.fmip.example`, validity 15 years. Two text boxes
appear; copy each into a file on the server:

```bash
mkdir -p /opt/fmip/deploy/certs
nano /opt/fmip/deploy/certs/origin.pem   # paste "Origin Certificate"
nano /opt/fmip/deploy/certs/origin.key   # paste "Private Key"
chmod 600 /opt/fmip/deploy/certs/origin.key
```

Both files are git-ignored. Note the expiry in your calendar; renewal is the
same two pastes and `docker compose restart caddy`.

## 5. First start

```bash
cd /opt/fmip
docker compose --profile tools build        # 10–20 minutes on a 2 vCPU VPS
docker compose run --rm migrate             # creates every table
docker compose up -d --wait                 # postgres, redis, model, api, web, caddy
docker compose ps
```

Every service must say `healthy`. Then, from your laptop:

```bash
curl -sI https://fmip.example/en | head -1          # HTTP/2 200
curl -s https://fmip.example/robots.txt              # names the sitemap
curl -sN https://fmip.example/api/scores/stream --max-time 20 | head -5   # a snapshot, then a heartbeat
```

On the server, the API's own health (not public):

```bash
docker compose exec api node -e "fetch('http://127.0.0.1:3001/health/ingestion').then(r=>r.text()).then(console.log)"
```

Two more things, both from other runbooks:

- **Backups**: `07-backups.md`, install `fmip-backup.timer`, then run one
  backup and one restore drill by hand.
- **Load test**: rerun the T-073 tool on the server before announcing the
  site. It runs inside the API image, so nothing is installed on the host,
  and it reaches the API by its compose name (the stream is timed without
  Cloudflare in the way, which is the point):

  ```bash
  docker compose run --rm --no-deps -v /opt/fmip/apps/api/scripts:/app/scripts:ro api \
    node scripts/load-sse.mjs --url http://api:3001 --clients 1000 --seconds 60
  ```

  Record the result in `08-load-test.md`. If the VPS misses the threshold,
  the doc says what to change first.

## 6. Redeploy (every release)

```bash
cd /opt/fmip
git pull --ff-only
bash deploy/rollout.sh
```

`rollout.sh` builds the images, migrates the database, then for `model`,
`api` and `web` in turn starts one new container beside the old one, waits
for its healthcheck, stops the old one with 30 s of grace and removes it.
Caddy resolves `web` through Docker's DNS every second and retries a failed
dial against the other container, so browsers never see the switch; open SSE
streams reconnect and get a fresh snapshot (D-034). A new container that
never becomes healthy is removed and the old one keeps serving; the script
exits non-zero and prints the new container's log.

**Rule for migrations:** they run before the new code and while the old code
is still serving, so each release's migrations must work with the previous
release: add columns and tables freely, remove or rename only in a later
release after nothing reads the old name.

To prove a rollout dropped nothing — do this once after the first deploy and
whenever the edge or the rollout script changes:

```bash
bash deploy/verify-rollout.sh
```

It probes `https://$SITE_HOST/en` every 200 ms while rolling `api` and
`web`, then prints how many probes did not get 200. Zero is the acceptance
criterion of T-074.

## 7. Day-to-day

| Need | Command |
|---|---|
| Logs (JSON lines, D-044) | `docker compose logs -f --tail 200 api` |
| Edge logs | `docker compose logs -f caddy` |
| A shell in Postgres | `docker compose exec postgres psql -U fmip -d fmip` |
| Restart one service without a rollout | `docker compose restart web` |
| Free disk after many builds | `docker image prune -f` |
| Renewed origin certificate | paste, then `docker compose restart caddy` |

Reboots are safe: every service has `restart: unless-stopped` and Docker is
enabled at boot.

## Rehearsal on a laptop

The same files run on a developer machine; this is how the zero-downtime
claim was verified before there was a VPS (record below). With Docker
Desktop running and the development `.env` set aside:

```bash
cp .env .env.dev-backup
{ grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|SESSION_SECRET)=' .env.dev-backup
  printf '%s\n' COMPOSE_FILE=deploy/docker-compose.prod.yml COMPOSE_PROJECT_NAME=fmip-rehearsal \
    SITE_HOST=localhost HTTPS_PORT=8443 HTTP_PORT=8080 POSTGRES_PORT=55432 REDIS_PORT=56379; } > .env
docker compose --profile tools build
docker compose run --rm migrate
docker compose up -d --wait
bash deploy/verify-rollout.sh          # generates a self-signed localhost certificate
docker compose down -v                 # afterwards
mv .env.dev-backup .env
```

`COMPOSE_PROJECT_NAME` keeps the rehearsal apart from the development stack
(`fmip`), and the shifted ports keep both up at once.

## Record

| Date | Where | Result |
|---|---|---|
| 2026-09-12 | Maintainer's laptop, rehearsal as above | see the T-074 note in `04-tasks-phase-1.md` |
