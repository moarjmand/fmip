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

---

## D-019 — SWC transforms the API's tests, not esbuild
**Status:** Accepted · 2026-09-09

**Decision.** `apps/api` runs Vitest through `unplugin-swc`. Production code is
still compiled by `tsc`; this applies to the test transform only.

**Why.** NestJS resolves constructor dependencies from `design:paramtypes`
metadata, which TypeScript emits under `emitDecoratorMetadata`. Vitest transforms
with esbuild, and esbuild supports `experimentalDecorators` but has never emitted
that metadata. Without it, any test that builds a real Nest module fails to
resolve its providers — while the same code works in production, which is the
worst shape a test failure can take.

**Alternatives.** Jest with `ts-jest`, which is what Nest ships by default —
rejected because `docs/00-decisions.md` already fixes Vitest as the test runner
and running two runners in one repository costs more than one plugin. Avoiding
constructor injection in anything covered by tests — rejected: it would let the
test tool dictate the shape of the application.

**Consequences.** `@swc/core` and `unplugin-swc` are devDependencies of
`apps/api`. Two toolchains now compile the same TypeScript, so a difference
between them would show up as tests disagreeing with production; the compilers
agree on decorator metadata today, which is the only behaviour this depends on.

---

## D-020 — ESLint pinned to 9 while the Next lint stack catches up
**Status:** Accepted · 2026-09-09

**Decision.** The workspace pins `eslint@^9.39.5`. Revisit when
`eslint-config-next` and the plugins it pulls in support ESLint 10.

**Why.** T-001 installed ESLint 10, which was then the latest. Adding
`apps/web` exposed that `eslint-config-next@16` does not run on it: its bundled
parser produces a scope manager without `addGlobals`, and every lint run dies
before reporting a single rule. `eslint-plugin-react` and several siblings still
declare a peer range ending at ESLint 9.

**Alternatives.** Drop `eslint-config-next` and lint the web app with the shared
base only — rejected: `next/core-web-vitals` catches SEO and performance
regressions by hand-review otherwise, and D-007 chose Next specifically for an
SEO-dependent product. Keep ESLint 10 and skip linting `apps/web` — rejected for
obvious reasons.

**Consequences.** One version, declared in `packages/config` and echoed by each
app. Same shape as D-017: the ecosystem, not the changelog, decides when we
upgrade.

---

## D-021 — Logical-property enforcement is a lint error in two tools
**Status:** Accepted · 2026-09-09

**Decision.** Stylelint bans physical CSS properties; ESLint bans physical
Tailwind utilities inside `className`. Both are errors, in CI.

**Why.** Rule 7 in `CLAUDE.md` says layout uses logical properties. `margin-left`
is correct in English and wrong in Arabic, and nothing reveals the mistake until
someone reads the site right-to-left — long after the code was written. Review
cannot be relied on to catch a class name.

Two tools rather than one because layout lives in two places. In a Tailwind
codebase nearly all layout is class names, so a CSS-only rule would police
almost nothing; and CSS-only rules cannot see JSX. Stylelint is used with no
preset — only these rules — so it reports what it is here to report and nothing
else.

**Alternatives.** A Tailwind ESLint plugin — none tracks Tailwind 4 closely
enough to depend on yet, and a `no-restricted-syntax` selector on `className`
literals costs one rule and no dependency. Review discipline alone — rejected:
this is exactly the class of mistake that survives review.

**Consequences.** `stylelint` is a devDependency of `apps/web`. The class-name
rule matches text, so a genuinely non-Tailwind string containing `ml-` in a
`className` would need an inline disable; no such case exists today.

---

## D-022 — node-pg-migrate for schema migrations, no ORM
**Status:** Accepted · 2026-09-09

**Decision.** Schema changes are plain SQL files applied by `node-pg-migrate`,
in `packages/db/migrations/`. Each file carries an `Up Migration` and a
`Down Migration` section. No ORM owns the schema.

**Why.** D-004 makes portability the priority and forbids provider-proprietary
features; the stack table in `CLAUDE.md` names PostgreSQL and no ORM, so the
schema was already going to be SQL. A migration tool that reads SQL keeps the
schema reviewable as the thing that actually runs, rather than as a generated
artefact of a model definition. `node-pg-migrate` adds a runner and a ledger
table and nothing else.

Rule 5 in `CLAUDE.md` says database changes happen only via migrations and a
shipped migration is never edited. That is only enforceable if a migration is a
file with a name that fixes its order, which is what this tool's timestamp
prefix gives us.

**Alternatives.** Prisma — owns the schema in its own DSL and generates SQL,
which puts a translation layer between review and what runs; its migration
engine is also a heavier dependency than the problem needs. Drizzle Kit — closer
to SQL, but still schema-in-TypeScript, and adopting its query builder would be
a second decision smuggled in with the first. Plain SQL files plus a hand-written
runner — the runner is the part that has to be correct about ordering,
transactions and the ledger, and writing it is not a good use of the budget.

**Consequences.** `packages/db` owns migrations and nothing else for now. The
application's query layer is a separate, later decision. A migration missing its
down section is a test failure, not a discovery made during a rollback.

## D-023 — The repository is public
**Status:** Accepted · 2026-09-09

**Decision.** `moarjmand/fmip` is a public GitHub repository. The branch
ruleset `main-required-checks` on the default branch requires the `Verify` and
`E2E` status checks from `.github/workflows/ci.yml` to pass before a merge.

**Why.** T-003's acceptance criterion is that a PR with a type error is
*blocked*, not merely reported. GitHub enforces that through rulesets or branch
protection, and on the Free plan both return HTTP 403 for a private repository:
"Upgrade to GitHub Pro or make this repository public to enable this feature."
The maintainer chose visibility over a paid plan. The code contains no secrets
(`.env` is never committed, see `03-project-map.md`), and the product blueprint
describes behaviour, not a competitive edge that hiding would protect.

**Alternatives.** GitHub Pro — keeps the repository private for a monthly fee;
rejected for now as an avoidable recurring cost at Phase 1. Leave `main`
unprotected and rely on discipline — rejected: the whole point of T-003 is that
the gate does not depend on anyone remembering to look at CI.

