# Roadmap

Phases are vertical slices. Each one is independently shippable and leaves the
product coherent. See D-001.

---

## Phase 0 — Foundation *(current)*

Repository, monorepo skeleton, local Docker environment, CI, base apps, shared
types, i18n + RTL scaffolding.

**Exit criteria:** `docker compose up` runs Postgres, Redis, API and web
locally; CI is green on an empty-but-typed codebase; an RTL pseudo-locale route
renders.

---

## Phase 1 — Data core + prediction core

The launch slice.

| Area | Contents |
|---|---|
| Ingestion | Provider adapters, bake-off harness, canonical entity resolution, scheduled jobs, coverage profiles |
| Public read | Scores list, match centre, competition / team / player pages, basic search, SEO surface |
| Live | SSE channel for scores and incidents, freshness indicators |
| Accounts | Registration, verified email, login, profile, privacy settings, favourites |
| Predictions | Submission, kick-off lock, settlement, prediction history |
| Reputation | Performance Rating, Career Points, leaderboards with minimum-sample filters |
| Model | Historical ingestion, baseline forecast model, backtesting, versioned forecasts, explanation panel |
| Ops | Minimal admin, monitoring, freshness alerts, backups, load test |
| Delivery | PWA, accessibility pass, deployment |

**Exit criteria:** the acceptance list in `docs/04-tasks-phase-1.md` passes on a
public deployment with real fixtures.

*Signed 2026-09-19 (D-071), conditional on a re-check with real fixtures on
the first real deployment.*

---

## Phase 2 — Depth on football intelligence

- Paid data tier upgrade; xG and advanced statistics.
- Full Power Index with the blueprint's weighting, validated against history.
- Forecast version comparison ("what changed after the confirmed lineup").
- Founder's analysis editorial area.
- News feeds and story clustering.
- Arabic added — the first real use of the RTL work from Phase 0.

Planned in detail in `docs/04-tasks-phase-2.md`, which orders the epics so that
the two things nobody but the maintainer can unblock — a purchase and a
licensing decision — sit in front of the smallest possible amount of work.

## Phase 3 — Community

- The social graph: friends, requests, blocks.
- Moderation: reports, sanctions, the queue and its audit history.
- Conversations: direct and group chat, persisted and ordered, then delivered
  over WebSockets.
- User-created and exclusive groups, with their own leaderboards.
- Public match discussion with approved contributors.
- Community-written analysis workflow.
- In-product notifications (push and email delivery are Phase 4).

Planned in detail in `docs/04-tasks-phase-3.md`. **Moderation moved from last to
second (D-053):** every earlier phase talked to a reader, and this one carries
one member's words to another, so the exits — block, report, mute, leave — are
built before the first surface that needs them rather than in a closing epic.
Nothing in the phase needs a purchase or a licence; what it needs from the
maintainer is policy (the platform rules, the conduct categories, the
contributor thresholds and the approvals themselves). D-054 records the three
things it deliberately does not build.

## Phase 4 — Reach

- Remaining launch languages.
- Watch and highlights (requires licensed broadcast data).
- Native mobile via Expo, reusing the same API and shared types.
- Notification campaigns and personalisation depth.

**Planned in `04-tasks-phase-4.md`** (2026-09-15, at the maintainer's request,
while Phase 3 is still being built). Four epics, eighteen tasks. Three of the
four bands are blocked on the maintainer -- translators, a broadcast licence,
store accounts -- so the plan separates what is buildable before each blocker
clears from what is not, the way D-061 let the news schema proceed without the
licence. **E25, E26 and E27 come first**; E27 in particular, because it is what
Phase 4's outward delivery delivers.

## Phase 5 — Intelligence layer

- LLM-assisted features: match summaries, natural-language search over football
  entities, personalised briefings, moderation assistance.
- Deferred deliberately: these are most valuable once the canonical data model
  and the reputation signal already exist.

