# Phase 8 — Run it like a live product, and keep the promises still open

Phases 1 to 7 built the product the blueprint describes, put it on a live
server with fifteen competitions, and gave it a face and a console. What it
does not have yet is **a way to know it is broken before a member says so**,
**the account rights its own rules promise**, and **a handful of blueprint
promises that were never started** -- match alerts for followed teams above
all. A comparison of `product-blueprint.md`, the published rules
(`13-policy.md`) and the live server's needs against what is built
(2026-09-28) found three kinds of gap, and Phase 8 is those:

- **Operations.** Health endpoints exist (D-044: `/health`, `/health/ingestion`,
  `/health/live`, chat health) and `check-setup.sh` reads them, but nothing
  *watches* them: a stalled ingest or a failing job is found by whoever looks.
  The administration area shows coverage, freshness, ingestion and the rating
  configuration (`AdminOverview`), not the system health, API errors, job
  failures and notification delivery blueprint 16 lists, nor the account,
  prediction, rating, chat and notification activity blueprint 19 requires to
  be "observable from the administration system". The restore drill (D-032)
  is a monthly manual step. Login and forgot-password have no rate limit
  (D-026 deferred it "to T-071's operational work", and it was never built).
  No page has a performance budget.
- **A member's account.** `13-policy.md` §4 ("Leaving") tells every member
  "You can delete your account"; there is no way to do it.
- **Blueprint promises not started.** Match alerts (12.2: kick-off, line-up,
  goal, red card, half-time, full-time) are not notification kinds at all;
  the match centre has no competition context or key players (4.2); articles
  cannot be saved (3.3, 2.1); leaderboards are not per competition or per
  language (9.3); minimum-minute filters and minutes on the squad (5.1, 5.2)
  wait on minutes the store already holds. Plus the known small defects.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**Watching stays inside the stack (D-044).** Nothing here adds an error
tracker, a log shipper or a metrics vendor. Counts are rows in Postgres or
keys in Redis, checks are BullMQ repeatable jobs or systemd timers like the
backup's, and an alert reaches administrators through channels that already
exist: the inbox, Web Push (on in production since 2026-09-27) and e-mail
when SMTP is configured (D-073). **The one thing the stack cannot do is
notice that its own machine is down** -- a check on the VPS dies with the
VPS. That needs something off the machine, which is an account somewhere,
and is listed below as the maintainer's (T-806), not built around.

**Counts, not tracking.** The activity page (T-807) counts events from our
own tables per day. It records nothing about a member that the product did
not already store, sets no cookie, and loads no third-party script.

**Every product rule this phase needs is small, and most are covered by the
standing delegation** (the maintainer's "decide yourself" of 2026-09-26, as
with D-089 to D-092): an agent proposes, records a revisable decision entry,
and builds. Anything that needs a purchase, an account or a secret is not
delegated and is listed as the maintainer's.

**Measurements from Phase 6 stay in Phase 6.** T-501 (the request budget on a
real match day), T-504 (fifteen competitions on a phone on a real Saturday)
and T-535 (promotion of the candidate model on its own pre-kick-off record)
are open in `04-tasks-phase-6.md` and are ticked there. Phase 8 does not
repeat them; The watchdog (T-801) reads the budget T-501 set; nothing else here touches them.

**Nothing here buys, opens an account, or holds a secret**, except T-806.

---

## Exit criteria

- A stalled ingest, a live match that stops moving, a failing job, a failed
  backup or a failed restore drill reaches an administrator's device within
  minutes, without anyone looking.
- The admin console has a System page (health, API errors, job failures,
  notification delivery, backup and drill) and an Activity page (registrations,
  predictions, settlements, messages, notifications per day).
- Login, registration and password reset are rate limited; every public write
  has a stated ceiling or a stated reason for none.
- A member can delete their account, and every other member's rating is still
  recomputable afterwards (rule 8).
- A member who follows a team is told about its kick-off, line-up, goals, red
  cards, half-time and full-time, within their quiet hours and limits.
- The scores page, the match centre and the competition page have budgets that
  CI enforces, and axe is at zero on every error page.

---

## E80 — Watching the live product

