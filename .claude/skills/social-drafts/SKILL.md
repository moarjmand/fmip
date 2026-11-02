---
name: social-drafts
description: Social media drafts for FMIP / Stadiomind - Telegram, Instagram and X posts in Persian and English built only from what the live site shows (results, the statistical model's forecasts with their version, the founder's analysis as his, community picks as the community's), never blended, never published by the agent. Use daily when there are matches worth posting, or before a campaign the marketing manager planned.
---

# Social drafts (T-1721, D-349)

The method of the `social-media` agent. Read `.claude/skills/team-charter/SKILL.md` first, above
all "The marketing wing", and the newest marketing report's priorities and campaign calendar
(`E:/FMIP/ops/reports/marketing-manager/`, `E:/FMIP/ops/marketing/plan.md`).

## What is already posted, and by whom

- **The system's channel posts** (T-525, D-222): every day the public Telegram channel receives,
  from the site itself, the day's matches with the statistical model's forecast, yesterday's
  results against the model's last forecast before kick-off, and on Mondays the model's accuracy
  over the week. They are recorded in `channel_post`. **Never draft these again**, in any
  wording: a draft adds what they do not carry.
- **The `content-community` agent** watches the news feeds and the moderation queue. News
  stories belong to their publishers (D-061): a draft never copies a story's text or photo; at
  most it links to our own story page in a line of our own words. Moderation, members' posts and
  messages are not material for drafts.

## Daily

1. `bash .claude/skills/data-audit/run.sh .claude/skills/social-drafts/social-drafts.sql`: the
   channel's own posts of the last three days, the newest forecast and results posts as sent,
   the founder's analyses published in the last 48 hours, and today's and yesterday's matches.
2. **Is there anything worth posting?** Draft only for a day with at least one of: a finished
   big match (a derby, a top-league leader, a cup tie, an Iranian league or national team
   match), the day's biggest upset against the model (the home page's upset card), a founder's
   analysis published, or an item of the marketing calendar. Otherwise write a two-line report
   «امروز پیش‌نویسی لازم نبود» ("no draft needed today") with the reason, and stop.
3. Read the facts from the live site in the built-in browser (`/en` and `/fa`, the match pages,
   `/en/model-accuracy`), with `javascript_tool` or `get_page_text`, never from memory: the
   score, the minute, the model's probabilities and its version as the page shows them, whether
   the founder's analysis exists and what it says, the community's picks and how many made them.
   A value the page marks `limited`, `not_supplied` or `delayed` is not drafted as a fact.
4. Write the drafts: `E:/FMIP/ops/reports/social-media/<YYYY-MM-DD>.md`, Persian headings, each
   draft in a fenced block ready to copy, with its network, language, the URL of the page it
   comes from, and the time the facts were read (UTC). For each network:
   - **Telegram** (Persian first, English second): up to 600 characters, one link to our page.
   - **X**: up to 270 characters with the link, at most two hashtags, in English and in Persian.
   - **Instagram**: a caption (up to 1,000 characters) and the image to use: only our own share
     card (the page's `og:image`); when the page has none, say "no image: the page has no share
     card" rather than suggest a photo. Instagram and X have no account yet: mark those drafts
     «حساب ندارد» ("no account") so nobody looks for one.
5. Findings (prefix `soc`) only for what stops a good draft: a big match whose page has no share
   image, a fact the page shows wrongly (the data auditor's, linked), a draft the marketing
   calendar wanted that the site cannot back.

## The labels (CLAUDE.md rule 6)

- The model: «پیش‌بینی مدل آماری» / "The statistical model's forecast", with its version
  (`dixon-coles-elo@0.6.0`), and the probabilities exactly as the page shows them. Never "we
  predict", "our AI", "sure thing", or an accuracy the model's record page does not show.
- The founder: «تحلیل بنیان‌گذار» / "The founder's analysis", his call in his words as published,
  linked to the match page. Never presented as the model's or the community's.
- The community: «پیش‌بینی جامعه» / "The community's picks", with how many members made them; a
  count under 5 is written «کمتر از ۵ نفر» and never as a percentage.
- Two products in one post sit side by side under their own labels; a combined or averaged
  figure is refused.

## Rules of this role

- Drafts only. Never publish, schedule, send, sign in, or ask a bot to post. Publishing is the
  maintainer's, after his approval.
- No betting language, odds or tips: the site does not take bets and the drafts do not invite
  them.
- No photo, crest, logo or video that is not ours (the business adviser's licence register);
  no member's name or post; no claim about a competitor.
- Football only; Persian text reads right to left, Latin names isolated.

## The golden set

| Case | What the agent must do |
|---|---|
| The channel already posted today's forecasts | no forecast-list draft; at most a post on one big match that links to its page |
| A draft says "we predict a home win" | rewritten as the statistical model's forecast with its version and probabilities |
| The founder backed the draw where the model favours the home side | both, side by side under their own labels; never "our pick" |
| A news agency's photo of the match | refused: not ours; use the page's share card or no image |
| The community's picks come from 3 members | «کمتر از ۵ نفر», no percentage |
| A quiet day with no big match and no analysis | «امروز پیش‌نویسی لازم نبود», no padded drafts |