**Consequences.** Anything committed is public from the moment it is pushed,
including branches and PR discussion. Provider keys, session secrets and any
licensed dataset (D-014) must never enter the tree, which was already the rule
and is now load-bearing. If the repository later returns to private under a
paid plan, the ruleset stays in place. Free public repositories also get
unlimited GitHub Actions minutes, so CI cost stops being a budget concern.

## D-024 — Enumerations are CHECK constraints, not Postgres enum types
**Status:** Accepted · 2026-09-10

**Decision.** A column with a closed set of values (`competition.kind`,
`team.kind`, `stage.kind`, `player_spell.position`, `person.preferred_foot`,
gender, age group, scope) is `text NOT NULL` under a named `CHECK (col IN
(...))` constraint. No `CREATE TYPE ... AS ENUM` in the schema.

**Why.** The catalog will grow values as coverage grows: a new stage kind, a
new competition kind. With a CHECK constraint that is `ALTER TABLE ... DROP
CONSTRAINT, ADD CONSTRAINT` in an ordinary transaction, in a migration that has
a plain down section. `ALTER TYPE ... ADD VALUE` cannot run inside a
transaction block on the versions we support without caveats, has no `DROP
VALUE`, and makes the down migration a table rewrite. Rule 5 in `CLAUDE.md`
(migrations only, shipped migrations never edited) is much easier to honour
when every change is a reversible constraint swap.

The values are also visible in `\d table` next to the column, and in the
constraint name when a bad row is rejected, which is what the T-010 check
relied on.

**Alternatives.** Postgres enum types — compact storage and ordering, neither
of which the catalog needs; rejected for the migration ergonomics above. A
lookup table per enumeration — correct but eight more tables and joins for
sets that have fewer than ten values and change rarely; rejected as weight
without benefit at this stage. Application-level validation only — rejected:
the constraint has to hold for rows written by a migration, a backfill or
`psql`, not just by the API.

**Consequences.** `packages/contracts` mirrors each set as a string-literal
union; when a value is added, the constraint and the union change in the same
PR. A CHECK constraint is per table, so `team.gender` and `competition.gender`
are two constraints that must be kept identical by review, not by the type
system.

## D-025 — Data access is plain `pg` with hand-written SQL
**Status:** Accepted · 2026-09-10

**Decision.** `apps/api` talks to PostgreSQL through one `pg.Pool`, provided as
`PG_POOL` by a global `DatabaseModule`. Each boundary module writes its own
parameterised SQL in a store class under its `internal/` directory, behind a
small interface (a "port") that the module's logic depends on. No ORM, no query
builder, no shared repository base class.

**Why.** D-022 settled that the schema is SQL applied by node-pg-migrate and
deferred the application's query layer. The first consumer, the entity
resolver (T-013), showed what the layer has to do: a handful of statements
whose correctness rests on constraints already in the schema (`ON CONFLICT`
against a named unique constraint, `RETURNING`, a partial unique index as a
lock). An ORM would restate those constraints in a second language and hide
which statement actually ran; the value of a hand-written statement is that the
review reads the same text the database executes.

The port makes the logic testable without a database and keeps `pg` out of
every file but the store. The store is then tested against the real schema,
where the SQL is the thing under test.

**Alternatives.** Prisma or Drizzle as a query layer — rejected for the same
reasons as in D-022, and because both want to own the schema they query.
Kysely (type-safe query builder over SQL) — the closest fit; deferred rather
than rejected: if hand-written SQL starts producing column-name typos that
tests miss, it is the first thing to try, and the port boundary means the swap
is per module. A shared generic repository — rejected: it turns every module's
data access into the same shape, which is exactly the coupling the module rule
in `02-architecture.md` forbids.

**Consequences.** `DATABASE_URL` is required for the API to boot; the module
refuses to guess (pg would otherwise fall back to `PG*` defaults silently).
Integration tests run where a database is reachable and are skipped visibly
elsewhere; CI has no Postgres service yet, and adding one is the next step if
a store bug ever slips through. Table names in SQL come from allow-lists in
code, never from input.

## D-026 — Passwords, sessions and e-mail tokens: built-in scrypt, opaque tokens, HMAC at rest
**Status:** Accepted · 2026-09-10

**Decision.** Passwords are hashed with Node's built-in `scrypt` (N=2^14, r=8,
p=1, 16-byte salt, 32-byte key), stored as `scrypt$N$r$p$salt$hash` so the
parameters can be raised without a migration. Sessions and e-mailed one-time
tokens are 256-bit random values held by the client; the database stores only
their HMAC-SHA256 keyed with `SESSION_SECRET`. Sessions are rows in Postgres
(`session`), not signed cookies; the cookie is HttpOnly, SameSite=Lax, Path=/,
Secure in production. Outbound e-mail goes through a `Mailer` port; the
provider is chosen with the production deployment (T-074), and until then
`LogMailer` prints the message.

**Why.** No new dependency: scrypt, HMAC and random bytes are in `node:crypto`,
and a dozen lines of RFC 6265 replace a cookie plugin. Rows rather than signed
cookies because the product needs revocation (logout everywhere on password
reset, an administrator ending a session, "your sessions" later), and a signed
cookie cannot be revoked without a row anyway. HMAC at rest because a copy of
the database must not log anyone in, and a keyed hash, unlike a plain one,
also survives the token alphabet being small. The blueprint names Redis for
sessions; that is an optimisation for a later phase when session reads are the
hot path, and the row is the source of truth either way.

**Alternatives.** argon2id — the better algorithm on paper, but a native
dependency to build on every platform we ship to, for a difference that does
not matter at our scale; revisit if the threat model changes. bcrypt — older,
72-byte input limit, no memory hardness; rejected. JWT sessions — stateless
but not revocable, and every claim in them is a copy of a row that can go
stale; rejected. `@fastify/cookie` and Passport — fine libraries, but each
attribute of the session cookie and each step of the login is a security
decision that should be readable in this repository, not in a default.

