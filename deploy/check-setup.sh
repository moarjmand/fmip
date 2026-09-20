#!/usr/bin/env bash
# One command that says what this deployment can and cannot do (T-075).
#
#     bash deploy/check-setup.sh
#
# On the VPS, from /opt/fmip. It asks the running stack rather than reading
# files: which containers are healthy, whether the public site answers through
# Caddy, and -- from the API's own health endpoints -- whether e-mail, push, a
# language model and match-data ingestion are on.
#
# Against an API you can already reach (a laptop running `node apps/api/dist/
# main.js`, or a tunnel), skip Docker entirely:
#
#     SETUP_CHECK_API=http://localhost:3001 bash deploy/check-setup.sh
#
# What it is for. Everything optional below is off on a new deployment and the
# product says so on the surface rather than pretending (rule 3). That is the
# designed state, so `off` is never a failure here -- the exit code is about
# the required half only. What this catches is the other thing: a credential
# filled in and its switch forgotten, which from outside looks exactly like
# having done nothing.
#
# It prints no secret. Every key, password and connection string is reported
# as `set` or `empty`, so the output can be pasted to whoever is helping.
#
# Exit 0: everything required is healthy. Exit 1: something required is not.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < ./.env)
  set +a
fi

REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT

failures=0
notes=()

# `label ...... STATE  detail`, so a column of states can be read at a glance.
row() {
  local label="$1" state="$2" detail="${3:-}" pad=''
  if [ "${#label}" -lt 30 ]; then
    pad="$(printf '%*s' "$((30 - ${#label}))" '' | tr ' ' '.')"
  fi
  printf '  %s%s %-7s %s\n' "$label" "$pad" "$state" "$detail"
}

require() { # label, state, detail -- anything but `ok` fails the run
  row "$1" "$2" "${3:-}"
  [ "$2" = 'ok' ] || failures=$((failures + 1))
}

value_of() { sed -n "s/^$1=//p" "$REPORT" | head -1; }

# A container's health, or its plain state when the image declares no check.
container_state() {
  local id
  id="$(docker compose ps -q "$1" 2>/dev/null | head -1)"
  if [ -z "$id" ]; then
    echo 'missing'
    return
  fi
  docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null ||
    echo 'unknown'
}

echo
echo "FMIP setup check -- $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ---------------------------------------------------------------------------
# The report from inside the API.

if [ -n "${SETUP_CHECK_API:-}" ]; then
  echo "API: ${SETUP_CHECK_API}"
  SELF_BASE_URL="$SETUP_CHECK_API" node deploy/report-capabilities.mjs >"$REPORT" 2>/dev/null ||
    echo 'api=unreachable' >"$REPORT"
else
  echo "Site: https://${SITE_HOST:-<SITE_HOST not set in .env>}"
  docker compose exec -T api node - <deploy/report-capabilities.mjs >"$REPORT" 2>/dev/null ||
    echo 'api=unreachable' >"$REPORT"
fi

# ---------------------------------------------------------------------------
# Required: the deployment itself.

echo
echo 'Required'

if [ -z "${SETUP_CHECK_API:-}" ]; then
  if ! docker compose version >/dev/null 2>&1; then
    require 'Docker' 'MISSING' 'Docker Compose is not installed or not running here.'
  else
    for service in postgres redis model api web caddy; do
      state="$(container_state "$service")"
      case "$service:$state" in
        *:healthy) require "$service" 'ok' ;;
        # Every service in the production file declares a health check; a bare
        # `running` means an image that stopped declaring one, which is worth
        # saying rather than silently accepting as healthy.
        *:running) require "$service" 'ok' 'running, but reporting no health' ;;
        *:missing) require "$service" 'MISSING' 'not created -- run: docker compose up -d' ;;
        *) require "$service" 'FAILED' "$state -- run: docker compose logs --tail=50 $service" ;;
      esac
    done
  fi
fi

api_state="$(value_of api)"
if [ "$api_state" = 'ok' ]; then
  require 'API answers' 'ok' "up $(value_of api_uptime_seconds)s"
else
  require 'API answers' 'FAILED' 'the health endpoint did not answer'
fi

if [ -z "${SETUP_CHECK_API:-}" ] && [ -n "${SITE_HOST:-}" ]; then
  code="$(curl -sk -m 15 -o /dev/null -w '%{http_code}' \
    "https://${SITE_HOST}:${HTTPS_PORT:-443}/en" 2>/dev/null || echo '000')"
  case "$code" in
    200) require 'Public site' 'ok' "https://${SITE_HOST}/en answered 200" ;;
    000) require 'Public site' 'FAILED' 'no answer -- is Caddy up, and do the certificates match?' ;;
    *) require 'Public site' 'FAILED' "answered $code" ;;
  esac
fi

bus="$(value_of chat_bus)"
case "$bus" in
  connected) require 'Chat bus' 'ok' ;;
  '' | unknown) row 'Chat bus' 'unknown' 'the API did not answer' ;;
  *) require 'Chat bus' 'FAILED' "$bus -- chat messages will not arrive live" ;;
