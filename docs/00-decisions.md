# Decision log

Append-only. Never edit a decided entry — supersede it with a new one and mark
the old one `Superseded by D-0xx`.

Format: **D-0NN — Title** · Status · Date · Decision · Why · Alternatives · Consequences

---

## D-001 — Deliver in vertical slices, not one complete launch
**Status:** Accepted · 2026-09-08

**Decision.** Reject the blueprint's "single complete release, every workstream
mandatory" model. Ship one complete user path end-to-end, then extend.

**Why.** The blueprint was written for a funded multi-team organisation. With one
engineer, an all-at-once launch has a very high probability of never shipping.
A vertical slice reaches real users and real feedback while preserving the
blueprint's architecture.

**Consequences.** `docs/01-roadmap.md` defines the phases. Architecture must make
later phases additive, not rewrites.

---

## D-002 — Phase 1 = data core + prediction core
**Status:** Accepted · 2026-09-08

**Decision.** Phase 1 contains: ingestion + canonical model, scores, match
centre, competition/team/player pages, accounts, user predictions, settlement,
Performance Rating, leaderboards, a baseline versioned forecast model, minimal
admin, PWA.

Explicitly **out** of Phase 1: realtime chat, groups, friends, Watch/broadcast,
highlights, full news CMS, community analysis, eight languages, native apps,
full Power Index with xG.

**Why.** The blueprint's own closing statement names the differentiator as the
link between match intelligence and earned reputation. Dropping predictions
would leave a generic live-score site.

---

## D-003 — English only at launch, RTL-safe from day one
**Status:** Accepted · 2026-09-08

**Decision.** Ship Phase 1 in English. Build i18n routing, message catalogues,
and CSS logical properties from the first commit, plus an RTL pseudo-locale
exercised in CI.

**Why.** RTL cannot be retrofitted cheaply. The safeguard costs almost nothing
now and prevents a layout rewrite when Arabic is added.

---

## D-004 — Portability outranks convenience in infrastructure
**Status:** Accepted · 2026-09-08

**Decision.** Standard PostgreSQL, containerised services, self-owned auth,
S3-compatible storage, off-provider automated backups. The whole stack must come
up with `docker compose up` on any provider.

**Why.** Provider lock-in is the failure mode that cannot be recovered from.
Accepting slightly more setup effort buys the ability to move.

**Consequences.** No provider-proprietary database features, no serverless
runtime-specific APIs, no vendor auth SDK as the source of truth.

---

## D-005 — GitHub as the single source of truth
**Status:** Accepted · 2026-09-08

**Decision.** All code, docs, and task state live in one GitHub repository.

**Why.** Free, version-controlled, and required by the primary development tool
(Claude Code on the web). No comparable alternative for this workflow.

---

## D-006 — Monorepo with shared types
**Status:** Accepted · 2026-09-08

**Decision.** pnpm workspaces + Turborepo. API contract types live in a shared
package consumed by both `apps/web` and `apps/api`.

**Why.** A contract change produces compile errors everywhere it matters, so the
agent self-corrects without a human debug round-trip. This is simultaneously the
highest-leverage quality decision and the highest-leverage cost decision.

---

## D-007 — Next.js for the web application
**Status:** Accepted · 2026-09-08

**Decision.** Next.js (App Router) + TypeScript + Tailwind.

**Why.** Deep SSR/ISR support for an SEO-dependent product; the largest and most
mature React ecosystem, which materially improves agent-written code quality;
strong i18n and PWA stories; deployable via Docker anywhere.

**Alternatives.** TanStack Start — leaner dev server and at parity on SEO
fundamentals, but less production battle-testing and a thinner ecosystem.
SvelteKit — smaller bundles, but a smaller ecosystem means building what you
would otherwise install. Astro — content-first, wrong fit for a heavily dynamic
app.

---

## D-008 — NestJS (Fastify adapter) for the backend
**Status:** Accepted · 2026-09-08

**Decision.** NestJS with the Fastify HTTP adapter.

**Why.** The blueprint defines eleven service boundaries; NestJS modules map
one-to-one onto them, which directly serves the requirements that layers stay
independent and that new features be addable cleanly. It ships first-party
support for WebSockets, scheduling, and queues.

The usual objection — boilerplate — is a *typing* cost, and typing is near-free
when an agent writes it. Meanwhile enforced structure is what prevents an
agent-written codebase from degrading. The trade-off inverts for this project.

**Alternatives.** Fastify alone (less structure to lean on), Hono (too minimal
for this much domain logic), Encore (manages infrastructure but ties us to its
platform, conflicting with D-004), Express (no type safety by default).

---

## D-009 — Python + FastAPI for the model service
**Status:** Accepted · 2026-09-08

**Decision.** The forecast model is a separate Python service behind an internal
HTTP contract.

**Why.** Statistical and ML tooling. Isolation means the model can be retrained
and redeployed without touching the platform.

---

## D-010 — SSE for scores, WebSocket for chat
**Status:** Accepted · 2026-09-08

**Decision.** Server-Sent Events for live score/incident fan-out. WebSockets
reserved for genuinely bidirectional features (Phase 3 chat).

