#!/usr/bin/env bash
# The launch measure as one command (T-1968, T-1966, D-459 point 4), read-only:
#
#     bash .claude/skills/growth-funnel/launch-measure.sh <launch yyyy-mm-dd> <internal ids file>
#
# Runs launch-measure.sql for the invitation weeks since <launch> (a UTC day; week 1 is its first
# seven days) through .claude/skills/data-audit/run.sh, whose session is read-only and is the
# only way to production's database, prints one short table in Persian and writes it to
# E:/FMIP/ops/reports/growth-analyst/<UTC date>-launch-measure.md.
#
# The ids file lists the internal accounts (the maintainer's, the team's, test accounts): one id
# per line, blank lines and `#` comments ignored. It stays outside every git tree: a file git would
# take is refused (E:/FMIP/ops is a git repository that a bridge commits), and so is any file when
# git cannot answer, unless it is under E:/FMIP/data-audit/. The ids travel only inside the
# temporary query file, which run.sh deletes on the server and this script here; the output
# carries counts only. Nothing is written to the database.
#
# MEASURE_LOCAL_DB=<name> runs the same file on that database of the local Compose Postgres
# (fmip-postgres-1) in a read-only session instead, prints the table and writes no report: the
# engineering session's fixture check. No other setting changes where it reads or writes, and
# team-guard refuses MEASURE_ variables to the team agents.
# A failure says MEASURE-ERROR, exits non-zero and writes no report.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out_dir=/e/FMIP/ops/reports/growth-analyst
local_db="${MEASURE_LOCAL_DB:-}"

fail() {
  echo "MEASURE-ERROR: $*" >&2
  exit 2
}
# Persian digits, for the lines this script writes (the SQL writes its own).
fa() { sed 's/0/۰/g; s/1/۱/g; s/2/۲/g; s/3/۳/g; s/4/۴/g; s/5/۵/g; s/6/۶/g; s/7/۷/g; s/8/۸/g; s/9/۹/g'; }

[ "$#" -eq 2 ] || fail "usage: launch-measure.sh <launch yyyy-mm-dd> <internal ids file>"
launch="$1"
ids_file="$2"

