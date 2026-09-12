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

start() {
  command -v docker >/dev/null 2>&1 || fail 'docker is not on PATH'

  echo 'starting the stack (this builds on a first run)'
  docker compose up -d --wait postgres redis model api web

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
  SITE_URL="$url" WEB_BASE_URL="$url" docker compose up -d --wait --force-recreate api web

  verify "$url"
}

verify() {
  local url="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url/en" || echo 000)"
  if [ "$code" != '200' ]; then
    fail "the tunnel answered $code for $url/en; run 'docker compose --profile preview logs tunnel'"
  fi

  echo
  echo "  public address: $url"
  echo "  the app:        $url/en   (and /fa for the right-to-left locale)"
  echo
  echo '  Live scores will not update through this tunnel: Cloudflare quick'
  echo '  tunnels do not carry server-sent events, so the scores page shows its'
  echo '  connecting and stale states. Everything else is the real site.'
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
  echo 'tunnel stopped; putting the app back on localhost'
  docker compose up -d --wait --force-recreate api web
}

case "${1:-start}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  *) fail "unknown command '$1'; use start, status or stop" ;;
esac
