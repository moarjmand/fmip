#!/usr/bin/env bash
# Zero-downtime redeploy of the production stack (T-074, D-048).
#
#     bash deploy/rollout.sh              # build, migrate, roll model → api → web
#     bash deploy/rollout.sh web          # roll one service only (no build/migrate)
#     NO_BUILD=1 bash deploy/rollout.sh   # skip the image build (already built)
#
# How a service is rolled: a second container is started from the new image
# next to the running one (`--scale 2 --no-recreate`); when its healthcheck
# reports healthy, the old container gets SIGTERM and 30 s to finish (the API
# runs its shutdown hooks), then is removed. Caddy resolves `web` through
# Docker's DNS every second and retries a failed dial against the other
# upstream, so a request never sees the switch; open SSE streams reconnect and
# receive a fresh snapshot (D-034). The database is migrated first, before any
# new code runs, which is why migrations must stay compatible with the version
# still serving (expand first, contract in a later release).
#
# Requires: COMPOSE_FILE=deploy/docker-compose.prod.yml in .env, a .env with
# the production values (docs/09-deploy.md), and the compose stack already up
# once (`docker compose up -d`). Run from anywhere; it cd's to the checkout.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd). See docs/09-deploy.md." >&2
  exit 1
fi

# Bring the compose project variables into this shell (COMPOSE_FILE among
# them); carriage returns stripped in case the file was edited on Windows.
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < ./.env)
set +a

if [ "${COMPOSE_FILE:-}" != 'deploy/docker-compose.prod.yml' ]; then
  echo "ERROR: COMPOSE_FILE must be deploy/docker-compose.prod.yml in .env (it is '${COMPOSE_FILE:-unset}')." >&2
  echo "       Without it, a plain 'docker compose' would mean the development stack." >&2
  exit 1
fi

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"   # seconds to wait for the new container
STOP_GRACE="${STOP_GRACE:-30}"            # seconds the old container gets after SIGTERM

log() { printf '[rollout %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

health_of() { docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo 'gone'; }

wait_healthy() {
  local id="$1" waited=0 status
  while :; do
    status="$(health_of "$id")"
    case "$status" in
      healthy) return 0 ;;
      exited | dead | gone)
        echo "ERROR: new container $id is $status. Its log:" >&2
        docker logs --tail 50 "$id" >&2 || true
        return 1
        ;;
    esac
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      echo "ERROR: new container $id still '$status' after ${HEALTH_TIMEOUT}s." >&2
      docker logs --tail 50 "$id" >&2 || true
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

roll() {
  local service="$1" old new
  old="$(docker compose ps -q "$service" | tr '\n' ' ' | sed 's/ *$//')"

  if [ -z "$old" ]; then
    log "$service: not running, starting it"
    docker compose up -d --no-deps --wait "$service"
    return 0
  fi

  local old_count
  old_count="$(echo "$old" | wc -w | tr -d ' ')"
  log "$service: starting one new container next to $old_count running"
  # --no-recreate keeps the old container even though its config changed;
  # the scale target of old+1 makes compose create exactly one new one from
  # the freshly built image.
  docker compose up -d --no-deps --no-recreate --scale "$service=$((old_count + 1))" "$service"

  new=''
  for id in $(docker compose ps -q "$service"); do
    case " $old " in *" $id "*) ;; *) new="$id" ;; esac
  done
  if [ -z "$new" ]; then
    echo "ERROR: compose did not create a new $service container." >&2
    return 1
  fi

  log "$service: waiting for ${new:0:12} to be healthy"
  if ! wait_healthy "$new"; then
    log "$service: rolling back — removing the failed new container, old one untouched"
    docker rm -f "$new" >/dev/null 2>&1 || true
    return 1
  fi

  for id in $old; do
    log "$service: stopping old ${id:0:12} (grace ${STOP_GRACE}s)"
    docker stop -t "$STOP_GRACE" "$id" >/dev/null
    docker rm "$id" >/dev/null
  done
  log "$service: done — serving from ${new:0:12}"
}

SERVICES=("$@")
if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=(model api web)
  if [ -z "${NO_BUILD:-}" ]; then
    log "building images (model api web migrate)"
    docker compose --profile tools build model api web migrate
  fi
  log "migrating the database"
  docker compose run --rm migrate
fi

for service in "${SERVICES[@]}"; do
  roll "$service"
done

log "rollout complete"
docker compose ps