**Planned in `04-tasks-phase-5.md`** (2026-09-19, at the maintainer's request).
Five epics, fifteen tasks, one blocker: a language model is a provider behind
a port, chosen at deployment by a key on the server (T-400), so fourteen of
the fifteen are buildable with nothing from the maintainer and every surface
has an honest sentence for the absence. The four rules every surface obeys --
labelled, grounded, versioned, off the critical path -- are D-070.

## Phase 6 — Breadth, first members, a better model

- More leagues: six domestic leagues the training data covers, and the Europa
  and Conference Leagues.
- Iran's Persian Gulf Pro League, forecast from its own history as the feed
  recorded it (D-083).
- The first members: share cards, a share control, invite links, a page for a
  first visit, and a Telegram channel once the maintainer creates one.
- A second model version, run in shadow and promoted only on the evaluation.

**Planned in `04-tasks-phase-6.md`** (2026-09-26, at the maintainer's request,
the day after the first real deployment). Four epics, twenty tasks, three
gates that are the maintainer's: the Iranian league's history (T-511), the
Telegram channel (T-524), and the feed's plan continuing past 2026-10-21.

**Where it stands (2026-09-26, evening).** T-511 is answered (D-083): the
model learns from the feed's own records. Built and on the server: fifteen
competitions with their season schedules; share cards, share control,
invites, the first-visit page and the homepage; Iran's league in the model
(backtested, first forecast when 8 October enters the window); the second
model as candidate `dixon-coles-elo@0.4.0` in shadow -- tuned constants per
division and cup matches on one scale across leagues (D-085) -- with the
line-up term (D-086) built and waiting for a season of line-ups to be fitted
on; the daily channel post, off until the channel exists. What is left is
measured on real match days (T-501, T-504), earned by the candidate's own
record (T-535), or the maintainer's: the channel (T-524) and the plan.

## Phase 7 — A face, a console, and the rest of the blueprint

- A visual identity and a design system: a mark, tokens, a chosen theme, and a
  font that renders Persian and Arabic.
- The operator's console on the web: moderation, contributors, featured
  matches and the debate without `curl`.
- Onboarding, deeper football pages (brackets, player comparison), and the
  reputation and search surfaces the blueprint promises and Phase 3 left
  partial.

**Planned in `04-tasks-phase-7.md`** (2026-09-27, at the maintainer's request,
from a comparison of the blueprint against what is built). The identity (E60)
waits on the maintainer's answers; the console (E61) goes first because it
needs nothing from anybody.

**Where it stands (2026-09-28).** Every task in `04-tasks-phase-7.md` is built, merged and on the server (#305-#334): the web console for moderation, contributors and featured matches; knockout brackets, player comparison, team splits and scores filters; rating history, period leaderboards, wider search, achievements and group polls; the first-run flow; and the identity -- mark, self-hosted Vazirmatn, tokens with a light/dark/device theme, shared components, text size, contrast and motion settings, and a mobile-first scores page and match centre. The identity choices were delegated by the maintainer and are recorded as revisable (D-089 to D-092).

## Phase 8 — Run it like a live product, and keep the promises still open

- Watching the live server from inside the stack: a watchdog over the health
  views, alerts to administrators' devices, counted API errors and job
  failures, a System page and an Activity page in the console, the restore
  drill on a timer, performance budgets in CI, and error pages that carry
  their language.
- Security and a member's account: rate limits on sign-in and recovery, an
  inventory of every write's ceiling, and deleting an account as the
  published rules promise.
- The feed checked for contradictions, and the football pages fixed and
  deepened: the player log's extra-time score, minutes in a player's season,
  minimum-minute filters.
- Match alerts for followed teams (blueprint 12.2), and the pages the
  blueprint still promises: competition context and key players in the match
  centre, saved articles, leaderboards by competition and by language.

**Planned in `04-tasks-phase-8.md`** (2026-09-28, from a comparison of the
blueprint, the published rules and a live server's needs against what is
built). Five epics, twenty-eight tasks after this plan. Everything is buildable
by an agent except an off-machine uptime check (T-806), which needs an
account; six questions are listed under "Needs a decision" rather than
planned as tasks. Phase 6's measurements (T-501, T-504, T-535) stay where
they are.


**Where it stands (2026-09-28).** Every agent-doable task in `04-tasks-phase-8.md` is built, merged and on the server (#338-#374): the watchdog, admin alerts, failure counts and the System, Activity and data-quality pages; a monthly restore drill on a timer (first drill passed); performance budgets and console security tests in CI; sign-in and per-write rate limits with an inventory; account deletion; error pages; match, line-up, friend and editorial notifications, moved off the live job and measured; saved articles; minutes, competition context and key players; leaderboards by competition and language. What remains is the maintainer's: an uptime check from outside the server (T-806, N-1) and the decisions N-2 to N-6.

## Phase 9 — Carry the load, repair the record, and finish the pages people see first

- Delivery at the scale the product will meet: a kick-off of 90 matches to
  10,000 following members within the 60 s target, campaigns emitted
  set-based like match alerts, and the send pool sized for the server.
- Contracts that agree: one `forbidden` code for every 403, and "a deleted
  member" wherever a member is named, in every locale and right to left.
- The past seasons' 2,447 data-quality findings diagnosed, reviewed in bulk,
  re-asked of the feed where that can repair them, and reflected in each
  season's declared coverage.
- The model's inputs kept honest: Club Elo's absence shown and alerted, an Elo
  prior from our own records in a shadow candidate (within D-014), the
  line-up term fitted and the Power Index's line-up weights validated once the
  2025/26 line-ups are loaded, and the Phase 6 measurements on real match days.
- The pages people see first, completed: the scores card's forecast,
  community and viewing summaries, the story page's share, follow and
  prediction links, the member's homepage, leaders beyond goals, the team's
  manager and news, following a match, and achievement unlocks as
  notifications.

**Planned in `04-tasks-phase-9.md`** (2026-09-28, after a week of running the
live server, from a comparison of the blueprint and the published rules
against what is built). Five epics and thirty tasks (this plan included), plus Phase 6's
three measurements carried. Decision numbers D-106 to D-122 and migration
timestamps from `1764840000000` are assigned in the plan, so parallel agents
do not collide. Everything is buildable by an agent. Two tasks are applied
only on the maintainer's yes: the origin answering only Cloudflare (T-930)
and the rules version with its backfill (T-931). Two of its tasks and Phase 6's three wait for club
matches, which resume on 2026-10-08, and two wait for the past-season
backlog. Eight questions are listed under "Needs a decision".

## After Phase 9 — outline

Not planned as tasks. Each bullet becomes a task file when its phase starts,
from the blueprint and whatever operation has taught by then.

**Phase 10 — News depth and community depth.**

- Story types from the publisher's own category where the feed carries one;
  news filters by story type, player and date (3.2); an editor's "breaking"
  mark with an opt-in alert and a homepage strip (2.3, 12.2); transfer and
  injury alerts for followed teams (12.2). Machine labelling waits on
  Phase 9's N-8.
- News linked to players, so that the player page has related news (5.3).
  This needs a person-linking rule the clustering deliberately does not have
  today (T-142).
- Trending that counts saves beside discussion (3.1).
- The translator's desk on the web for article versions (T-304 has the API
  only), with automatic checks that numbers, scorelines, entity names and
  links survive a translation, and a shared glossary (13.1, 13.2). The
  tooling only: the words stay the translators' (T-305).
- Groups: invite links, an owner's rule on who may invite, and membership
  rules (8.2). Administrators closing a group and removing group content with
  a reason (10.4). Panel posts linked to an incident, a player or a
  prediction (10.2).
- A contributor whose rating stays below the threshold for a sustained period
  is flagged to administrators, never paused automatically (9.4).

**Phase 11 — Model depth and the console's configuration.**

- The model inputs blueprint 6.3 lists and the model does not yet read: rest,
  travel and fixture congestion; competition context (also the Power Index's
  unmodelled 5%); manager changes; head-to-head, only if the backtest shows it
  adds value. Each is a shadow candidate, promoted on its record (D-082).
- Rating thresholds set from the console as versioned rows, if Phase 9's N-7
  is answered that way. Homepage ordering, and language and territory
  settings, in the console (16).

**Waiting on the maintainer, in no phase until answered:** Phase 8's N-1
(T-806), N-2 (point-in-time recovery), N-4 (a copy of my data), N-5 (predicted
line-ups) and N-6 (women's and youth football); Phase 9's N-3 to N-6 and N-8;
the language model's key (T-400) and the Telegram channel (T-524).

**After Phase 11, nothing in the blueprint is left unplanned** except what an
earlier decision declined: a native app (D-084), uploads (D-054), machine
translation of members' words, licensed full text and video (D-061, D-069),
and a tracing vendor (D-044). From then on the work is operation, and a new
phase starts only from a new decision or what running the product finds.

---

## Sequencing rule

Within any phase, build in this order:

1. Schema and contracts
2. Ingestion / data availability
3. Backend module + tests
4. API contract published to shared types
5. Frontend
6. Observability for the new surface

Never start step 5 before step 4 is stable. This is what keeps the layers
independent.