esac

if [ "$(value_of env_SESSION_SECRET)" = 'set' ]; then
  require 'Session secret' 'ok'
elif [ "$api_state" = 'ok' ]; then
  require 'Session secret' 'FAILED' 'SESSION_SECRET is empty -- nobody can stay signed in'
fi

# ---------------------------------------------------------------------------
# Optional: each one off until someone turns it on, and the product says so.

echo
echo 'Optional -- off is a designed state, not a fault'

email="$(value_of email)"
if [ "$email" = 'configured' ]; then
  row 'E-mail' 'ON' "$(value_of email_provider)"
else
  row 'E-mail' 'off' 'nothing is e-mailed, including sign-up verification'
  if [ "$(value_of env_SMTP_URL)" = 'set' ]; then
    notes+=("E-mail: SMTP_URL is filled in but DELIVERY_EMAIL_PROVIDER is '$(value_of delivery_email_provider)'. Set it to smtp and restart the API.")
  else
    notes+=('E-mail: set SMTP_URL, DELIVERY_EMAIL_FROM and DELIVERY_EMAIL_PROVIDER=smtp in .env, then restart the API (docs/14-maintainer.md, T-330).')
  fi
  if [ "$(value_of env_DELIVERY_EMAIL_FROM)" = 'empty' ] && [ "$(value_of env_SMTP_URL)" = 'set' ]; then
    notes+=('E-mail: DELIVERY_EMAIL_FROM is empty. It is the visible sender, e.g. FMIP <no-reply@your-domain>.')
  fi
fi

push="$(value_of push)"
if [ "$push" = 'configured' ]; then
  row 'Push' 'ON' "$(value_of push_provider)"
else
  row 'Push' 'off' 'the toggle in Settings stays unavailable'
  if [ "$(value_of env_VAPID_PUBLIC_KEY)" = 'set' ] || [ "$(value_of env_VAPID_PRIVATE_KEY)" = 'set' ]; then
    notes+=("Push: VAPID keys are filled in but DELIVERY_PUSH_PROVIDER is '$(value_of delivery_push_provider)'. Set it to webpush and restart the API.")
  else
    notes+=('Push: generate the pair once with `docker compose run --rm --no-deps api npx web-push generate-vapid-keys`, put them in .env as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY with VAPID_SUBJECT=mailto:you@your-domain and DELIVERY_PUSH_PROVIDER=webpush.')
  fi
fi

model_state="$(value_of language_model)"
if [ "$model_state" = 'configured' ]; then
  row 'Language model' 'ON' "$(value_of language_model_provider) / $(value_of language_model_name)"
else
  row 'Language model' 'off' 'every Phase 5 surface says so in a sentence'
  if [ "$(value_of env_ANTHROPIC_API_KEY)" = 'set' ] || [ "$(value_of env_MISTRAL_API_KEY)" = 'set' ] ||
    [ "$(value_of env_INTELLIGENCE_API_KEY)" = 'set' ]; then
    notes+=("Language model: a key is filled in but INTELLIGENCE_PROVIDER is '$(value_of intelligence_provider)'. Set it to the provider whose key you filled in (anthropic, mistral or openai_compatible) and restart the API.")
  else
    notes+=('Language model: set INTELLIGENCE_PROVIDER and that provider key in .env, then restart the API (docs/14-maintainer.md §9).')
  fi
fi

schedule="$(value_of ingestion_schedule)"
source_name="$(value_of ingestion_source)"
if [ -n "$source_name" ] && [ -n "$schedule" ] && [ "$schedule" != 'off' ]; then
  row 'Match data' 'ON' "$source_name, schedule $schedule"
else
  row 'Match data' 'off' 'no fixture, score or table is being fetched'
  if [ "$(value_of env_API_FOOTBALL_KEY)" = 'set' ] || [ "$(value_of env_FOOTBALL_DATA_ORG_KEY)" = 'set' ] ||
    [ "$(value_of env_HIGHLIGHTLY_KEY)" = 'set' ]; then
    notes+=("Match data: a provider key is filled in but INGESTION_SOURCE='$source_name' and INGESTION_SCHEDULE='$schedule'. Name the source and give it a schedule, then restart the API.")
  else
    notes+=('Match data: this waits on the purchase in docs/14-maintainer.md §2 (T-100). Until then the product shows the coverage state rather than an empty page.')
  fi
fi

if [ "$(value_of demonstration_data)" = 'on' ]; then
  row 'Demonstration data' 'ON' 'seeded fixtures are labelled as such -- turn off on a real deployment'
fi

# ---------------------------------------------------------------------------

if [ "${#notes[@]}" -gt 0 ]; then
  echo
  echo 'To turn the off ones on'
  for note in "${notes[@]}"; do
    printf '  - %s\n' "$note"
  done
fi

echo
if [ "$failures" -eq 0 ]; then
  echo 'PASS -- everything required is healthy.'
else
  echo "FAIL -- $failures required check(s) did not pass; the lines marked above say what to run." >&2
  exit 1
fi
