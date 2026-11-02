---
name: search-visibility
description: Search and AI-answer visibility for FMIP / Stadiomind - keywords per language (English and Persian first), robots and sitemap, schema.org structured data (SportsEvent, SportsTeam, SportsOrganization, Person, BreadcrumbList, WebSite), canonical and hreflang, titles and descriptions, share cards, and the speed signals already measured; every finding with its exact URL. Use for the weekly search check or before a page's metadata changes.
---

# Search visibility (T-1721, D-349)

The method of the `seo-search` agent. Read `.claude/skills/team-charter/SKILL.md` first, above
all "The marketing wing", and the newest marketing report's priorities
(`E:/FMIP/ops/reports/marketing-manager/`).

Since D-349 this agent owns the weekly search and sharing check that D-339 gave the product
strategist monthly; the strategist reads this agent's reports instead of running it again.

## Where the site says it

- `apps/web/src/lib/seo.ts`: `pageMetadata` (title, description, canonical, alternates),
  `INDEXABLE_LOCALES`, and the JSON-LD builders `websiteJsonLd`, `matchJsonLd` (SportsEvent),
  `teamJsonLd` (SportsTeam), `competitionJsonLd` (SportsOrganization), `playerJsonLd` (Person),
  `breadcrumbJsonLd`; `components/json-ld.tsx` writes them into the page.
- `apps/web/src/app/sitemap.ts` (static pages, every active competition and team per indexable
  locale; empty on demonstration data by design, T-087) and `app/robots.ts` (the pseudo-locale,
  API routes and members' pages closed; ClaudeBot, CCBot and Reflectionbot throttled with a
  10 s `Crawl-delay`, never refused, D-240).
- Speed already measured: `apps/web/perf-budgets.json` (first-load JavaScript and median server
  response per busy route, T-808) and the times `seo-check.sh` prints. There is no field data
  (no Chrome UX report account, no tracker): say so rather than guess Core Web Vitals.

## Weekly

1. `bash .claude/skills/product-strategy/seo-check.sh`: robots, the sitemap's counts (appended
   to `E:/FMIP/ops/sitemap-count.log`), and per key page the status, time, title, description,
   canonical, alternates, `og:image` and `twitter:card`. Judge it by the bar in the product
   strategy skill ("Search and sharing"): 200 in under 1.5 s, a specific title, a description of
   50 to 160 characters, its canonical, alternates for en, fa and x-default, a share image.
2. `bash .claude/skills/search-visibility/structured-data.sh`: per page, `<html lang>` and `dir`,
   the robots meta, the number of `<h1>`, and each JSON-LD block's `@type` and the fields a rich
   result needs. A match page needs SportsEvent with `name`, `startDate`, `homeTeam`,
   `awayTeam` and `location` where the venue is known (CLAUDE.md rule 3: a missing venue is left out,
   never invented); a team page SportsTeam; a competition page SportsOrganization. A block that
   fails to parse, or a page of that kind without its type, is a finding with the URL.
3. **Keywords, per language.** Keep `E:/FMIP/ops/marketing/keywords.md`: for English and Persian
   (other languages later), the queries a reader would type for what we have (a club's name plus
   "fixtures", "نتایج", "پیش‌بینی", a league's table, "prediction" and "model" queries), the
   page that should answer each, and whether its title and description carry the words in that
   language. Use WebSearch to see what ranks today, marking it as a snapshot of one search, not a
   ranking. Persian queries are checked with Persian spelling variants (ی/ي, ک/ك, the
   half-space).
4. **AI-answer visibility.** Ask WebSearch two or three questions our pages answer (a match's
   forecast, a club's next match) and note whether the site is cited. AI crawlers stay welcome
   (D-240): never propose refusing them, only a lighter page where load is the issue.
5. Write findings (prefix `seo`) with the exact URL in `evidence`: a 4xx or 5xx in the sitemap,
   a canonical pointing elsewhere, missing alternates, a title shared by two pages, a
   description out of range, a page of a kind without its JSON-LD, a drop of more than 5% in the
   sitemap count against last week's line. A name with stray spaces is the data auditor's.

Report: `E:/FMIP/ops/reports/seo-search/<YYYY-MM-DD>.md`, Persian, with a table of the pages
checked (URL, status, time, title length, description length, canonical, alternates, image,
JSON-LD types) and the keyword notes.

## Rules of this role

- Read-only: the scripts fetch public pages from the server and change nothing.
- No account: Search Console, Bing Webmaster Tools, a keyword tool or any paid service is the
  maintainer's to open; propose it on the desk with what it would show.
- Never propose hidden text, doorway pages, generated pages without data, or markup that claims
  what the page does not show (rule 3): structured data describes the visible page.
- A forecast in a title or description is the statistical model's (rule 6).

## The golden set

| Case | What the check must say |
|---|---|
| No `og:image` on `/en`, `/fa`, scores, news, the model page, competitions, leaderboard, about and all team pages; match and competition pages have one (2026-11-01) | one finding naming each URL kind, and the proposal of a default card and a team card |
| The home title is the bare brand "Stadiomind" in both locales | a decision for the desk (the brand is the maintainer's), with descriptor options per language |
| robots.txt gives ClaudeBot, CCBot and Reflectionbot `Crawl-delay: 10` | not a finding: throttled by D-240, still indexable |
| The preview's sitemap is empty | not a finding when the preview runs on demonstration data (T-087) |
| A match with no known venue has no `location` in its SportsEvent | correct (rule 3); a `location` with an invented venue would be the finding |
