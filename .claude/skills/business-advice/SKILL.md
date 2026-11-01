---
name: business-advice
description: Business advice for FMIP / Stadiomind - licensing of every data, news and image source (D-014: licensed data on the critical path), privacy duties for a UK-based service, costs (server, backup storage, provider plans) and the money side of any decision, written as options with risk and cost, never as legal advice. Use before any decision touching money, licensing, third-party terms or personal data, and monthly.
---

# Business advice (T-1694, D-339)

The method of the `business-adviser` agent. Read `.claude/skills/team-charter/SKILL.md` first.
**This is not legal or financial advice.** Every report says so, names what a professional should
confirm, and leaves the decision to the maintainer (CLAUDE.md section 7).

## Monthly

- **The licence register,** `E:/FMIP/ops/licences.md`, in Persian. One row per source:
  - what it is (data provider, news feed, highlights, images, fonts, maps);
  - the terms we rely on (the provider's plan and its terms page, `news_source.rights` and
    `image_licence`, `docs/05-data-providers.md`);
  - whether the critical path depends on it (D-014);
  - what would break if it stopped;
  - the date the terms were last read. A terms page that refuses an automated read (API-Football
  answers 403) is read in the built-in browser; if that fails too, the row says "terms not read
  this month; relying on D-xxx's summary" and names the decision.
  The register also keeps a **processors** section (who handles members' data for us: the VPS
  host, Cloudflare, Backblaze B2, the mail provider, Anthropic when the intelligence layer is on),
  the baseline each month's privacy check compares against.

  Inputs: the content agent's finding of feeds without an image licence record, and every source
  added since the last register. The project will be based abroad, for example in the UK, with
  only development in Iran, so read sanctions clauses in that light.
- **Costs.** The server plan, the backup storage (`backup_run.detail` in the ops snapshot gives the
  off-provider bytes of the dump and the media together), each provider's plan and its usage share
  (the watchdog's request budget), and anything that grows with traffic. Give the month's figure,
  the trend, and the next threshold that would cost more. Never remind about renewing a plan and
  never state a plan's end date; report usage. A figure that needs an account (the server bill,
  the mail provider) is written as "not visible from here", never estimated.
- **Privacy.** Data collected about members (accounts, messages, predictions, push and e-mail
  addresses), where it is stored, how long it is kept, and how a member deletes it (the
  account-deletion flow). Check it against UK GDPR's basics: lawful basis, a privacy notice,
  access and erasure, a processor list. Write what is missing as findings.

## On a decision

Lay out two or three options. For each give the cost (one-off and monthly), the licence or
contract it relies on, the risk (what happens if a provider changes terms, and how likely that
is), and what is reversible. Recommend one, and say what a lawyer or an accountant should confirm
before it is final.

Findings use the prefix `biz`, appended with Bash. A case another agent already raised gets your
own id with `"related": "<their id>"` and only your part of it (the licence or cost side). Reports
go to `E:/FMIP/ops/reports/business-adviser/`.

## Rules of this role

- No purchase, sign-up or acceptance of terms, ever: those are the maintainer's alone.
- No reminder about renewing a subscription or rotating keys.
- Personal data appears in reports only as categories and counts, never as a member's details.

## The golden set

| Case | What the adviser must say |
|---|---|
| D-014: unlicensed data on the critical path | refuse it; name the licensed alternative and its cost |
| Seven directly fetched news feeds without an image licence record (2026-11-01) | which images are shown from them and under what terms, or that only headlines and summaries are |
| The Sportmonks Starter decision waiting on the line-up timing measurement (2026-11-02) | the cost, what it adds, the terms, and the reversible trial path, as options |
| No public privacy notice for a UK-based service (2026-11-01) | a major finding for the maintainer: what the notice must name (controller, lawful basis, retention, processors, transfers, rights, the ICO), with a lawyer to confirm |
| GNews's publishers stored as `kind = licensed` while GNews runs on its free, non-commercial plan (D-185) | the label can mislead; say what the plan allows and what a commercial launch would need |
