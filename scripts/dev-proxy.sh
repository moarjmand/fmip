#!/usr/bin/env bash
# Runs a small forward proxy in Docker so that tooling on the development host
# can reach registries the host itself cannot.
#
# Background: from the maintainer's Windows host, registry.npmjs.org times out
# at the TCP level, while the same request from inside a container succeeds
# (docs/06-session-handoff.md, constraint 2). Docker Desktop's network path is
# therefore the working one, and this proxy lends it to the host: squid listens
# in a container, Docker publishes it on 127.0.0.1:3128, and pnpm, Corepack,
# curl or Playwright on the host go through it.
#
#     bash scripts/dev-proxy.sh          # start (or restart) the proxy
#     bash scripts/dev-proxy.sh stop     # remove it
#     bash scripts/dev-proxy.sh status   # is it up, and can it reach npm?
#
# Then, once per machine, route pnpm through it in the *user* npmrc (not the
# repository's .npmrc, which every machine shares):
#
#     printf 'proxy=http://127.0.0.1:3128\nhttps-proxy=http://127.0.0.1:3128\n' >> ~/.npmrc
#
# The container restarts with Docker, so after the first run it is simply there.
# The proxy is bound to loopback and only tunnels ports 80 and 443; it is not a
# general egress point and stores nothing.

set -euo pipefail

cd "$(dirname "$0")/.."

NAME=fmip-dev-proxy
PORT="${FMIP_DEV_PROXY_PORT:-3128}"
IMAGE=ubuntu/squid:latest
CONF="$(pwd)/scripts/dev-proxy/squid.conf"

case "${1:-start}" in
  start)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # MSYS_NO_PATHCONV: Git Bash would otherwise rewrite the container-side
    # path /etc/squid/squid.conf into a Windows path.
    MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" --restart unless-stopped \
      -p "127.0.0.1:${PORT}:3128" \
      -v "${CONF}:/etc/squid/squid.conf:ro" \
      "$IMAGE" >/dev/null
    echo "proxy: started $NAME on 127.0.0.1:${PORT}"
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "proxy: removed $NAME" || echo "proxy: not running"
    ;;
  status)
    if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
      echo "proxy: $NAME is not running" >&2
      exit 1
    fi
    # A HEAD request: the point is reachability, not the packument, and this
    # link can take a minute over a few megabytes. The headers go to a temp
    # file rather than /dev/null, which Git Bash rewrites for a native curl.exe.
    headers="$(mktemp)"
    curl -m 30 -sS -I -x "http://127.0.0.1:${PORT}" -o "$headers" \
      -w "proxy: up; registry.npmjs.org answered HTTP %{http_code} in %{time_total}s\n" \
      https://registry.npmjs.org/pnpm
    rm -f "$headers"
    ;;
  *)
    echo "usage: bash scripts/dev-proxy.sh [start|stop|status]" >&2
    exit 2
    ;;
esac