if [[ ! "$launch" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || [ "$(date -u -d "$launch" +%F 2>/dev/null)" != "$launch" ]; then
  fail "the launch date \"$launch\" is not a day written yyyy-mm-dd"
fi
today="$(date -u +%F)"
if [[ "$launch" > "$today" ]]; then
  fail "the launch date $launch is after today ($today, UTC)"
fi
if [ -n "$local_db" ] && [[ ! "$local_db" =~ ^[a-z0-9_]{1,63}$ ]]; then
  fail "MEASURE_LOCAL_DB is not a database name"
fi

# The ids file: outside every git tree, judged by its real path; when git cannot answer, only
# E:/FMIP/data-audit/ is trusted (it is not a git tree).
[ -f "$ids_file" ] || fail "the internal ids file was not found: $ids_file"
ids_dir="$(cd "$(dirname "$ids_file")" && pwd -P)" || fail "the internal ids file's folder cannot be read"
ids_path="$ids_dir/$(basename "$ids_file")"
lower="${ids_path,,}"
case "$lower" in
  /e/fmip/fmip/* | /e/fmip/fmip-ops/* | /e/fmip/ops/*)
    fail "the internal ids file is inside the project's repositories; keep it outside every git tree (E:/FMIP/data-audit/ is the place)"
    ;;
esac
trusted=""
case "$lower" in /e/fmip/data-audit/*) trusted=1 ;; esac
unset GIT_DIR GIT_WORK_TREE GIT_CEILING_DIRECTORIES GIT_DISCOVERY_ACROSS_FILESYSTEM GIT_COMMON_DIR
if ! command -v git > /dev/null 2>&1; then
  [ -n "$trusted" ] || fail "git is not on PATH, so the ids file cannot be shown to be outside a git tree; keep it under E:/FMIP/data-audit/"
else
  inside="$(LC_ALL=C git -C "$ids_dir" rev-parse --is-inside-work-tree 2>&1)"
  status=$?
  if [ "$status" -eq 0 ] && [ "$inside" = "true" ]; then
    LC_ALL=C git -C "$ids_dir" check-ignore -q "$ids_path" 2> /dev/null
    ignored=$?
    top="$(git -C "$ids_dir" rev-parse --show-toplevel 2> /dev/null)"
    [ "$ignored" -eq 0 ] || fail "the internal ids file is inside a git tree ($top) that does not ignore it; keep it outside every git tree"
  elif [ "$status" -ne 0 ] && printf '%s' "$inside" | grep -q 'not a git repository'; then
    : # outside every git tree
  elif [ -z "$trusted" ]; then
    fail "git could not say whether the ids file is outside a git tree (exit $status); keep it under E:/FMIP/data-audit/"
  fi
fi

ids=()
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  line="${line%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [ -z "$line" ] && continue
  if [[ ! "$line" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    fail "line $n of the internal ids file is not an account id (one id per line, # for a comment)"
  fi
  ids+=("$(printf '%s' "$line" | tr 'A-F' 'a-f')")
done < "$ids_file"
internal=""
count=0
if [ "${#ids[@]}" -gt 0 ]; then
  unique="$(printf '%s\n' "${ids[@]}" | sort -u)"
  internal="$(printf '%s' "$unique" | paste -sd, -)"
  count="$(printf '%s\n' "$unique" | wc -l | tr -d ' ')"
fi

query="$(mktemp "${TMPDIR:-/tmp}/launch-measure-XXXXXX")"
trap 'rm -f "$query"' EXIT
{
  echo '\pset format unaligned'
  echo '\pset tuples_only on'
  echo "\\set launch '$launch'"
  echo "\\set internal '{$internal}'"
  cat "$here/launch-measure.sql"
} > "$query"

if [ -n "$local_db" ]; then
  result="$(docker exec -i -e PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000" \
    fmip-postgres-1 psql -U fmip -d "$local_db" -q -X -v ON_ERROR_STOP=1 < "$query" 2>&1)"
else
  result="$(bash "$here/../data-audit/run.sh" "$query")"
fi
status=$?
if [ "$status" -ne 0 ] || [ -z "$result" ] || printf '%s\n' "$result" | grep -q '^AUDIT-'; then
  printf '%s\n' "$result" >&2
  fail "the queries did not run (exit $status); no report written"
fi

table="$(printf '%s\n' "$result" | grep '^|')"
back="$(printf '%s\n' "$result" | grep -v '^|' | grep -v '^[[:space:]]*$')"
ran="$(date -u '+%Y-%m-%d %H:%M')"

report="$(
  cat << EOF
# سنجش راه‌اندازی، $(printf '%s' "$today" | fa)

تاریخ دعوت $(printf '%s' "$launch" | fa) (UTC)؛ هر هفته هفت روز از همان روز. بی $(printf '%s' "$count" | fa) حساب داخلی و بی کادر سایت (نقش‌دار). اجرا: $(printf '%s' "$ran" | fa) UTC.

$table

$back

- «کمتر از ۵» یعنی آن هفته در آن ستون ۰ تا ۴ دارد. هفته‌ای با کمتر از ۵ عضو فعال هر سه ستون پیش‌بینی را پنهان می‌کند.
- «دست‌کم N» در ردیف «همه» یعنی آن ستون هفتهٔ پنهان دارد و N جمع هفته‌های نشان‌داده است؛ جمع دقیق گفته نمی‌شود تا هیچ خانهٔ پنهانی با تفریق پیدا نشود. ستونی که هفتهٔ پنهان ندارد جمع دقیقش را می‌گوید.
- عضو فعال یعنی دست‌کم یک پیش‌بینی در همان هفته. در ردیف «همه» هر عضو فعال یک بار شمرده شده، و «پیش‌بینی هر عضو فعال» میانگین هفته‌هایی است که عضو فعال بوده، فقط روی هفته‌های نشان‌داده.
- بازگشت ۷ روزه فقط اعضای هفته‌هایی را می‌شمارد که دست‌کم ۷ روز پیش تمام شده‌اند و ثبت‌نامشان نشان داده شده؛ اعضای هفتهٔ پنهان در آن نیستند.
- شمارش حساب‌های فعالِ امروز است: حسابی که بعداً حذف یا معلق شود از هفتهٔ ثبت‌نامش هم کم می‌شود، پس عدد یک هفته می‌تواند از یک دوشنبه تا دوشنبهٔ بعد پایین بیاید.
- حد شناخته‌شده: «دوباره دیده شدند» از \`session.last_seen_at\` می‌آید که با استفاده جلو می‌رود (هر درخواستِ با حساب، دست‌بالا هر ۵ دقیقه یک بار) و پس نمی‌رود؛ یعنی «در روز هفتم یا پس از آن دیده شد»، نه «درست روز هفتم سر زد». زبانه‌ای که باز مانده (گفت‌وگوی زنده، جریان نتایج) هم آن را جلو می‌برد؛ «پیش‌بینی هم کردند» کف سخت‌گیرانه‌تر کنار آن است. سر زدن بی ورود به حساب دیده نمی‌شود.
- بازدیدکننده‌ای که ثبت‌نام نکرده سنجیده نمی‌شود (\`not_supplied\`)، و شمار دعوت‌شده‌ها را سایت نمی‌داند: آن را نگه‌دارنده می‌گوید.
EOF
)"

printf '%s\n' "$report"
if [ -n "$local_db" ]; then
  echo "local database $local_db: no report written"
  exit 0
fi
mkdir -p "$out_dir" || fail "could not make $out_dir"
target="$out_dir/$today-launch-measure.md"
printf '%s\n' "$report" > "$target" || fail "could not write $target"
echo "written: $target"
