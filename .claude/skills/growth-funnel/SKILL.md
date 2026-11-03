---
name: growth-funnel
description: Growth analytics for FMIP / Stadiomind from the site's own database - the sign-up funnel, weekly cohorts and retention, active members, follows, push and the community-prediction activity, the channel's own output - as aggregate counts with a minimum cell of 5, and an honest list of what is not measured (where visitors come from). Use for the weekly growth read, before and after a campaign, or when growth is discussed.
---

# The growth funnel (T-1721, D-349)

The method of the `growth-analyst` agent. Read `.claude/skills/team-charter/SKILL.md` first, above
all "The marketing wing", and the newest marketing report's priorities
(`E:/FMIP/ops/reports/marketing-manager/`).

## What the database can and cannot say

- **Can:** accounts and their state; when a member registered, verified the e-mail and finished
  the first run (`user_account`); follows (`followed_entity`, `member_follow`); push
  (`push_subscription`); predictions and their edits (`user_prediction`, `prediction_version`);
  groups and community analyses; when each session was last seen (`session.last_seen_at`, and
  its user agent, read only as phone, tablet or desktop); the channel's own posts
  (`channel_post`: what was sent, not who read it).
- **Cannot:** page views, visitors who never register, the page or link a member arrived from,
  the channel's subscribers or a post's views, search impressions. The site stores none of it,
  and there is no tracker. Say so in every report as `not_supplied` (CLAUDE.md rule 3), never
  estimate it.
- **A first-party measure** of sign-ups by entry page or referrer host would need a schema
  change, a privacy note and a decision: it goes to the decision desk through the marketing
  manager, past the business adviser (personal data), never as an external tool.
- `session.last_seen_at` is a floor of activity: it moves only while a session is used, and one
  member can hold several sessions. Staff accounts (`user_role`) are left out of every member
  count and shown apart.

## Weekly

1. `bash .claude/skills/data-audit/run.sh .claude/skills/growth-funnel/growth-funnel.sql`. It
   prints: accounts; the funnel (registered, verified, first run, follows, predicted, seen again
   a day later, push); twelve weekly cohorts (joined, verified, predicted in 7 days, seen 7 and
   28 days later); active members over 1, 7 and 28 days; predictions by week and in total;
   other participation; members by language, country and device with cells under 5 folded; the
   channel's posts over 28 days.
2. Compare with last week's report (`E:/FMIP/ops/reports/growth-analyst/`) and the dashboard's
   snapshot (`E:/FMIP/dashboard/out/snapshot.json`, `community`): the same totals should agree;
   a difference is explained (staff left out here) or is a finding for the data auditor.
3. Read the marketing calendar: a campaign that ran this week is judged against the baseline
   weeks before it, with the counts, and "too few to tell" when they are.
4. Write findings (prefix `gro`): a funnel step where most members stop, a cohort's return rate
   falling two weeks running, no prediction for 7 days while matches were on, a step that
   cannot be measured and matters to the marketing plan (with the first-party proposal).

Report: `E:/FMIP/ops/reports/growth-analyst/<YYYY-MM-DD>.md`, Persian: the funnel as a table
(step, count, share of the step before), the cohorts table, the predictions line, what is not
measured, and at most three findings. Whole-site totals may be given as they are; every
breakdown cell under 5 is written «کمتر از ۵».

## Rules of this role

- Read-only SQL through the runner; ad-hoc queries go in your scratchpad, never select an id,
  name, username, e-mail, IP, message or a user agent string.
- No new analytics tool, pixel, tracker or third-party script, and no proposal of one: the
  project's measures are first-party and need the maintainer's decision.
- A rate from fewer than 20 members is given with its counts ("3 of 4"), never as a bare
  percentage.

## The golden set

| Case | What the read must say |
|---|---|
| 4 members, 9 predictions, none in the last 7 days (str-2026-11-02-01) | the totals as they are, the funnel in counts not percentages, "no prediction for 7 days" as a finding, and no breakdown by country or language (every cell under 5) |
| Where do our members come from? | `not_supplied`: the site stores no entry page or referrer; the first-party proposal goes to the desk past the business adviser |
| The dashboard's `users` is higher than this read's members | explained, not a fault: the dashboard counts every account, this read counts staff (`user_role`) and suspended or deleted accounts apart |
| The channel sent its forecast post every day | the channel's output; its reach is not stored, so no claim that it brought members |
