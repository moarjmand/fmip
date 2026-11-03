#!/usr/bin/env bash
# Read-only structured-data and indexing check of the live site (T-1721, D-349), for the seo-search agent.
#     bash .claude/skills/search-visibility/structured-data.sh
# Fetches key pages from the server (the PC's own link is unreliable) and prints, per page: status,
# time, <html lang> and dir, the robots meta, the number of <h1>, and each JSON-LD block's @type with
# the fields a rich result needs that are missing. A team, a competition, a match and a player are
# picked from the sitemap and the pages themselves, in English and Persian. Changes nothing.
set -uo pipefail
raw="$(ssh -o ConnectTimeout=20 fmip-prod 'bash -s' <<'REMOTE'
S=https://traveltohormuz.ir
sm="$(curl -s -m 30 "$S/sitemap.xml")"
team="$(printf "%s" "$sm" | grep -o "<loc>[^<]*/en/team/[^<]*" | head -1 | sed 's/<loc>//; s#https://traveltohormuz.ir##')"
comp="$(printf "%s" "$sm" | grep -o "<loc>[^<]*/en/competition/[^<]*" | head -1 | sed 's/<loc>//; s#https://traveltohormuz.ir##')"
match="$(curl -s -m 25 "$S/en/scores" | grep -oE '/en/match/[0-9a-f-]{36}' | head -1)"
player=""
[ -n "$team" ] && player="$(curl -s -m 25 "$S$team" | grep -oE '/en/player/[0-9a-f-]{36}' | head -1)"
for path in /en /fa "$team" "$comp" "$match" "${match/\/en\//\/fa\/}" "$player"; do
  [ -z "$path" ] && continue
  h="$(curl -s -m 25 -w '\n%{http_code} %{time_total}' "$S$path")"
  meta="$(printf "%s" "$h" | tail -1)"; body="$(printf "%s" "$h" | sed '$d')"
  echo "=== $path | $meta"
  printf "%s" "$body" | grep -oE '<html[^>]*>' | head -1 | sed 's/^/HTML /'
  printf "%s" "$body" | grep -oE '<meta name="robots" content="[^"]*' | head -1 | sed 's/.*content="/ROBOTS /'
  echo "H1 $(printf "%s" "$body" | grep -o '<h1[ >]' | wc -l)"
  printf "%s" "$body" | grep -oE '<script type="application/ld\+json">[^<]*</script>' | sed 's#<script type="application/ld+json">#LD #; s#</script>$##'
done
echo "=== end"
REMOTE
)"
status=$?
if [ "$status" -ne 0 ] || [ -z "$raw" ]; then
  echo "SEO-ERROR: could not read the pages from the server (exit $status)"
  exit 2
fi
printf '%s\n' "$raw" | node -e '
const need = {
  SportsEvent: ["name", "startDate", "homeTeam", "awayTeam", "url"],
  SportsTeam: ["name", "url"],
  SportsOrganization: ["name", "url"],
  Person: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  WebSite: ["name", "url"],
};
let out = [];
for (const line of require("fs").readFileSync(0, "utf8").split(/\r?\n/)) {
  if (line.startsWith("=== ")) { out.push(line); continue; }
  if (!line.startsWith("LD ")) { if (line.trim() !== "") out.push("  " + line); continue; }
  try {
    const data = JSON.parse(line.slice(3));
    for (const item of Array.isArray(data) ? data : [data]) {
      const type = item["@type"] ?? "(no @type)";
      const missing = (need[type] ?? []).filter((field) => item[field] === undefined);
      out.push(`  LD ${type}${missing.length ? " MISSING " + missing.join(",") : ""}${type === "SportsEvent" && item.location === undefined ? " (no location: venue unknown?)" : ""}`);
    }
  } catch (error) {
    out.push(`  LD UNPARSABLE ${line.slice(3, 120)}`);
  }
}
console.log(out.join("\n"));
'
