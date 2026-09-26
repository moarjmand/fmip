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
- Iran's Persian Gulf Pro League, with a forecast only once a licensed history
  for it is chosen.
- The first members: share cards, a share control, invite links, a page for a
  first visit, and a Telegram channel once the maintainer creates one.
- A second model version, run in shadow and promoted only on the evaluation.

**Planned in `04-tasks-phase-6.md`** (2026-09-26, at the maintainer's request,
the day after the first real deployment). Four epics, twenty tasks, three
gates that are the maintainer's: the Iranian league's history (T-511), the
Telegram channel (T-524), and the feed's plan continuing past 2026-10-21.

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
