#!/bin/sh
# Build (or rebuild) the lab store, `fmip_lab` (T-1646, D-303): a copy of the
# `training` schema on the production Postgres, for experiments that load more
# history than the published version fits on. Run on the server from /opt/fmip.
# Our own Elo reads every row of training.match, so history goes into the lab,
# never into the production store, until a decision says otherwise.
set -e
cd "${FMIP_DIR:-/opt/fmip}"
dump="$(mktemp)"
lab="$(mktemp)"
trap 'rm -f "$dump" "$lab"' EXIT
docker compose exec -T postgres dropdb -U fmip --if-exists fmip_lab
docker compose exec -T postgres createdb -U fmip fmip_lab
docker compose exec -T postgres pg_dump -U fmip -d fmip -n training --no-owner > "$dump"
# The training schema's one foreign key into public (team_alias -> public.team)
# has no table to point at in the lab: drop that statement, keep the rest.
awk '
  /^ALTER TABLE ONLY training\./ { held=$0; next }
  held != "" { if ($0 ~ /REFERENCES public\./) { held=""; next } print held; held="" }
  { print }
' "$dump" > "$lab"
docker compose exec -T postgres psql -U fmip -d fmip_lab -q -v ON_ERROR_STOP=1 --single-transaction < "$lab"
docker compose exec -T postgres psql -U fmip -d fmip_lab -tAc \
  "select 'fmip_lab: ' || count(*) || ' matches, ' || min(season) || ' to ' || max(season) from training.match"
