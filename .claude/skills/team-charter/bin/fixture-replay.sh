# Fixture mode of the five read-only scripts (T-1895): sourced by data-audit/run.sh,
# ops-check/ops-check.sh, fmip-security/server-hardening.sh, product-strategy/seo-check.sh and
# search-visibility/structured-data.sh only when FMIP_FIXTURE is set, so their real path never reads it.
#
# fixture_replay <fixture name> <error word>
#   prints a loud first line, <FMIP_FIXTURE>/<name>.txt, and the same loud last line, and opens no
#   connection; sets FX_STATUS to the code in <name>.exit (0 when there is none) and FX_FILE to the
#   fixture. A leftover FMIP_FIXTURE must never pass for the server: without FMIP_FIXTURE_OK=1 it
#   replays nothing and exits 2. A missing fixture, or an exit file that holds no number, exits 2.
#   A fixture is a saved run: `bash <script> > <dir>/<name>.txt; echo $? > <dir>/<name>.exit`.

fixture_replay() {
  local fx="$FMIP_FIXTURE/$1" word="$2"
  local banner="FIXTURE REPLAY from $FMIP_FIXTURE: not the server"
  echo "$banner"
  if [ "${FMIP_FIXTURE_OK:-}" != 1 ]; then
    echo "$word-ERROR: FMIP_FIXTURE is set without FMIP_FIXTURE_OK=1 (left over?): nothing replayed and the server not read; unset FMIP_FIXTURE for a real run"
    echo "$banner"
    exit 2
  fi
  if [ ! -f "$fx.txt" ]; then
    echo "$word-ERROR: $fx.txt is missing (no connection was opened)"
    echo "$banner"
    exit 2
  fi
  FX_STATUS=0
  [ -f "$fx.exit" ] && FX_STATUS="$(tr -d ' \t\r\n' < "$fx.exit")"
  case "$FX_STATUS" in
    '' | *[!0-9]*)
      echo "$word-ERROR: $fx.exit holds no exit code"
      echo "$banner"
      exit 2
      ;;
  esac
  FX_FILE="$fx.txt"
  cat "$fx.txt"
  if [ -s "$fx.txt" ] && [ -n "$(tail -c 1 "$fx.txt")" ]; then echo; fi
  echo "$banner"
}
