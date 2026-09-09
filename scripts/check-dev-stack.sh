#!/usr/bin/env bash
# Brings the local stack up and proves both services actually answer.
# This is T-002's acceptance criterion as a command you can re-run.
#
#     bash scripts/check-dev-stack.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

# Carriage returns are stripped first: a `.env` saved by a Windows editor would
# otherwise hand pg_isready a user named "fmip\r" and curl a port "3001\r".
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < ./.env)
set +a

echo "==> Starting the stack (waiting for healthchecks)"
docker compose up -d --wait

echo "==> Postgres"
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "==> Postgres accepts queries"
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'select version()'

echo "==> Redis"
[ "$(docker compose exec -T redis redis-cli ping)" = "PONG" ] || {
  echo "ERROR: Redis did not answer PONG" >&2
  exit 1
}
echo "PONG"

echo "==> API /health"
api_port="${API_PORT:-3001}"
status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${api_port}/health")"
[ "$status" = "200" ] || {
  echo "ERROR: GET /health returned HTTP ${status}, expected 200" >&2
  exit 1
}
curl -s "http://127.0.0.1:${api_port}/health"
echo

echo "==> Web /en"
web_port="${WEB_PORT:-3000}"
web_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${web_port}/en")"
[ "$web_status" = "200" ] || {
  echo "ERROR: GET /en returned HTTP ${web_status}, expected 200" >&2
  exit 1
}
echo "HTTP 200"

echo
echo "Postgres, Redis, the API and the web app are all reachable."