**Consequences.** `SESSION_SECRET` (≥ 32 characters) is required at boot;
rotating it signs everyone out and voids unused e-mail links, which is the
intended emergency lever. `WEB_BASE_URL` is required for e-mail links.
Rate-limiting login and forgot-password is not in this decision: it needs
Redis and belongs with T-071's operational work; until then the constant-time
decoy verification is the only brute-force friction. A production mailer is a
deployment decision and will be a new entry.

## D-027 — The browser talks only to the web app; the web app talks to the API
**Status:** Accepted · 2026-09-10

**Decision.** `apps/web` is the API's only browser-facing client. Pages and
server actions call `apps/api` server-side (`src/lib/api.ts`), forwarding the
visitor's session cookie; when the API sets or clears the session cookie, the
web app mirrors it onto its own origin with the same attributes (D-026). No
JavaScript in the browser calls the API directly, and no CORS is configured.
Live updates (SSE, T-032) will be proxied through the web origin the same way.

**Why.** A cookie session only works first-party. With the web app on one
origin and the API on another, a browser call to the API would need
`SameSite=None` cookies and a CORS allow-list with credentials, which is the
posture that makes cross-site request forgery a live concern. Keeping the
browser on one origin keeps `SameSite=Lax` sufficient, keeps the API
unreachable from the public internet in production if we want it so, and
means the API's shape can change without a browser cache serving stale
JavaScript against it. It also matches rule 2 in spirit: the page depends on
the web app's contracts, never on a network detail of the API.

**Alternatives.** CORS + credentialed fetch from the browser — rejected for
the reasons above. A Next route handler proxying `/api/*` — the same idea
generalised; not needed while every interaction is a page render or a server
action, and it is the natural addition for SSE. Cookies scoped to a shared
parent domain — ties development to DNS and breaks on `localhost`.

**Consequences.** `API_BASE_URL` is a server-side variable of the web app;
the browser never sees it. Server actions must not wrap `redirect()` in a
`try`; the pattern in `auth-actions.ts` is the one to copy. Every page that
reads the session is dynamically rendered; the layout's header makes that
every page, which is the right default for a signed-in product. A page that
needs live data will go through a proxy on the web origin, not to the API.

## D-028 — The training store is a Postgres schema, loaded by the model service
**Status:** Accepted · 2026-09-10

**Decision.** Historical training data (D-016) lives in schema `training` of
the same PostgreSQL as the product, created by an ordinary migration
(`1758300000000_training-store.sql`). Tables: `source_load` (one row per
download: source, scope, URL, terms, content hash, row count, outcome),
`match` (football-data.co.uk results and closing odds) and `elo` (Club Elo).
The only writer is the loader in `apps/model`; the only reader is the model
service. `apps/api` and `apps/web` never query it. Team names in the schema
are text, not catalog UUIDs.

**Why.** The project map had pencilled in `packages/db/training` as a
directory of datasets. A directory is not queryable, not versioned per row,
and not something a backtest can join across seasons; a schema is all three,
and it rides the existing migration, backup (T-072) and restore machinery
instead of inventing a second data lifecycle. One database with a hard
boundary (a schema nothing in `public` references, and a rule that the API
does not touch it) is the same isolation as a second database for a fraction
of the operational cost at this scale. Text team names are deliberate: the
sources speak in names, the data is offline research (D-014 tier 3), and
mapping decades of historical names onto the catalog is a training-time
concern for the model, not a schema rule that would put a `team_id` foreign
key between research data and the product's identity tables.

**Alternatives.** A separate database — cleaner in theory, a second set of
credentials, backups and compose services in practice; revisit if the store
grows past what one instance should carry. Files (CSV or Parquet) on disk —
fine for a notebook, wrong for a service that must answer "which load
produced this row". A `packages/db/training` directory — see above.

**Consequences.** `apps/model` is the second workspace with a database
connection string; it reads the same `DATABASE_URL`. The loader records every
attempt, including failures, so a source outage is visible in the store rather
than inferred from a gap. Before any redistribution of derived data, the
terms recorded on the loads must be re-verified (docs/05-data-providers.md).

## D-029 — Baseline forecast: time-weighted Dixon-Coles with a Club Elo prior
**Status:** Accepted · 2026-09-10

**Decision.** The first published model is a Dixon-Coles score model: per-team
attack and defence on the log scale, a home advantage, a low-score correction
`rho`, matches weighted by `exp(-xi · days)` with `xi = 0.0065` (half-life
about 107 days), fitted by penalised maximum likelihood (L-BFGS-B) with a
small ridge and an Elo prior that pulls each team's net strength toward
`(elo − mean) / 400`. Every published number is read off the scoreline
matrix, and the three outcome probabilities are rounded so they total exactly
100%.

**Why.** Blueprint 6.2 asks for "a time-weighted football score model based on
team attack strength, defence strength, home effect" producing a scoreline
matrix; Dixon-Coles is the canonical form of exactly that, is transparent
enough to explain on a match page ("leading factors"), fits a season in
under a second, and has decades of published calibration behaviour to compare
against in T-062. The Elo prior answers the cold-start problem the blueprint
raises (long-term strength): a promoted or newly loaded team is rated where
its Elo puts it until results say otherwise, and the pull is a penalty, not a
dictate, so results always win in the end. The remaining blueprint inputs
(line-ups, injuries, rest and travel, competition context, manager stability)
are additive terms on the same expected goals once their data exists; they do
not change the model family.

**Alternatives.** Elo alone — no scorelines, no expected goals, no draw
modelling. Bivariate Poisson — a better draw model on paper, materially more
parameters and no evidence it beats Dixon-Coles out of sample at club level.
Gradient-boosted classifiers over engineered features — stronger with rich
inputs, opaque on a match page, and premature without line-up and xG data;
the backtest harness (T-062) is where such a model would have to earn its
place.

**Consequences.** The model is a pure function of the training store and a
fit date, which makes T-062 (backtesting) a loop over fit dates with no leak
by construction. Team identity in the model is the training store's text
name; the mapping to catalog UUIDs is the forecast boundary's job (T-064).
`xi`, the ridge and the Elo weight are constants to be tuned by backtest,
then frozen per model version.

## D-030 — Every model answer is a forecast version, including "unavailable"
**Status:** Accepted · 2026-09-10

