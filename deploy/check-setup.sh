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

# The deployment's public origin, written one way for the whole report: with
# the port whenever it is not 443. A rehearsal runs on 8443, and a line saying
# `https://localhost` would name an address nothing answers on. The same value
# is what the site probe below asks for, so the report cannot describe a
# request it did not make.
public_origin() {
  if [ -z "${SITE_HOST:-}" ]; then
    echo '<SITE_HOST not set in .env>'
  elif [ "${HTTPS_PORT:-443}" = '443' ]; then
    echo "https://${SITE_HOST}"
  else
    echo "https://${SITE_HOST}:${HTTPS_PORT}"
  fi
}

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
  echo "Site: $(public_origin)"
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
  # The address that was actually asked, port and all -- one value, so what is
  # printed here and in the header above cannot drift apart.
  site_url="$(public_origin)/en"
  code="$(curl -sk -m 15 -o /dev/null -w '%{http_code}' \
    "$site_url" 2>/dev/null || echo '000')"
  case "$code" in
    200) require 'Public site' 'ok' "$site_url answered 200" ;;
    000) require 'Public site' 'FAILED' "$site_url did not answer -- is Caddy up, and do the certificates match?" ;;
    *) require 'Public site' 'FAILED' "$site_url answered $code" ;;
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

# The compose file splices POSTGRES_PASSWORD into DATABASE_URL unencoded, and
# the connection-string parser refuses a password holding `/`, `?`, `#` or
# `%` -- "Invalid URL" from migrate, api and model alike, naming nothing in
# .env. `openssl rand -base64` produces a `/` about half the time. Read from
# .env itself, so it is said even when the API never came up to say anything.
if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  case "$POSTGRES_PASSWORD" in
    */* | *'?'* | *'#'* | *%*)
      require 'Database password' 'FAILED' "POSTGRES_PASSWORD holds / ? # or %, which breaks DATABASE_URL -- make one with: openssl rand -hex 32 (docs/09-deploy.md §2)"
      ;;
    *) require 'Database password' 'ok' ;;
  esac
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
  # A schedule that is on and a catalogue that is empty look identical from
  # the environment alone, and they are opposite states: the second fetches
  # nothing at all. A freshly migrated database holds no competition, so this
  # is what a first deployment reads until somebody adds one.
  mapped="$(value_of pollable_competitions)"
  seasons="$(value_of pollable_current_seasons)"
  provider="$(value_of pollable_provider)"
  if [ "$mapped" = 'unknown' ]; then
    row 'Match data' 'ON' "$source_name, schedule $schedule"
  elif [ -z "$provider" ]; then
    # The environment and the resolved source can disagree: a value the
    # resolver refused -- a missing key, a profile whose recordings are not in
    # this build -- leaves the switch reading `on` with nothing behind it.
    # Repeat the API's own reason rather than the two variables.
    row 'Match data' 'IDLE' "$source_name, schedule $schedule -- no provider serves the fixtures job"
    notes+=("Match data: $(value_of pollable_reason). The switch is on and nothing is behind it, so no fixture will be fetched until that is resolved (docs/14-maintainer.md §2).")
  elif [ "$mapped" = '0' ]; then
    row 'Match data' 'IDLE' "$source_name, schedule $schedule -- but nothing is mapped to poll"
    notes+=("Match data: the schedule is on and no competition is mapped to $provider, so the jobs ask for nothing and no fixture will ever appear. Add one on the server: docker compose run --rm migrate node scripts/catalog.mjs --add-competition ... then --add-season --current (docs/14-maintainer.md §2).")
  elif [ "$seasons" = '0' ]; then
    row 'Match data' 'IDLE' "$source_name, schedule $schedule -- $mapped mapped, none with a current season"
    notes+=('Match data: every mapped competition is without a current season, so the jobs poll nothing. Add one with `node scripts/catalog.mjs --add-season --current` (docs/14-maintainer.md §2).')
  else
    row 'Match data' 'ON' "$source_name, schedule $schedule, $seasons of $mapped competition(s) in season"
  fi
else
  row 'Match data' 'off' 'no fixture, score or table is being fetched'
  if [ "$(value_of env_API_FOOTBALL_KEY)" = 'set' ] || [ "$(value_of env_FOOTBALL_DATA_ORG_KEY)" = 'set' ] ||
    [ "$(value_of env_HIGHLIGHTLY_KEY)" = 'set' ]; then
    notes+=("Match data: a provider key is filled in but INGESTION_SOURCE='$source_name' and INGESTION_SCHEDULE='$schedule'. Name the source and give it a schedule, then restart the API.")
  else
    notes+=('Match data: this waits on the purchase in docs/14-maintainer.md §2 (T-100). Until then the product shows the coverage state rather than an empty page.')
  fi
fi

# Backups. `07-backups.md` opens with "a database without a backup is not in
# production", and nothing above this line would notice their absence: every
# container is healthy on a deployment that has never written a dump. Read from
# the directory the scripts write to rather than from a switch, because a timer
# that is installed and failing looks exactly like one that is working.
backup_dir="${BACKUP_DIR:-./backups}"
newest_dump=''
if [ -d "$backup_dir" ]; then
  newest_dump="$(ls -t "$backup_dir"/fmip-*.dump 2>/dev/null | head -1 || true)"
fi
if [ -z "$newest_dump" ]; then
  row 'Backups' 'off' "no dump in $backup_dir -- nothing has been backed up here"
  notes+=("Backups: nothing has ever been backed up. Install scripts/backup/fmip-backup.timer and point BACKUP_RCLONE_REMOTE at a bucket at another company (docs/07-backups.md).")
else
  dump_age_h=$((($(date -u +%s) - $(date -r "$newest_dump" +%s)) / 3600))
  if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
    copies="off-site copy to ${BACKUP_RCLONE_REMOTE}"
  else
    copies='local only'
  fi
  # The timer runs daily, so one missed run is still inside 48 hours; past that
  # something is wrong rather than merely late.
  if [ "$dump_age_h" -gt 48 ]; then
    row 'Backups' 'STALE' "newest dump is ${dump_age_h}h old, $copies"
    notes+=("Backups: the newest dump is ${dump_age_h} hours old and the timer runs daily. Look at it: systemctl status fmip-backup.timer, then journalctl -u fmip-backup (docs/07-backups.md).")
  else
    row 'Backups' 'ON' "newest dump ${dump_age_h}h old, $copies"
  fi
  if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
    notes+=('Backups: local only. A copy on the machine it is a backup of does not survive losing that machine -- set BACKUP_RCLONE_REMOTE (docs/07-backups.md).')
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
