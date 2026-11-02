---
name: content-watch
description: Content and community for FMIP / Stadiomind - the news feeds' health (fetches, failing or silent sources, image licences, football only), the moderation queue and sanctions, and the Persian text and right-to-left display of what readers see. Use daily, when a source misbehaves, or when the community grows.
---

# Content and community (T-1694, D-339)

The method of the `content-community` agent. Read `.claude/skills/team-charter/SKILL.md` first.

## Daily

The site is `https://traveltohormuz.ir` (`/en/news`, `/fa/news`). Source kinds: `licensed` are
GNews's publishers, read through GNews (never fetched one by one); `rss` are feeds fetched directly
(Yahoo Sports, The Independent, IRNA, Khabar Varzeshi, kicker, Sportschau, Agência Brasil and the
like), some of them general sports feeds whose other sports the filter removes.

1. `bash .claude/skills/data-audit/run.sh .claude/skills/content-watch/content-watch.sql`. It shows:
   - sources by kind and language;
   - the last 24 hours' fetches, and sources failing every fetch;
   - directly fetched feeds silent for 7 days, and feeds without an image licence record;
   - open reports by age, and moderation decisions and active sanctions.

   GNews's publishers (`licensed`) are read through GNews, so their silence is not a finding.
   One source above about 30% of a day's articles crowds the "Latest" list: a finding.
   An image is shown only from a source with a recorded licence (`news-image-store.ts`), so a feed
   without one shows headlines and summaries only: a coverage gap for the business adviser, not a
   breach. A feed whose cards carry images without a licence record would be a breach.
2. Read `/en/news` and `/fa/news` (the first 30 headlines each) through the built-in browser:
   - every item is football;
   - no source credit stands alone as a story;
   - Persian headlines read right to left without broken punctuation;
   - Latin names are isolated.

   Read with `javascript_tool`, not the whole page:
   `[...document.querySelectorAll('main article h2, main article h3, main h3')].slice(0,30).map(h=>h.textContent.trim())`.
   Since D-348 (T-1718), `/fa/news` lists Persian-language sources only, so a non-Persian headline
   there is a finding (a source stored with the wrong language), and so is broken direction.
   Football's family is in scope: futsal and beach soccer, men's and women's, youth (D-321).
3. Write findings (prefix `cnt`) for:
   - a source failing all day;
   - a feed silent for a week;
   - a non-football item (which word let it through, and the word that would stop it; T-1669's
     list is `packages/ingestion/src/news/other-code.ts`);
   - a report open for more than 48 hours;
   - a feed showing images without a recorded licence.

## Rules of this role

- Recommend, never publish, drop a source, or decide a moderation case. Moderation decisions and
  sanctions are a person's, recorded with a reason (CLAUDE.md rule 10). You prepare the case:
  the content, the rule it may break (the platform rules page), similar past decisions.
- Translators are the maintainer's: you report a display problem, never the translation work,
  and you never remind about translators.
- Members' messages and reports are personal data: quote only what a finding needs.

## The golden set

| Case | What the watch must catch |
|---|---|
| Cricket and tennis stories on the news page (2026-10-31) | non-football items, with the word that let them through |
| A wrestling story from Tehran Times (2026-10-31) | the same, and that wrestling's nouns were missing |
| "kicker (Quelle www.kicker.de)" shown as a story (2026-10-31) | a source credit alone as an item |
| Seven directly fetched feeds without an image licence record (2026-11-01) | the licence gap, for the business adviser |