**Decision.** The forecast boundary (`apps/api/src/modules/forecast/`) writes
one immutable version per computation: a `model_version` row (`name@semver`),
an `input_snapshot` holding the exact request sent and the inputs the model
reported using, and a `forecast` row numbered `MAX(version_number) + 1` for
the fixture inside the same transaction. When the model answers
`unavailable`, cannot be reached, breaks the contract, or is never asked
because the competition has no football-data division, that outcome is
stored as a version too, with `status = 'unavailable'`, a reason from a closed
list, and model id `none@0.0.0`. UPDATE and DELETE on `forecast` and
`input_snapshot` are refused by a trigger (`restrict_violation`), and a CHECK
requires `p_home + p_draw + p_away = 1.0000`. Computing over HTTP needs an
admin session; reading is public.

**Why.** Rule 5 says forecasts are immutable and rule 3 says never fake
coverage. "The model could not say" at 14:00 on match day is a fact about
that fixture at that time, and the match centre must be able to show it
(T-065) rather than an empty panel or the last good number. Storing it as a
version also makes the evaluation records (T-066) and any model comparison
honest about gaps. Putting the numbering and the immutability in the
database, not the service, means no code path — a job, a script, an operator
— can bypass them.

**Alternatives considered.** Store only successful forecasts and log the
rest: loses the coverage history and lets a stale version look current.
Enforce immutability in the service only: one `UPDATE` in a migration script
away from breaking rule 5. Version numbers from a sequence: not per fixture,
and gaps would look like missing versions.

**Consequences.** Recomputing is always additive; storage grows with every
computation, which the ingestion jobs (E2) must pace (early, on predicted
line-ups, on confirmed line-ups). Test cleanup has to disable the trigger
explicitly, which is deliberate friction. `competition.football_data_division`
is the one place a catalog competition maps to the training store; a
competition without it gets `competition_not_mapped` versions until seeded.

## D-031 — Model performance counts only forecasts made before kick-off
**Status:** Accepted · 2026-09-10

**Decision.** Every `available` forecast version of a finished fixture is
evaluated against the full-time score and stored immutably in `evaluation`
(T-066), including versions computed after kick-off. The performance figures
served per competition (`GET /competitions/:id/model-performance`) aggregate
only versions with `pre_kickoff = true`, grouped by model version and forecast
kind, and state beside them how many finished fixtures have no such version,
how many versions were `unavailable`, and how many were computed after
kick-off. Log loss and Brier use the definitions of the backtest harness
(`apps/model/fmip_model/backtest/metrics.py`), so the two sets of numbers are
comparable.

**Why.** A forecast computed once the result is known proves nothing about
the model, and a `manual` recomputation after the match is a legitimate
operator action (debugging, a corrected line-up) that must not flatter the
published record. Excluding rather than refusing keeps the evaluation table a
complete history (rule 5) while the published figure stays honest (rule 3).
Publishing the gaps beside the averages is what makes a good number
believable: "0.98 log loss over 12 of 380 fixtures" is a different claim from
"0.98 over 380".

**Alternatives considered.** Refuse to store post-kick-off forecasts: loses a
real record of what the model said when. Aggregate the latest version per
fixture only: hides how early forecasts compare with line-up-time ones, which
the blueprint's versioned forecast exists to show. Compute performance in the
model service: the API already holds the truth of what was shown to users.

**Consequences.** Evaluation is a job to run when a full-time score lands
(E2 wires it); until then it is an admin action over HTTP. A corrected final
score after evaluation is an operator decision, not a rewrite: the existing
rows stand and the correction has to be visible as such. Performance rows for
a competition are empty (`not_supplied`) until at least one pre-kick-off
version has been evaluated there.

## D-032 — Daily pg_dump to another provider, and a restore drill that has to pass
**Status:** Accepted · 2026-09-10

**Decision.** The database is backed up once a day by `pg_dump` in custom
format from inside the postgres container, with a manifest (migrations, exact
row count per table, size, SHA-256) written beside it. Both files are copied
with rclone to storage at a company other than the VPS provider, through an
rclone `crypt` remote so they are encrypted before leaving the machine, and
the run fails unless the remote reports the same size as the local dump.
Retention is 7 days locally, 90 days off-provider. `restore-drill.sh`
restores a dump into a throwaway Postgres and passes only if checksum,
migrations, every row count and two named constraints match; it runs from the
off-provider copy on the first Monday of each month, and the result is noted
in the handoff document. Redis is not backed up.

**Why.** A backup on the same provider as the database disappears with the
account, the region or the invoice. Logical dumps are the simplest thing that
restores across Postgres minor versions and onto a different machine, they are
inspectable (`pg_restore --list`), and at Phase 1 size they take seconds. The
manifest turns "the file exists" into "the file contains what the database
contained", and the drill turns that into a recurring fact rather than a
belief. Nothing is installed on the host beyond Docker, so the VPS stays as
reproducible as the compose file says it is.

**Alternatives considered.** WAL archiving / point-in-time recovery (pgBackRest,
WAL-G): the right answer once user predictions and reputation carry weight
(Phase 2); today it adds a component to run and understand for a recovery
point nobody needs yet. Provider snapshots of the VPS disk: same-provider,
opaque, and not restorable anywhere else. Managed Postgres with built-in
backups: rules out the single-VPS cost model of D-011.

**Consequences.** Recovery point up to 24 hours; forecasts and evaluations
are recomputable from the training store and results, so the loss is bounded
to a day of user activity. The maintainer owns the off-provider account and
`rclone.conf`, and keeps both in the password manager; without the crypt keys
the off-provider copies are unreadable by design. A failed drill is the
week's first task. Moving to PITR later changes `docker-compose.yml` and this
decision, not the drill's contract.

## D-033 — The read and prediction slices are built against the schema, not against live ingestion
**Status:** Accepted · 2026-09-11

**Decision.** E3 (public read experience), E5 (predictions and reputation) and
the remaining E6 and E7 tasks proceed now, against the canonical schema
(T-010 to T-013) and seeded or test data, while T-025 (the provider decision
and payment) is deferred by the maintainer. Where `04-tasks-phase-1.md` listed
T-026 or T-027 as a dependency only because they would *populate* the tables,
the dependency is relaxed to the schema task that *defines* them, and the row
says so. Dependencies that are about behaviour stay: the SSE gateway (T-032)
needs a source of change events and gets an internal one; nothing that needs
a provider's live feed to be *proved* (goal latency, T-083's outage
behaviour under a real feed) is ticked on seed data.

