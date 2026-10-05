#!/usr/bin/env bash
# Backtests a proposed model candidate against the published version and the
# current candidate (T-1368, D-186). The collaborator's one command; the guide
# is docs/15-model.md.
#
#     bash scripts/model-backtest.sh apps/model/fmip_model/model/candidates/<name>-<version>.json
#
# Any further options go to `python -m fmip_model.backtest.compare`, e.g.
# `--divisions E0 SP1` for a quicker first look, `--against published`, or
# `--from 2024-08-01 --to 2025-06-30 --history-from 2022-07-01`.
#
# What it does: starts Postgres if it is not running, builds the model image,
# and runs the comparison in that image with apps/model mounted, so the file
# and the code are the working tree's. The comparison first loads from
# football-data.co.uk every season the training store does not hold yet
# (--fetch), then writes the report to
# apps/model/reports/<name>-<version>/compare_<from>..<to>.{md,json}.
#
# Needs: Docker, a `.env` (cp .env.example .env), and the database migrated
# once (`pnpm install`, then `pnpm --filter @fmip/db migrate:up`).

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "usage: bash scripts/model-backtest.sh apps/model/fmip_model/model/candidates/<file>.json [options]" >&2
  exit 2
fi
file=${1//\\//}
shift

if [ ! -f "$file" ]; then
  echo "ERROR: $file not found" >&2
  exit 2
fi
case "$file" in
  ./apps/model/*) inside=${file#./apps/model/} ;;
  apps/model/*) inside=${file#apps/model/} ;;
  *)
    echo "ERROR: put the file under apps/model/ (its place is apps/model/fmip_model/model/candidates/)" >&2
    exit 2
    ;;
esac
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

# Git Bash on Windows: hand Docker a Windows path and leave /work alone.
host_dir="$PWD/apps/model"
if pwd -W >/dev/null 2>&1; then
  export MSYS_NO_PATHCONV=1
  host_dir="$(pwd -W)/apps/model"
fi
# On Linux, write the report as the caller, not as the image's own user.
user_args=()
if [ "$(uname -s)" = "Linux" ]; then
  user_args=(--user "$(id -u):$(id -g)")
fi

echo "==> Postgres"
docker compose up -d --wait postgres

echo "==> The model image"
docker compose build model

echo "==> The training store"
if ! docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1 FROM training.match LIMIT 0"' >/dev/null 2>&1; then
  echo "ERROR: the database has no training schema yet. Run once:" >&2
  echo "  pnpm install && pnpm --filter @fmip/db migrate:up" >&2
  exit 1
fi

echo "==> Backtest of $inside"
docker compose run --rm --no-deps "${user_args[@]}" \
  -v "$host_dir:/work" -w /work \
  -e HTTPS_PROXY -e HTTP_PROXY -e NO_PROXY \
  model python -m fmip_model.backtest.compare --candidate-file "$inside" --fetch "$@"
