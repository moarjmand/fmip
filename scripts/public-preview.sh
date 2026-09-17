#!/usr/bin/env bash
# A public HTTPS address for the development stack, with no domain, no account
# and no port forward (T-085, D-050).
#
#   bash scripts/public-preview.sh start    # stack + tunnel, prints the URL
#   bash scripts/public-preview.sh status   # the current URL, if one is up
#   bash scripts/public-preview.sh stop     # tunnel down, stack left running
#
# How it works. `docker compose --profile preview up tunnel` runs cloudflared
# against the `web` container; cloudflared asks Cloudflare for a random
# `*.trycloudflare.com` name and prints it. That name is only known after the
# tunnel is up, and the pages have to name it for themselves — canonical links,
# the sitemap, the manifest, the links in e-mails — so `web` and `api` are
# recreated with SITE_URL and WEB_BASE_URL pointing at it.
#
# What this is for: looking at the site from a phone, installing the PWA (which
# needs real HTTPS), showing someone a branch. It is not hosting. Cloudflare
# guarantees no uptime, caps concurrent requests at 200, and does not carry
# server-sent events, so the live scores stream will not update through it —
# the page's "connecting" and "stale" states are what a viewer sees. The rest
# of the site is served normally. See `docs/10-public-preview.md`.

set -euo pipefail

cd "$(dirname "$0")/.."

readonly SERVICE='tunnel'
# A public address turns seeded fixtures into football somebody can believe, so
# the tunnel serves them marked (T-087, D-065) and there is no way to ask it not
# to. See `require_demonstration_data`.
readonly DEMONSTRATION='on'
readonly PATTERN='https://[a-z0-9-]*\.trycloudflare\.com'
readonly WAIT_SECONDS=60

fail() {
  echo "error: $*" >&2
  exit 1
}

compose() {
  docker compose --profile preview "$@"
}

# The address in the tunnel's own log, or empty while it has not said one.
current_url() {
  compose logs "$SERVICE" 2>/dev/null | grep -o "$PATTERN" | tail -n 1 || true
}

# The one thing this script will not do on request.
#
# The database behind this stack holds seeded fixtures: invented matches, teams
# and scores, which on localhost are obviously invented because the person
# looking at them put them there. Through the tunnel they are football on the
# public internet, and rule 3 is about exactly that distance.
#
# So `DEMONSTRATION_DATA=on` is not a default that an environment can override,
# it is a condition of going public: every page then carries the band that says
# what the data is, the titles are marked, the sitemap is empty and robots.txt
# forbids the site. An operator who has set the variable to something else is
# asking for the opposite, and gets told no rather than quietly overruled --
# `deploy/preview/start.mjs` refuses the same way, for the same reason.
require_demonstration_data() {
  local given="${DEMONSTRATION_DATA:-}"
  [ -z "$given" ] || [ "$given" = "$DEMONSTRATION" ] || fail \
    "DEMONSTRATION_DATA is '$given'. This puts seeded fixture data on a public
       address, so it is served marked or not at all. Unset the variable, or set
       it to '$DEMONSTRATION'. See docs/10-public-preview.md."
}

start() {
  command -v docker >/dev/null 2>&1 || fail 'docker is not on PATH'
  require_demonstration_data

  echo 'starting the stack (this builds on a first run)'
  DEMONSTRATION_DATA="$DEMONSTRATION" docker compose up -d --wait postgres redis model api web

  echo 'opening a Cloudflare quick tunnel'
  compose up -d --force-recreate "$SERVICE"

  local url=''
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    url="$(current_url)"
    [ -n "$url" ] && break
    sleep 1
  done
  [ -n "$url" ] || {
    compose logs --tail 30 "$SERVICE" >&2
    fail 'the tunnel did not report an address in time'
  }

  # The pages have to know the name they are served under, and only now is it
  # known. Recreating api and web is a few seconds; nothing else is touched.
  echo "telling the app it lives at $url"
  SITE_URL="$url" WEB_BASE_URL="$url" DEMONSTRATION_DATA="$DEMONSTRATION" \
    docker compose up -d --wait --force-recreate api web

  verify "$url"
}

verify() {
  local url="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url/en" || echo 000)"
  if [ "$code" != '200' ]; then
    fail "the tunnel answered $code for $url/en; run 'docker compose --profile preview logs tunnel'"
  fi

  # The marker is checked on the served page, not assumed from the variable we
  # passed: between the two is a container that may not have been recreated, and
  # a guard that only reads its own intention guards nothing. `robots.txt` is
  # the cheapest place it shows, and it is the one that decides whether invented
  # football gets indexed.
  if ! curl -s --max-time 30 "$url/robots.txt" | grep -q '^Disallow: /$'; then
    fail "served without the demonstration marker: $url/robots.txt does not
       forbid the site, so these fixtures are indexable. Stop the tunnel with
       'bash scripts/public-preview.sh stop'."
  fi

  echo
  echo "  public address: $url"
  echo "  the app:        $url/en   (and /fa for the right-to-left locale)"
  echo
  echo '  Live scores will not update through this tunnel: Cloudflare quick'
  echo '  tunnels do not carry server-sent events, so the scores page shows its'
  echo '  connecting and stale states. Everything else is the real site.'
  echo
  echo '  Every page says that its football is development fixture data, the'
  echo '  titles are marked, the sitemap is empty and robots.txt forbids the'
  echo '  site. That is not decoration: it is the condition of being public.'
  echo
  echo '  The address changes every time the tunnel restarts.'
  echo "  Stop it with: bash scripts/public-preview.sh stop"
}

status() {
  local url
  url="$(current_url)"
  if [ -z "$url" ]; then
    echo 'no tunnel is running'
    return 1
  fi
  echo "$url"
}

stop() {
  compose rm -sf "$SERVICE" >/dev/null 2>&1 || true
  # Recreated with no DEMONSTRATION_DATA: back on localhost the band is noise,
  # and leaving it on would teach everyone to read past it.
  echo 'tunnel stopped; putting the app back on localhost'
  docker compose up -d --wait --force-recreate api web
}

case "${1:-start}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  *) fail "unknown command '$1'; use start, status or stop" ;;
esac
