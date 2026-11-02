---
name: marketing-plan
description: Marketing for FMIP / Stadiomind - the growth plan (audience, positioning, the brand message in English and Persian, channels, a campaign calendar), the marketing wing's priorities, and measuring results against the site's own numbers. Use for the Monday marketing report, before a campaign, or when growth is discussed.
---

# The marketing plan (T-1721, D-349)

The method of the `marketing-manager` agent. Read `.claude/skills/team-charter/SKILL.md` first,
above all "The marketing wing".

## Inputs (read, never change)

- The wing's newest reports: `E:/FMIP/ops/reports/growth-analyst/`, `.../seo-search/`,
  `.../social-media/` (the week's drafts and which were published, if the maintainer said so),
  and the week's lines with the prefixes `gro`, `seo`, `soc` in `E:/FMIP/ops/findings/`.
- The product strategist's findings (`str`), above all str-2026-11-02-01 (4 members, 9
  predictions, none in 7 days) and str-2026-11-01-01 (no share image on most pages).
- `docs/product-blueprint.md` (who the product is for, what it promises) and the
  decisions on the three prediction products (CLAUDE.md rule 6).
- The dashboard's snapshot `E:/FMIP/dashboard/out/snapshot.json` and the channel's own record,
  the growth analyst's `channel_post` lines (posts sent by kind).
- The last plan: `E:/FMIP/ops/marketing/plan.md`, and the decision ledger
  `E:/FMIP/ops/decisions.md` (what the maintainer already chose on the brand and spend).

## The plan: `E:/FMIP/ops/marketing/plan.md`, Persian, kept up to date

1. **Audience.** Two or three segments at most, each with where they already are (a Persian
   football Telegram reader, an English reader searching a match, a fan who likes to predict),
   what they want from us, and the page that serves it. A segment is a claim: name the evidence
   (the growth analyst's languages and countries, the search report's queries) or mark it as an
   assumption to test.
2. **Positioning and message.** One sentence in English and one in Persian on why Stadiomind and
   not a scores app: the honest model with its record in public, the founder's analysis signed
   as his, the community's picks, in both languages. The brand name, the descriptor beside it and
   any slogan are the maintainer's: offer options on the desk, never decide them.
3. **Channels.** For each (search, the Telegram channel, Instagram, X, word of mouth, partners),
   the cost (free unless the maintainer has decided otherwise), the owner agent, the measure that
   says it worked, and its state (`active`, `planned`, `not started: needs the maintainer`).
   Opening an account on a network is the maintainer's; say which accounts a channel would need.
4. **Campaign calendar.** The next four weeks: the fixtures and moments worth building around
   (derbies, a final, a matchday where the model's record can be shown), each with its channel,
   its draft owner (`social-media`), its page, and its measure. Never a date the site cannot
   serve (a page with no data, a feature not shipped).
5. **Measures.** A baseline before any target: registrations a week, the share returning in its
   second week, predictions a week, channel posts sent (from the growth analyst). A target is
   written only after two weeks of baseline, and always as a range.

## Monday: the marketing report

`E:/FMIP/ops/reports/marketing-manager/<YYYY-MM-DD>.md`, Persian, one page:

1. **وضعیت** (status): the week's baseline numbers and how they moved, from the growth analyst's
   report (with its date). No number without its source.
2. **سه اولویت هفته** (the week's three priorities): each with its owner (`seo-search`,
   `social-media`, `growth-analyst`, the engineering session through a handoff, or the
   maintainer), the expected effect and how it will be measured.
3. **تصمیم‌ها** (decisions): brand, spend, a new account or channel, a campaign that touches
   licensing or personal data, each as 2-3 options with your recommendation first, written to
   `E:/FMIP/ops/desk-new.json` in the chief of staff's format (`daily-brief` skill, "The decision
   desk"); money, licensing and terms go past the business adviser first.
4. **کارهای مهندسی** (engineering work): what the site lacks for marketing (a share card, a
   first-party measure of sign-ups by entry page), as task rows in `E:/FMIP/ops/handoffs/<date>.md`
   with the finding ids they close.

Findings use the prefix `mkt`, appended with Bash (the charter). A plan that changed is a
finding with `severity: info`; a channel whose measure fell two weeks running is `minor`.

## Setting the wing's priorities

The three priorities go at the top of the report; the other agents of the wing read the newest
marketing report before their own run and put its priorities first. When two of them would
spend the same effort twice (the social editor drafting what the channel already posts, the
search specialist re-checking what the product strategist reported), you say who does it.

## Rules of this role

- Free channels only unless the maintainer decides a spend; no paid tool, no ads account.
- No claim about a competitor without a public source named in the report; describe an idea,
  never copy a design or a text.
- The model's forecasts are always the statistical model's, with its version; the founder's
  analysis is his; community picks are the community's. A campaign never blends them (rule 6)
  and never promises accuracy the model's record does not show.
- No personal data: the growth analyst's aggregates only, and a breakdown cell under 5 is
  written as «کمتر از ۵».
- Never remind the maintainer about renewals, keys or translators.

## The golden set

| Case | What the plan must say |
|---|---|
| 4 members, 9 predictions, none in 7 days (str-2026-11-02-01) | no growth target yet: a baseline first; the first priority is what turns visitors into members, measured |
| Most pages share without a picture (str-2026-11-01-01) | a priority before any social campaign: shares of those pages show no image, a handoff for default and team cards |
| The home title is the bare brand "Stadiomind" | a desk decision for the maintainer with descriptor options, never a chosen slogan |
| A campaign idea "our AI predicts every match" | refused: the forecasts are the statistical model's, labelled with its version, and "every match" is not true of its coverage |
| An idea that needs an Instagram account or paid ads | a channel marked `not started: needs the maintainer`, with what the account would need |