**Why.** The maintainer chose to build everything that does not need the paid
plan first. The tables, constraints and coverage profiles exist and are the
contract the ingestion jobs will write to; a scores API tested against rows
inserted by hand exercises the same SQL and the same shapes as one fed by a
job. D-001 asks for vertical slices, and a slice that reaches the page is more
informative than a finished pipeline with no page. The risk is rework if
ingestion turns out to need different shapes; the adapters (T-021..T-023)
already produce the normalised model those shapes were designed from, which
bounds it.

**Alternatives considered.** Wait for T-025: idle weeks and a page built last
against everything at once. Fake a provider: forbidden by rule 3 in spirit and
pointless in practice, the schema is the fake's only output anyway.

**Consequences.** When T-026 lands, its acceptance ("a replay changes nothing")
is checked against pages that already render the tables, which is a stronger
test. Every verification note written under this decision names the data it
ran on (seed, test rows), so nobody reads "verified" as "verified against a
provider". The task table keeps the original dependency in parentheses for the
record.

## D-034 — Live updates ride on Postgres NOTIFY and server-sent events, full snapshots every time
**Status:** Accepted · 2026-09-11

**Decision.** Every write to a fixture or to what hangs off it (participants,
scores, periods, incidents, line-ups, statistics) raises `NOTIFY
fixture_change` from a trigger (migration `1758700000000`). The API holds one
`LISTEN` connection and pushes to browsers over server-sent events: `GET
/scores/stream` (the day's list) and `GET /fixtures/:id/stream` (one match
centre). The first event on every connection, and every change thereafter, is a
**full snapshot** of the same shape the plain endpoint returns; changes are
debounced (300 ms) so a goal's three writes make one push; a `heartbeat`
every 15 s carries the server time; a broken feed sends `stale` instead of
going quiet. The browser subscribes through the web app's own route
(`/api/scores/stream`), never to the API (D-027). The page calls itself
`stale` after 45 s without a heartbeat and `unavailable` when it never got a
picture.

**Why.** Blueprint 4.1 and rule 4: score changes appear without refresh, and
staleness is visible. Postgres already decides what a score is; making it also
say "something changed" needs no second system to keep in step, works for
every API instance alike, and is exercised by the same writes the ingestion
jobs will make. Snapshots rather than deltas because a reconnecting client
must never keep an old card: EventSource reconnects on its own, and the first
thing it receives is the whole truth again. SSE rather than WebSockets for a
one-way feed (D-010 keeps WebSockets for chat, Phase 3).

**Alternatives considered.** Redis pub/sub: right when a separate job runner
publishes at scale, and still available later; today it would be a second
source of "changed" beside the database. Deltas per fixture: fewer bytes,
more client state, and exactly the class of bug rule 4 exists to prevent.
Polling from the browser: simple, but each client would poll the API through
the web app; the load test (T-073) decides whether SSE fan-out or polling wins
at peak, on evidence.

**Consequences.** One pooled connection per API process is permanently
`LISTEN`ing. A dead notification (the LISTEN connection lost) is surfaced as
`stale` on every open stream, never swallowed. Cloudflare and nginx must not
buffer `text/event-stream` (`X-Accel-Buffering: no` is sent; T-074 configures
the edge). The change feed is the hook T-026's jobs get for free: writing the
tables is enough.

## D-035 — Performance Rating formula v1: difficulty from stored forecasts, snapshots only on change
**Status:** Accepted · 2026-09-11

**Decision.** `performance-rating@1.0.0` (`apps/api/src/modules/reputation/internal/formula.ts`)
implements blueprint 9.1 as: result 60% (each correct pick earns `1 − d`, where
`d` is the model's pre-kick-off probability of the outcome that happened, read
from the immutable forecast versions of T-064, or 1/3 when no forecast was
computed in time; the sum is normalised against the neutral case and capped at
1), exact score 20% (hit rate × 4, capped), consistency 15% (1 minus the spread
of accuracy across blocks of five within the last twenty; neutral 0.5 below
ten), confidence 5% (reward when right, cost when wrong); window 100;
provisional below 30, established at 50; tiers at 40 / 55 / 70 / 85. Every
change to any number is a new version string. A rating is stored as an
immutable `rating_snapshot` that records the version, the components and a
hash of the settlement ids it was computed from; recomputing over unchanged
inputs writes nothing.

**Why.** Rule 8 and the architecture's "reputation reproducibility": an admin
must be able to answer "why is my rating this number" from stored rows and
one config. Using the model's own probability as difficulty is what makes "a
difficult correct prediction receives more credit than an obvious one"
computable without a human, and reading it from stored forecast versions keeps
the inputs immutable. Neutral 1/3 without a forecast means the rating does not
punish members for the model's gaps. Snapshots only on change turn the table
into a history of real movements, which the profile's "rating change over
time" (blueprint 9.3) can show as is.

**Alternatives considered.** Storing difficulty on the settlement row: simpler
reads, but the settlement table is immutable and shipped, and the forecast
versions already hold the number. Elo-style pairwise ratings: not what the
blueprint describes and harder to explain on a page. Computing on read with no
snapshots: no history and no "which version produced this".

**Consequences.** Changing the formula is a version bump plus a recomputation
pass; old snapshots stay and say which version they came from. Consistency and
confidence are the least grounded components and are the first candidates for
tuning once real members exist; the admin surface for thresholds (T-070) edits
this config, not code paths. Career Points (T-054) are a separate measure and
never feed this number.

## D-036 — Career Points are a ledger over settlements; privileges never read them
**Status:** Accepted · 2026-09-11

