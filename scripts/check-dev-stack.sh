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

set -a
# shellcheck disable=SC1091
. ./.env
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

echo
echo "Both services are reachable."