*Agent-doable, except T-806 (needs the maintainer: an account).*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-800 | This plan | — | `04-tasks-phase-8.md` and the roadmap's Phase 8 section merged |
| `[ ]` T-801 | A watchdog: a repeatable job that evaluates the health views on a schedule (last successful ingest per job, live fixtures past their freshness threshold, the day's request budget, failed jobs, the last backup) and raises an alert when a condition starts and a recovery when it ends | T-071, T-026, D-045 | One alert per incident, not one per tick; each condition, its threshold and its state are readable at an endpoint; unit tests per condition, an integration test through the queue |
| `[ ]` T-802 | Alerts delivered to administrators: a notification kind for the administrator role, through the inbox and Web Push, and e-mail when SMTP is configured | T-801, T-330 | An administrator's device receives a stalled-ingest alert in a rehearsal on the server; a deployment with no channel but the inbox says so on the System page (never "sent" when nothing was) |
| `[ ]` T-803 | API errors and job failures counted: 5xx responses per route and failed BullMQ jobs per queue, per hour, kept for 30 days | T-071 | The request id of the newest failure per route is kept so the log line can be found; no stack or request body leaves the log |
| `[ ]` T-804 | The System page in the admin console: health views, the watchdog's conditions, error and job-failure counts, notification delivery outcomes by channel, and the last backup and drill | T-801, T-803, T-805 | Blueprint 16 ("system health, job failures, API errors and notification delivery"); each section states "nothing recorded" and "cannot be shown" separately |
| `[ ]` T-805 | The restore drill on a timer: `restore-drill.sh` runs from the off-provider copy on the first Monday of each month (D-032) and the backup and drill results are recorded where the API can read them | T-072 | A failed drill raises a T-801 alert; `07-backups.md`'s monthly checklist names the timer; the first timed run on the server is recorded in the handoff |
| `[ ]` T-806 | **Needs the maintainer:** a check from outside the machine that `https://traveltohormuz.ir/health` answers, alerting the maintainer when it does not | maintainer | A decision entry names the service; the maintainer opens its account; no secret in the repository |
| `[ ]` T-807 | Activity counts for the admin console: registrations, verifications, predictions submitted, settlements, rating snapshots, messages, reports and notifications delivered or failed, per day, from our own tables | T-052, T-070 | Blueprint 19 ("observable from the administration system"); aggregates only, no per-member series; a test proves a deleted account's rows still count without its name |
| `[ ]` T-808 | Performance budgets: first-load JavaScript and server response time for the scores page, the match centre and the competition page, written down and checked in CI | T-605, T-073 | A budget exceeded fails CI with the route and the numbers; no new dependency (the build's own output and the existing load harness, `08-load-test.md`) |
| `[ ]` T-809 | Every error page carries `lang` and `dir`: a not-found and an error boundary inside the locale, and a global error page | T-005, T-081 | axe `html-has-lang` at zero on `/en/competition/<id>` without a season and on an unknown route; the RTL test covers `/ar`'s not-found |

## E81 — Security and a member's account

*Agent-doable; T-812 waits on a small product decision (see below), which the
standing delegation lets an agent propose.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-810 | Rate limits on login, registration, forgot-password and email verification, per address and per account, on the existing `rate_limit` mechanism | T-040, T-213 | The limit D-026 deferred; a refused attempt says when to try again and never says whether the account exists; security tests for each |
| `[ ]` T-811 | A rate-limit inventory: every public write, its ceiling, and the reason for any write without one, in `13-policy.md` or a new section of `02-architecture.md` | T-810 | Gaps found are fixed in the same PR or given their own task; the admin System page (T-804) shows refusals per limit per day |
| `[ ]` T-812 | Delete my account: from Settings, confirmed by password, signs out every session, removes the profile, follows, friendships and credentials, and keeps predictions and settlements as records without the name (`13-policy.md` §4) | T-040, decision N-3 | Every other member's rating recomputes to the same value afterwards (rule 8); an audit row; the username is not reusable; group ownership is handed over or the group closed, per D-057 |
| `[ ]` T-813 | Security tests for the Phase 7 console and member settings: every admin page's API refuses a non-administrator, every settings write refuses another member's session | T-610–T-613, T-620–T-621 | Blueprint 19 ("security tests cover ... administrator actions"); one test per write |

## E82 — The feed checked, and the football pages fixed

*Agent-doable.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-820 | Data-quality checks after each ingest: a finished match without a full-time score, goals in the timeline that disagree with the score, a live match far past its expected length, a line-up that is not eleven, one provider id on two fixtures, a table that disagrees with the results (D-038) | T-026, T-035 | Each finding is a row naming the fixture and the check; nothing is corrected automatically; unit tests per check against recorded fixtures |
| `[ ]` T-821 | Data-quality findings on the admin console and in the watchdog: open findings per competition, and an alert when a live match's data contradicts itself | T-820, T-801 | Blueprint 16 ("correction and manual review tools"); a finding can be marked reviewed with a reason (audit row) |
| `[ ]` T-822 | The player page's match log reads the after-extra-time score before the 90-minute one, as the team page does since #317 | — | `player-store.ts` orders the score kinds like `team-store.ts`; a test with an extra-time fixture where the two differ |
| `[ ]` T-823 | Minutes in `PlayerSeasonRecord`, from `fixture_player_stat`, and in the two-player comparison | T-101, T-631 | T-631 shows minutes where the feed supplied them and `not_supplied` only where it did not; a season with some matches missing minutes is `limited`, never a smaller number presented as whole |
| `[ ]` T-824 | A minimum-minutes filter on the competition's leaders, and minutes played on the team's squad | T-823 | Blueprint 5.1 and 5.2; the filter's value is in the URL; a squad member with no minutes recorded says so |

## E83 — Match alerts (blueprint 12.2)

*Agent-doable. Push is on in production; e-mail waits on SMTP, which the
product already states.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-830 | Match notification kinds: kick-off, line-up confirmed, goal, red card, half-time and full-time, raised from the incidents the live path already records, for members following the match, either team or the competition | T-026, T-271 | One notification per event per member, never two for a corrected incident; a disallowed goal sends a correction, not silence; deep link to the match (12.2) |
| `[ ]` T-831 | Controls for match alerts: which events, per followed team and per competition, inside the existing quiet hours and frequency limits, as new categories in the controls T-331 built | T-830, T-331, T-273 | Blueprint 12.2 ("per-team controls, competition controls"); off by default except kick-off and full-time for followed teams (a decision entry says why) |
| `[ ]` T-832 | Line-up and availability alerts, and "a friend predicted an important match" (8.1), opt-in | T-830 | A friend's prediction is sent only if that friend's visibility allows the recipient to see it (D-063) |
| `[ ]` T-833 | Editorial notifications: founder analysis published for a followed match or team; a community analysis's review status to its author; a member becoming eligible for contributor review, to administrators (18.3) | T-250, T-261, T-271 | Each deep-links to the analysis, the draft or the admin contributors page |
| `[ ]` T-834 | The match-alert load measured: a Saturday of goals across fifteen competitions through the notification queue, with the delivery time recorded beside `08-load-test.md` | T-830 | A goal reaches a device within the stated time at the measured load, or the gap is written down with its cause |

## E84 — The rest of the blueprint's pages

*Agent-doable.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-840 | The match centre's competition context: both sides' table positions (or group, or bracket round) before the match | T-035, T-630 | Blueprint 4.2; a cup tie with no table says which round it is, never an empty table |
| `[ ]` T-841 | The match centre's key players: each side's most-used players this season, their minutes, goals and assists, and whether they are available | T-823, T-103 | Blueprint 4.2; "key" is a stated rule (most minutes in the competition), not a judgement; a doubt is shown as a doubt |
| `[ ]` T-842 | Save an article: a save control on the news cards and the story page, and a Saved list under Following | T-143, T-144 | Blueprint 3.3 and 2.1; a saved item whose source was dropped says so, not a dead link |
| `[ ]` T-843 | Leaderboards by competition, from the per-competition ratings T-640 already computes | T-055, T-640, T-641 | Blueprint 9.3; the minimum-sample filter applies per competition (D-037) |
| `[ ]` T-844 | Leaderboards by language (the member's preferred language) | T-641 | Blueprint 9.3; a language with fewer established members than the floor says so |

---

## Needs a decision

None of these is a task yet. Each needs a decision entry first; the note says
whose.

1. **N-1 — An off-machine uptime check (T-806).** *The maintainer's: an
   account.* A free external monitor or a check from another machine the
   maintainer owns. Everything else in E80 works without it; without it, the
   VPS being down is still found by a person.
2. **N-2 — Point-in-time recovery.** D-032 named WAL archiving "the right
   answer once user predictions and reputation carry weight". It adds a
   component (WAL-G or pgBackRest) and more off-provider storage, which is a
   new infrastructure dependency (`CLAUDE.md` §2) and possibly a cost. *The
   maintainer's* if it costs; otherwise an agent can propose it.
3. **N-3 — What deleting an account removes besides the profile.** The
   policy settles predictions (kept, unnamed). It does not settle messages
   in direct and group chats, public panel posts, published community
   analysis, or reports the member filed. Proposal: messages and panel posts
   kept as "a deleted member", analysis unpublished, reports kept for the
   audit. *Covered by the standing delegation*; the policy text changes
   (`13-policy.md`) follow the "told before it applies" rule in §4.
4. **N-4 — A copy of my data.** Blueprint §7 does not ask for an export;
   privacy law in some members' countries may. *The maintainer's*, because
   it is a legal question (`CLAUDE.md` §7).
5. **N-5 — Predicted line-ups (4.2).** The feed supplies confirmed line-ups
   only; a predicted one needs a source with rights for it (D-014). *The
   maintainer's* (licensing).
6. **N-6 — Women's and youth football (4.1 filters).** The filters mean
   nothing until such competitions are in the catalogue, and each one spends
   the daily request budget (T-501). *The maintainer's*, as a choice of
   competitions.

**Not in Phase 8, by earlier decision:** a native app (D-084); uploads,
avatars as images, an abuse-language classifier, and SMS (D-054, Phases 4
and 5); machine translation of anyone's words (D-061, 13.2); monetisation;
licensed full-text news (D-061); video embeds or thumbnails (D-069). None is
essential to a blueprint promise Phase 8 keeps.