**Decision.** Career Points (blueprint 9.2) are immutable `points_transaction`
rows, one per settlement and reason, under `career-points@1.0.0`: 1 for a
settled prediction, 3 for a correct outcome, 5 for an exact score, 5 for five
correct outcomes in a row and 15 for ten, once per run. The ledger is a pure
function of the settlements: awarding writes only the rows that are missing,
so it can run after every settlement and on demand. Eligibility for
high-rating privileges (blueprint 9.4) is `privilege-eligibility@1.0.0`: rating
≥ 70, ≥ 50 settled predictions, verified e-mail — a function whose inputs
cannot include points. Approved-analysis points wait for the community
features.

**Why.** The blueprint separates activity from skill so "activity is not
confused with skill"; the cleanest guarantee is structural: the eligibility
function has no parameter for points, and the test writes a million points
into the ledger and shows the answer unchanged. A ledger rather than a running
total means the number is always explainable line by line and rebuildable
from settlements (rule 8 in spirit). One row per settlement and reason gives
idempotency for free.

**Alternatives considered.** A `career_points` column on the account: fast to
read, impossible to explain or rebuild. Awarding streaks by wall-clock
windows: not reproducible from stored rows.

**Consequences.** Point values are a version bump away from change; old rows
keep their version. Points for approved analysis and achievements are new
reasons under a new version when those features exist (Phase 2). The admin
surface (T-070) edits `points.ts` and `eligibility.ts`, not code paths.

## D-037 — The leaderboard's minimum-sample filter has a floor, and the floor is the provisional threshold
**Status:** Accepted · 2026-09-11

**Decision.** `GET /leaderboard` ranks members by their current rating
snapshot and accepts a `min_settled` filter that can be raised but never
lowered below the formula's provisional threshold (30 settled predictions in
`performance-rating@1.0.0`). A request under the floor is refused with a 400
that names the rule; it is not clamped. Presets (30 / 50 / 100), the floor and
page limits are `leaderboard@1.0.0` in `internal/leaderboard.ts` and are sent
with every response, so the page shows what the API enforces. The board reads
snapshots only and derives nothing else; suspended and deleted accounts are
left out. Period, competition, friends and group boards wait for their data
(Phase 2 and the competition pages).

**Why.** Blueprint 9.3: "minimum-prediction filters prevent a member with one
lucky result from ranking above established performers." A filter the client
can set to 1 is not a guarantee; a floor is. Refusing rather than clamping
keeps the contract honest: the caller learns the rule instead of receiving a
board that silently differs from what it asked for. Tying the floor to the
provisional threshold means "ranked" and "not provisional" are the same
statement.

**Alternatives considered.** No floor, presets only in the UI: a URL edit
would defeat it. A floor at the established threshold (50): too strict for a
young platform; 50 is a preset instead. Ranking by Career Points as an
alternative board: activity is not skill (D-036); a points board can come
later, labelled as activity.

**Consequences.** Changing the floor is a version bump of the leaderboard
rules; the admin surface (T-070) edits the rules object. Ranks are dense
across pages and reproducible from the snapshots.

## D-038 — Tables and leaders are computed from stored results, not ingested as numbers
**Status:** Accepted · 2026-09-12

**Decision.** The standings boundary computes the league table from the
finished league-stage fixtures and their full-time scores (three points for a
win, ranked by points, goal difference, goals scored, name; last five results
as form) and the goalscorer list from recorded goal incidents. Nothing is
ingested as a ready-made table row; `table_row` in 02-architecture.md is not
created. Every answer is a `Covered` module under the season's declared
`standings` / `incidents` coverage: rows we can compute from a season that
declares nothing are `limited`; no rows is `not_supplied` (or `delayed` when
the profile says so). Competition-specific tie-breakers (head-to-head, fair
play, deductions) are a rule per competition to add when a covered competition
needs one, with the row carrying which rule produced it.

**Why.** A computed table is explainable line by line and always agrees with
the results the match centre shows; an ingested one can drift from them and
adds a provider shape to keep in step (rule 2). It is also available before
any provider is bought (D-033). Coverage stays honest: a table built from two
stored results is not "available" just because it exists.

**Alternatives considered.** Ingesting provider standings: authoritative for
deductions and official tie-breakers, but a second source of truth. Storing
the computed table: a cache, not a decision; can come later if the query is
slow.

**Consequences.** Group tables and knockout brackets are additions to the
standings boundary, not a new shape. Point deductions need a table of
adjustments before a covered competition applies one.

## D-039 — Entity search is Postgres trigrams over the catalog plus an alias table
**Status:** Accepted · 2026-09-12