**Why.** Score delivery is one-way. SSE traverses proxies, reconnects
automatically, and is far cheaper to fan out to many readers.

---

## D-011 — Modular monolith for Phase 1
**Status:** Accepted · 2026-09-08

**Decision.** Build the eleven service boundaries as separate modules inside one
deployable unit. The Python model service is the one exception and deploys
separately.

**Why.** The blueprint anticipates this ("even if some begin inside the same
deployable application"). Splitting later is straightforward; operating eleven
services from day one with one engineer is not.

---

## D-012 — VPS + Docker Compose, Cloudflare in front
**Status:** Accepted · 2026-09-08

**Decision.** Deploy to a VPS via Docker Compose, with Cloudflare for CDN and
caching.

**Why.** Consistent with D-004. Predictable cost, no cold starts, full control
of long-lived connections (SSE), and it runs anywhere.

---

## D-013 — Data sourcing: three-way free bake-off, then buy
**Status:** Accepted · 2026-09-08

**Decision.** Evaluate API-Football, football-data.org, and Highlightly on their
free tiers against the same fixtures for one week, measuring goal latency,
lineup availability and timing, field completeness, and error rate. Choose based
on that evidence, then subscribe to a paid tier for launch.

**Why.** Most published "best football API" comparisons are written by vendors
about themselves. Free tiers are roughly an order of magnitude below production
need, so they are a test environment, not a launch plan.

**Detail.** `docs/05-data-providers.md`

---

## D-014 — Data sourcing policy by criticality
**Status:** Accepted · 2026-09-09

**Decision.** Three tiers:
- **Critical path** (scores, live incidents, lineups, tables, entity identity):
  licensed API only, no exceptions.
- **Enrichment, degradable**: permitted with `robots.txt` compliance, rate
  limiting, aggressive caching, no reliance on the critical path, and an explicit
  `not_supplied` state when absent.
- **Offline research** (model training and validation): open datasets, licence
  respected. StatsBomb open data is non-commercial and therefore research-only,
  never inside the product.

**Why.** Scraped sources fail silently and at the worst moment, which contradicts
both the quality priority and blueprint principle 1.2. With budget available,
scraping the critical path buys nothing.

**History.** The maintainer initially preferred an unrestricted policy, then
accepted the tiered version on review.

**Enforcement.** This is not a guideline; it is checkable in code:
- Any module under `packages/ingestion/adapters/` serving the critical path must
  declare a licensed provider in its manifest. CI fails otherwise.
- Every enrichment source declares a `degradable: true` contract and must have a
  test proving the page renders correctly when it returns nothing.
- Training-only datasets live under `packages/db/training/` and are never
  importable from `apps/api` or `apps/web`. The dependency rule in
  `docs/03-project-map.md` enforces this.

---

## D-015 — xG and advanced statistics deferred to Phase 2
**Status:** Accepted · 2026-09-08

**Decision.** The Phase 1 model uses base features only. No xG-dependent
components in the launch Power Index.

**Why.** A correctly calibrated simple model beats a poorly calibrated complex
one. Adding features later is easy; recovering from a bad public model is not.

---

## D-016 — Free historical data for model training
**Status:** Accepted · 2026-09-08

**Decision.** Train and backtest on football-data.co.uk (decades of results plus
bookmaker odds, plain CSV) and Club Elo (daily European club Elo back to 1939,
free keyless CSV).

**Why.** Separates three distinct data needs — live operations, historical
training, long-term team strength — so only the first requires a paid feed.
Bookmaker odds also give an objective calibration benchmark: a model that cannot
beat the market's calibration is not ready to publish.

---

## D-017 — Pin TypeScript to 5.9 for now
**Status:** Accepted · 2026-09-08

**Decision.** The monorepo pins `typescript@^5.9.3`, not the current latest
(7.0.2). Revisit once the lint and framework toolchain catches up.

**Why.** `typescript-eslint@8` declares `typescript: >=4.8.4 <6.1.0`. Installing
TypeScript 7 would either break linting or force `--strict-peer-dependencies`
off for a genuine incompatibility. NestJS decorator emit and the Next.js
compiler plugin are also not yet verified against the 7.x native compiler.

**Alternatives.** Take TypeScript 7 now and drop typescript-eslint — rejected:
type-aware lint rules are a load-bearing part of how an agent-written codebase
stays honest, which is exactly the argument in D-008.

**Consequences.** A single version, declared once in `packages/config` and at the
workspace root. Upgrading is one place to change. Re-evaluate at T-003 (CI) and
again before Phase 2.

---

## D-018 — Prettier does not format Markdown
**Status:** Accepted · 2026-09-08

**Decision.** `*.md` is listed in `.prettierignore`. Prose is formatted by hand.

**Why.** Running Prettier over `docs/` reflows every table and inserts blank
lines after every heading, producing ~500 lines of diff that no reviewer can
read. More importantly `docs/00-decisions.md` is append-only — reformatting it
edits entries that this file declares immutable.

**Consequences.** Markdown style is a review concern, not a CI concern.
