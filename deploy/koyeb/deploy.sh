#!/usr/bin/env bash
# Create or update the Koyeb preview service (T-086, D-051).
#
#   bash deploy/koyeb/deploy.sh create    # first time
#   bash deploy/koyeb/deploy.sh update    # after changing settings
#   bash deploy/koyeb/deploy.sh status    # what is deployed, and its URL
#   bash deploy/koyeb/deploy.sh logs      # tail the running service
#
# Needs the Koyeb CLI and a logged-in session, or KOYEB_TOKEN in the
# environment. It never asks for a password and never creates an account:
# `docs/11-koyeb.md` lists the three things the maintainer does by hand.
#
# Koyeb builds the image itself from this repository, so there is nothing to
# push: it clones the branch, builds `deploy/koyeb/Dockerfile`, and runs it.
#
# Secrets are passed as Koyeb secrets, never as plain environment values on the
# command line, so nothing sensitive ends up in a shell history or a log.

set -euo pipefail

cd "$(dirname "$0")/../.."

APP="${KOYEB_APP:-fmip}"
SERVICE="${KOYEB_SERVICE:-preview}"
REPO="${KOYEB_REPO:-github.com/moarjmand/fmip}"
BRANCH="${KOYEB_BRANCH:-main}"
# A free organisation gets one Free Instance, in one region, and it sleeps when
# nobody is looking. Both are facts about the plan, not choices.
INSTANCE="${KOYEB_INSTANCE:-free}"
REGION="${KOYEB_REGION:-fra}"
PORT=8000

fail() {
  echo "error: $*" >&2
  exit 1
}

koyeb() {
  if command -v koyeb >/dev/null 2>&1; then
    command koyeb "$@"
  else
    # No install needed on a machine that already runs Docker.
    docker run --rm -i \
      -e KOYEB_TOKEN \
      -v "$HOME/.koyeb.yaml:/root/.koyeb.yaml" \
      koyeb/koyeb-cli:latest "$@"
  fi
}

require_secrets() {
  local missing=()
  for name in fmip-database-url fmip-session-secret; do
    koyeb secrets get "$name" >/dev/null 2>&1 || missing+=("$name")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    cat >&2 <<EOF
error: these Koyeb secrets do not exist yet: ${missing[*]}

Create them once, from values you hold — the script never sees them:

  koyeb secrets create fmip-database-url    # the Postgres connection string
  koyeb secrets create fmip-session-secret  # 32+ random bytes, base64

See docs/11-koyeb.md.
EOF
    exit 1
  fi
}

# Everything that is the same for a create and an update.
service_args() {
  cat <<EOF
--app $APP
--git $REPO
--git-branch $BRANCH
--git-builder docker
--git-docker-dockerfile deploy/koyeb/Dockerfile
--instance-type $INSTANCE
--regions $REGION
--type web
--port $PORT:http
--route /:$PORT
--checks $PORT:http:/en
--checks-grace-period $PORT=90
--env DATABASE_URL={{secret.fmip-database-url}}
--env SESSION_SECRET={{secret.fmip-session-secret}}
--env NODE_ENV=production
--env PORT=$PORT
--env API_PORT=3001
--env API_BASE_URL=http://127.0.0.1:3001
--env MODEL_SERVICE_URL=off
--env INGESTION_SOURCE=off
--env INGESTION_SCHEDULE=off
--env RUN_MIGRATIONS=on
--env PREVIEW_SEED=${PREVIEW_SEED:-off}
EOF
}

create() {
  require_secrets
  koyeb apps get "$APP" >/dev/null 2>&1 || koyeb apps create "$APP"
  # shellcheck disable=SC2046 # each line of service_args is one argument
  koyeb services create "$SERVICE" $(service_args)
  echo
  echo "created. The URL appears once the first build finishes:"
  echo "  bash deploy/koyeb/deploy.sh status"
}

update() {
  require_secrets
  # shellcheck disable=SC2046
  koyeb services update "$APP/$SERVICE" $(service_args)
}

status() {
  koyeb services describe "$APP/$SERVICE" ||
    fail "no service $APP/$SERVICE; run 'bash deploy/koyeb/deploy.sh create'"
  echo
  echo "SITE_URL and WEB_BASE_URL still have to name the public address."
  echo "Once the URL is known, set them once:"
  echo "  koyeb services update $APP/$SERVICE --env SITE_URL=https://<url> --env WEB_BASE_URL=https://<url>"
}

case "${1:-status}" in
  create) create ;;
  update) update ;;
  status) status ;;
  logs) koyeb services logs "$APP/$SERVICE" ;;
  *) fail "unknown command '$1'; use create, update, status or logs" ;;
esac