**Decision.** Phase 1 search (blueprint 5, "common local spellings,
transliterations and aliases") runs inside PostgreSQL: `pg_trgm` word
similarity and prefix matching over `search_key(name)` — lower-cased and
accent-folded through `unaccent` — for teams, competitions and people, plus
`entity_alias`, one row per other spelling of an entity (alias,
transliteration, abbreviation, former name, misspelling; optional language;
a source). Results always carry the canonical name and say whether the name
or an alias matched. No separate search index or service is introduced.

**Why.** The catalog is small and the ask is entity lookup, not full-text
search over articles. Trigrams handle typos and partial words; `unaccent`
handles diacritics; everything else (Persian spellings, nicknames, former
names) is data that belongs in a table an admin can edit, not in code. One
store, one transaction, no second system to keep in step (rule 2 keeps
provider names out of it: aliases are ours).

**Alternatives considered.** An external index (Meilisearch, OpenSearch):
better ranking and typo tolerance across languages, but a new dependency and
a sync problem for a catalog of hundreds of rows. Full-text `tsvector`: built
for prose, poor at partial names.

**Consequences.** `search_key` is declared immutable over the shipped
`unaccent` dictionary; changing the dictionary means reindexing. Articles,
groups and user search (blueprint 5, Phase 2) will need either `tsvector` or
the external index revisited; nothing here blocks that. Alias entry becomes
an admin surface (T-070).

## D-040 — One canonical URL per page under its locale; the pseudo-locale and member pages are never indexed
**Status:** Accepted · 2026-09-12

**Decision.** Every public page has one canonical URL, `SITE_URL/<locale><path>`,
and declares language alternates for the shipped locales with `x-default`
pointing at the default locale. The `x-rtl` pseudo-locale, a member's own
pages (settings, sign-in, registration), a search result list and any page
for a malformed id carry `noindex`. `/robots.txt` and `/sitemap.xml` are
generated by the web app from the same rules and from the catalog; the
sitemap lists competitions and teams (matches and players are reached
through them and would make the map churn daily). Structured data is
schema.org JSON-LD rendered on the server: `WebSite` + `SearchAction`,
`SportsEvent`, `SportsOrganization`, `SportsTeam`, `Person`. A competition's
current season is its canonical page; an older season is its own URL with
`?season=`.

**Why.** The product depends on search (blueprint 5, 15): a crawler must get
the full page without JavaScript and must not see the same English text under
`/x-rtl/` or a member's private state under an indexable URL. Locale-prefixed
canonicals keep languages distinct as they ship (D-003). Generating robots and
the sitemap from the locale registry and the catalog means a new locale or a
new competition is listed without a hand edit.

**Alternatives considered.** Sitemap with every match and player: correct
but tens of thousands of URLs that change daily; the entity pages already
link them. Client-side structured data: invisible to a crawler without JS.

**Consequences.** `SITE_URL` is a required production setting (it defaults to
localhost). Adding a locale adds it to the alternates and the sitemap
automatically. The PWA (T-082) adds its manifest beside these files.

## D-041 — The accessibility standard is WCAG 2.2 AA, checked by axe-core in CI
**Status:** Accepted · 2026-09-12

**Decision.** "The agreed accessibility standard" (blueprint, Language and
accessibility; T-081) is WCAG 2.2 level AA. It is checked on every push by
`@axe-core/playwright` over every kind of page the platform has (home,
scores, leaderboard, search with and without a term, sign-in, registration,
match centre, competition, team, player, the pseudo-locale), with zero
violations under the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and
`wcag22aa` rule sets. What a rule engine cannot judge is fixed in the code
and tested by hand in Playwright: a skip link is the first thing in the tab
order and moves focus into the content; `:focus-visible` always draws a
ring; reduced motion is honoured; live pages carry a polite, atomic live
region into which every score change, kick-off, full time, correction and
red card is put into words (`lib/announce.ts`); icons that carry meaning are
named.

**Why.** The blueprint lists keyboard navigation, focus order, contrast,
screen-reader labels and live-score announcements without naming a
standard; WCAG 2.2 AA is the level regulators and procurement ask for and
the one axe-core can enforce mechanically. Running it in CI keeps the
standard from decaying one component at a time. Live announcements are the
one football-specific need: a score is a number that changes while nobody is
looking, and a screen reader has to be told.

**Alternatives considered.** Manual audits only: not repeatable. AAA: the
contrast rules would forbid the muted secondary text the design relies on.

**Consequences.** `@axe-core/playwright` is a dev dependency of the web app.
A new page joins the list in `tests/e2e/a11y.spec.ts`. Persian and Arabic
locales, when they ship, get the same checks under their own paths.

## D-042 — The PWA is an installable shell with an honest offline page, not an offline cache of scores
**Status:** Accepted · 2026-09-12

**Decision.** The web app ships a manifest, icons and a service worker that
make it installable (T-082). The worker caches only the shell: the offline
page, the manifest, the icons and Next's immutable build assets. Pages are
fetched from the network; when there is none, the offline page is shown and
says so. Live data — scores, the match centre, the stream and every route
under `/api/` — is never cached and never replayed. The manifest's start
page is the scores page under the default locale.

**Why.** Rule 4: never show stale data as current. A cached scores page
shown offline would be exactly that, with no way to know how old it is. An
installed app that says "you are offline" is honest; one that shows
yesterday's score with a live badge is not. Caching the shell is enough for
installability and for a fast return visit.

**Alternatives considered.** Stale-while-revalidate for pages: fast but
shows old numbers first. Background sync of favourites: Phase 2, with a
"last updated" line per fixture when it comes.

**Consequences.** `scripts/make-icons.mjs` is the source of the icons; a
brand mark replaces the placeholder there. The worker's cache name is
versioned; a change to the shell bumps it. Lighthouse 12 dropped its PWA
audit, so installability is checked in `tests/e2e/pwa.spec.ts`; the tap on
"Install" on a real Android device stays a manual check.

## D-043 — Two E2E modes: the web app alone for its honest states, the whole stack for the journeys
**Status:** Accepted · 2026-09-12

**Decision.** Playwright runs in two projects. `chromium` drives the
production build of the web app with no API behind it and proves every
page's honest state (unreachable named, nothing faked, 404s, RTL, SEO,
accessibility, installability); it runs in CI's `E2E` job and locally with
nothing else up. `journeys` drives the web app in front of the real API,
the migrated and seeded database and the API's mail log, and walks the
blueprint's essential user journeys (section 18) as far as Phase 1 ships
them; it exists only when `E2E_API_URL` is set and runs in CI's
`E2E journeys` job, which starts Postgres, migrates, seeds, builds and
starts the API (no model service: forecasts read what is stored). Seed
`007` adds one scheduled match in 2099 so the prediction journey always
has an open match.

**Why.** The no-API tests are the guarantee of rule 3 and rule 4 under
failure; the journeys are the guarantee that the product works. Mixing them
in one run would make each assertion conditional on the environment. A
project that does not exist without the API keeps a local run from being a
wall of red. Reading the verification link from the mail log exercises the
real verification path (D-026) instead of a test-only back door.

**Alternatives considered.** Mocking the API in Playwright: proves the web
app against a fiction. A shared `test.skip` inside each test: hides
failures as skips.

**Consequences.** The branch ruleset lists `Verify` and `E2E`; adding
`E2E journeys` to the required checks is a repository setting for the
maintainer. A new journey slice joins `tests/e2e/journeys/`.

## D-044 — Observability is structured stdout, request ids and honest health views; no tracing vendor yet
**Status:** Accepted · 2026-09-12

