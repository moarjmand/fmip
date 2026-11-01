#!/usr/bin/env bash
# Read-only search and sharing health of the live site (T-1694, D-339), for the product and strategy agent.
#     bash .claude/skills/product-strategy/seo-check.sh
# Fetches robots.txt, the sitemap and key pages from the server (the PC's own link is unreliable) and
# prints, per page: status, time, title, description (full, with its length), canonical, the
# alternate-language links, og:image and twitter:card. A team, a competition, a match and a news
# story are picked from the sitemap and the pages themselves. The sitemap's count is appended to
# E:/FMIP/ops/sitemap-count.log, so a month's drop can be judged.
set -uo pipefail
out="$(ssh -o ConnectTimeout=20 fmip-prod 'bash -s' <<'REMOTE'
S=https://traveltohormuz.ir
echo "== robots.txt"; curl -s -m 20 "$S/robots.txt" | head -14
sm="$(curl -s -m 30 "$S/sitemap.xml")"
echo "== sitemap"; echo "urls: $(printf "%s" "$sm" | grep -o "<loc>" | wc -l)"
for kind in team competition; do echo "$kind: $(printf "%s" "$sm" | grep -o "<loc>[^<]*/$kind/[^<]*" | wc -l)"; done
team="$(printf "%s" "$sm" | grep -o "<loc>[^<]*/en/team/[^<]*" | head -1 | sed 's/<loc>//; s#https://traveltohormuz.ir##')"
comp="$(printf "%s" "$sm" | grep -o "<loc>[^<]*/en/competition/[^<]*" | head -1 | sed 's/<loc>//; s#https://traveltohormuz.ir##')"
match="$(curl -s -m 25 "$S/en/scores" | grep -oE '/en/match/[0-9a-f-]{36}' | head -1)"
story="$(curl -s -m 25 "$S/en/news" | grep -oE '/en/news/[a-z0-9-]{8,}[^"]*' | head -1)"
for path in /en /fa /en/scores /en/news /fa/news /en/model-accuracy /en/competitions /en/leaderboard /en/about "$team" "$comp" "$match" "$story"; do
  [ -z "$path" ] && continue
  h="$(curl -s -m 25 -w '\n%{http_code} %{time_total}' "$S$path")"
  meta="$(printf "%s" "$h" | tail -1)"; body="$(printf "%s" "$h" | sed '$d')"
  title="$(printf "%s" "$body" | grep -o '<title>[^<]*' | head -1 | sed 's/<title>//')"
  desc="$(printf "%s" "$body" | grep -oE '<meta name="description" content="[^"]*' | head -1 | sed 's/.*content="//')"
  canon="$(printf "%s" "$body" | grep -oE '<link rel="canonical" href="[^"]*' | head -1 | sed 's/.*href="//')"
  alts="$(printf "%s" "$body" | grep -oiE '<link rel="alternate" hrefLang="[^"]*' | sed 's/.*="//' | tr '\n' ',' )"
  og="$(printf "%s" "$body" | grep -ciE '<meta property="og:image"')"
  tw="$(printf "%s" "$body" | grep -oE '<meta name="twitter:card" content="[^"]*' | head -1 | sed 's/.*content="//')"
  echo "$path | $meta | title: ${title:-MISSING} | desc(${#desc}): ${desc:-MISSING} | canonical: ${canon:-MISSING} | alternates: ${alts:-none} | og:image: $og | twitter:card: ${tw:-none}"
done
echo "== end"
REMOTE
)"
printf '%s\n' "$out"
count="$(printf '%s\n' "$out" | sed -n 's/^urls: //p')"
[ -n "$count" ] && mkdir -p /e/FMIP/ops && echo "$(date -u +%F) $count" >> /e/FMIP/ops/sitemap-count.log
