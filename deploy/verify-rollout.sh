#!/usr/bin/env bash
# Proves a rollout is zero-downtime (T-074's acceptance criterion) by hitting
# the site through Caddy every 200 ms while `rollout.sh` replaces the running
# containers, then counting every answer that was not 200.
#
#     bash deploy/verify-rollout.sh              # rolls api and web (no rebuild)
#     bash deploy/verify-rollout.sh web          # rolls what you name
#     BUILD=1 bash deploy/verify-rollout.sh      # full rollout.sh: build, migrate, roll
#
# On a laptop: SITE_HOST=localhost, HTTPS_PORT=8443 in .env; a self-signed
# certificate is generated into deploy/certs/ when none is there. On the VPS:
# the real host name, the Cloudflare origin certificate, and run it from the
# server itself (Cloudflare is not between you and Caddy).
#
# Exit code 0 means every probe answered 200. Anything else is a failed
# rollout, with the offending status codes and the longest gap printed.

set -euo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < ./.env)
set +a

: "${SITE_HOST:?SITE_HOST must be set in .env}"
PORT="${HTTPS_PORT:-443}"
URL="${PROBE_URL:-https://${SITE_HOST}:${PORT}/en}"
INTERVAL="${PROBE_INTERVAL:-0.2}"

if [ ! -f deploy/certs/origin.pem ] || [ ! -f deploy/certs/origin.key ]; then
  if [ "$SITE_HOST" = 'localhost' ]; then
    echo "==> No certificate in deploy/certs/; generating a self-signed one for localhost"
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=localhost' \
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
      -keyout deploy/certs/origin.key -out deploy/certs/origin.pem 2>/dev/null
  else
    echo "ERROR: deploy/certs/origin.pem and origin.key are missing (docs/09-deploy.md, step 4)." >&2
    exit 1
  fi
fi

echo "==> Making sure the stack is up"
docker compose up -d --wait

echo "==> Baseline: $URL"
code="$(curl -sk -o /dev/null -w '%{http_code}' "$URL")"
if [ "$code" != '200' ]; then
  echo "ERROR: the site answers $code before the rollout; fix that first." >&2
  exit 1
fi

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

probe() {
  while :; do
    # Timestamp (ms), status code (000 = no answer), total time.
    printf '%s %s\n' "$(date +%s%3N)" \
      "$(curl -sk -o /dev/null -m 15 -w '%{http_code} %{time_total}' "$URL" || echo '000 -')"
    sleep "$INTERVAL"
  done
}

echo "==> Probing every ${INTERVAL}s while the rollout runs"
probe >>"$LOG" &
PROBE_PID=$!

set +e
if [ -n "${BUILD:-}" ]; then
  bash deploy/rollout.sh
elif [ "$#" -eq 0 ]; then
  bash deploy/rollout.sh api web
else
  bash deploy/rollout.sh "$@"
fi
ROLLOUT_STATUS=$?
set -e

# A few more seconds of probing after the switch, then stop.
sleep 3
kill "$PROBE_PID" 2>/dev/null || true
wait "$PROBE_PID" 2>/dev/null || true

total="$(wc -l <"$LOG" | tr -d ' ')"
ok="$(awk '$2 == 200' "$LOG" | wc -l | tr -d ' ')"
bad="$((total - ok))"
slowest="$(awk '$3 != "-" { if ($3 > m) m = $3 } END { printf "%.3f", m }' "$LOG")"
gap="$(awk 'NR > 1 { d = $1 - p; if (d > m) m = d } { p = $1 } END { print m + 0 }' "$LOG")"

echo
echo "==> Rollout verification"
echo "    probes:        $total"
echo "    answered 200:  $ok"
echo "    not 200:       $bad"
echo "    slowest (s):   $slowest"
echo "    longest gap between probes (ms): $gap"
if [ "$bad" -gt 0 ]; then
  echo "    offending answers:"
  awk '$2 != 200 { print "      " $0 }' "$LOG"
fi

if [ "$ROLLOUT_STATUS" -ne 0 ]; then
  echo "FAIL: rollout.sh exited with $ROLLOUT_STATUS" >&2
  exit 1
fi
if [ "$bad" -gt 0 ]; then
  echo "FAIL: $bad probe(s) did not get 200 — the rollout was not zero-downtime." >&2
  exit 1
fi
echo "PASS: zero-downtime rollout — $total probes, all 200."