**Decision.** The API logs one JSON object per line to stdout (pretty in
development, `LOG_FORMAT` decides), with a `context`, a `message` and named
fields; deliberate events carry an `event` name (`http.request`,
`http.error`, `ingest.failed`, `ingest.succeeded`). Every request has an id
(the caller's `x-request-id` when sane, else a UUID) that is echoed, logged
and returned in the body of any unhandled error; the web app sends one per
API call. Unhandled errors become a 500 `ApiError` of kind `internal`; the
stack goes to the log only. Ingest runs are recorded in `ingest_run` through
`IngestRunsService`, failures are logged as events, and `GET
/health/ingestion` and `GET /health/live` expose the ingestion and live
paths over HTTP while `GET /health` stays liveness-only. No error-tracking
or tracing SaaS and no log shipper are introduced.

**Why.** The acceptance is that an ingest failure is visible without SSH:
a row in a table read by a public endpoint and a line in a log a platform
collects both satisfy it, and neither needs an account with a vendor. JSON
lines are what every collector (Docker, journald, Loki, Datadog) ingests;
picking one now would be a decision without a deployment (T-074) to inform
it. Request ids give tracing's first and most valuable property — one
identifier from the page to the API log — at no cost.

**Alternatives considered.** `nestjs-pino` and OpenTelemetry: better
performance and spans, but dependencies whose configuration belongs with the
deployment. A separate error tracker (Sentry): later, with T-074; the filter
here is where its hook goes.

**Consequences.** T-070's admin surface reads `/health/ingestion` rather
than the table. The E2 jobs wrap their work in `IngestRunsService.track`.
`LOG_FORMAT` is documented in `.env.example`.

## D-045 — A live match whose data stops changing is "behind", on the server and on the client
**Status:** Accepted · 2026-09-12

**Decision.** A fixture in progress (`live` or `suspended`) whose data has
not changed for `STALE_LIVE_AFTER_MS` (two minutes, in `@fmip/contracts`) is
`stale`. The API says so in `freshness` on every score card and match header
at snapshot time; the web app re-asks the same rule against its own clock
every few seconds, so a feed that stops after the last snapshot is caught
without a round trip. A behind match shows "Behind" where the minute was,
with the time of its last change and the words "the last known, not the
current"; the score stays visible. When the ingestion feed's latest run
failed or was partial (`GET /health/ingestion`, T-071), the scores page says
so at the top with the time, and keeps showing what it has. Nothing is
hidden; nothing is called current that is not.

**Why.** Rule 4: never show stale data as current. A provider outage looks,
from the outside, exactly like a quiet match; the only honest signal is
time since the last change, and both ends of the pipe have to check it —
the server for the first paint, the client for the minutes after. Two
minutes is longer than any normal gap between provider polls and shorter
than a half.

**Alternatives considered.** Hiding a stale card: loses the last known
score, which is still information. Server-only freshness: a stopped feed
means no new snapshots, so the client would keep showing "current".
A per-provider expected-poll interval: needs the providers (E2); the
threshold can become per-provider then.

**Consequences.** The E2 jobs record their runs (T-071) and the notice on
the scores page follows automatically. `STALE_LIVE_AFTER_MS` is one
constant shared by API and web. The client "connecting / live / stale" line
(T-032) is about the stream; this rule is about the data — a page can be
connected and behind at the same time, and says both.

## D-046 — Administration is a role-gated boundary; every high-impact write carries its audit row in the same transaction
**Status:** Accepted · 2026-09-12

**Decision.** The administration area (blueprint 16) is its own boundary,
`/admin/...`, open only to accounts with the `admin` role in `user_role`;
the web page renders what the API allowed and shows a member without the
role nothing (404). High-impact writes — in Phase 1 an account's status and
a season's declared coverage — require a reason and insert their `audit_log`
row (actor, action, target, reason, previous, next) in the same database
transaction as the change, so a change without its record cannot exist;
the log is immutable. The rating configuration is shown by version and
value and is not editable from the page: changing a rule is a new version
in code (D-035, D-036), which is what keeps every stored rating
reproducible (rule 8). Reads (coverage, freshness, ingestion, member search)
cross the other boundaries' tables directly: the operator's view is the
whole platform, and a read has no invariant to protect.

**Why.** Rule 10 asks for actor, timestamp, reason and previous value; a
row written after the fact, or by a separate call, can be missing when the
second write fails — the transaction is the guarantee. Editable rating
rules in a table would let a stored rating disagree with the rule that
produced it. Hiding the area from members without the role avoids
advertising it.

**Alternatives considered.** A generic audit trigger on every table: records
what changed but not who or why. Editable rating rules with their own
versioning: possible later, if the founder needs to change thresholds
without a deploy; the audit shape already fits.

**Consequences.** New high-impact actions (moderation, contributor access,
changing a settled prediction) follow the same pattern: reason in, audit
row in the transaction. `audit_log` grows forever by design.

## D-047 — The agreed peak is 1,000 concurrent stream clients per API process, measured through the real trigger path
**Status:** Accepted · 2026-09-12

**Decision.** The load test for the live path (T-073) is `apps/api/scripts/load-sse.mjs`:
N server-sent-event clients on the scores stream, a temporary live fixture
changed through the database so the real `NOTIFY` → fan-out path is
measured, one JSON report. The agreed threshold is 1,000 concurrent clients
on one API process with no refused or dropped connections, connect + first
snapshot under 1.5 s at p95, a change reaching every client under 2.5 s at
p95, and steady heartbeats. The record of every run lives in
`docs/08-load-test.md`; it is rerun before the deploy (T-074, on the VPS,
with the tool on another machine), after any change to the live path, and
before a known big match with the expected peak as the client count.

**Why.** The blueprint asks that "major-match traffic tests pass at the
agreed peak load" without naming the peak; 1,000 per process is the
launch-stage figure (a handful of covered leagues, one VPS) and the first
number at which the current design's linear cost — one snapshot read and
serialisation per subscriber per change — is measured rather than guessed.
Measuring through the database trigger rather than a mocked event proves
the whole path, including the debounce.

**Alternatives considered.** A generic HTTP load tool (k6, autocannon):
none holds thousands of SSE streams and times a database-side change
against each of them; the script is 200 lines and has no new dependency. A
higher threshold: honest only after the shared-snapshot remedy or a second
process, both recorded in the runbook as the next steps.

**Consequences.** The 2026-09-12 record: pass at 1,000 (p95 propagation
1.98 s), knee between 1,000 and 2,000 on the maintainer's machine. When the
peak grows, the first change is one snapshot per distinct query per change;
the second is more processes.
