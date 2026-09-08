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

---

## Phase 2 — Depth on football intelligence

- Paid data tier upgrade; xG and advanced statistics.
- Full Power Index with the blueprint's weighting, validated against history.
- Forecast version comparison ("what changed after the confirmed lineup").
- Founder's analysis editorial area.
- News feeds and story clustering.
- Arabic added — the first real use of the RTL work from Phase 0.

## Phase 3 — Community

- Friends, private groups, direct and group chat over WebSockets.
- Public match discussion with approved contributors.
- Community-written analysis workflow.
- Moderation, reports, sanctions, audit history.

## Phase 4 — Reach

- Remaining launch languages.
- Watch and highlights (requires licensed broadcast data).
- Native mobile via Expo, reusing the same API and shared types.
- Notification campaigns and personalisation depth.

## Phase 5 — Intelligence layer

- LLM-assisted features: match summaries, natural-language search over football
  entities, personalised briefings, moderation assistance.
- Deferred deliberately: these are most valuable once the canonical data model
  and the reputation signal already exist.

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
