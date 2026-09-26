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

## D-048 — One VPS, Caddy behind Cloudflare with an origin certificate, containers rolled one at a time by a script in the repository
**Status:** Accepted · 2026-09-12

**Decision.** Production (T-074) is the compose stack in
`deploy/docker-compose.prod.yml` on one VPS, selected by
`COMPOSE_FILE=deploy/docker-compose.prod.yml` in the server's `.env` so every
plain `docker compose` there means production. Caddy is the only listener:
TLS on 443 with the Cloudflare origin certificate (Cloudflare SSL mode "Full
(strict)"), 80 redirecting; it proxies only `web`, resolved through Docker's
DNS every second. The API, the model service, Postgres and Redis publish
nothing to the network (Postgres and Redis keep `127.0.0.1` ports for the
backup scripts and an SSH tunnel). Migrations run from a tool image
(`packages/db/Dockerfile`), so the VPS needs Docker and nothing else.
Redeploys go through `deploy/rollout.sh`: build, migrate, then for each of
`model`, `api`, `web` start one new container beside the old one, wait for its
healthcheck, stop the old one with 30 s of grace; `deploy/verify-rollout.sh`
proves a rollout dropped nothing by probing the site every 200 ms throughout.
Migrations therefore must stay compatible with the release still serving
(expand first, contract later). Runbook: `docs/09-deploy.md`.

**Why.** The blueprint fixes Docker Compose on a VPS behind Cloudflare; the
open choices were the edge, TLS and how a redeploy avoids downtime. Caddy
holds a config of thirty lines and needs no plugin because the certificate
comes from Cloudflare rather than ACME; an origin certificate is a one-time
paste with a 15-year validity, and "Full (strict)" means the edge verifies
it. Proxying only the web app keeps the API off the public network without a
second host name or a second certificate, and matches how the browser already
reaches the streams (through the web app's `/api/*` routes). The rollout is
sixty lines of `docker compose` because the alternatives (Swarm, Kubernetes, a
third-party rollout plugin) each add a moving part to a single-server
deployment, and the acceptance criterion — no dropped request — is checked by a
probe rather than assumed.

**Alternatives considered.** nginx or Traefik: both fine; Caddy's dynamic
DNS upstreams and retry-on-dial-failure are what make the rollout trivial.
ACME with a Cloudflare DNS plugin: a custom Caddy build for a certificate the
edge already provides. `docker compose up -d` alone: recreates each container
in place, several seconds of 502 per release. A managed platform: not the
blueprint's stack, and a second monthly bill before the first user.

**Consequences.** The load test (T-073) reruns on the VPS from inside the API
image before launch. Cloudflare's 100 s idle timeout on proxied connections is
covered by the 15 s SSE heartbeat. Client IPs reach the API as
`CF-Connecting-IP`; if a feature needs them, Caddy's `trusted_proxies` is where
Cloudflare's ranges go. `SITE_URL` and `WEB_BASE_URL` are derived from
`SITE_HOST` in production; only development sets them directly.

---

## D-049 — Until a paid plan exists, ingestion runs on two free sources plus an offline replay, and says where each one stops
**Status:** Accepted · 2026-09-12

**Decision.** T-025 stays deferred (D-033), and the ingestion jobs run on three
sources instead of one:

- **football-data.org** (free TIER_ONE key, already held) is the **spine**:
  fixtures, kick-off times, statuses, scores and standings for the five target
  leagues and the Champions League, on the current season, inside 10
  requests/minute.
- **Highlightly** (free BASIC key, already held) is the **detail**: lineups,
  incidents and the live clock, rationed against a hard 100 requests/day.
- **`replay`** is a keyless offline source that plays committed recordings back
  on a compressed clock. It is what CI and the tests use.

Each source declares what it supplies per module. A module no source reached is
`not_supplied`; a module a source reached partially is `limited`. The two live
sources are never merged into one module to make it look complete: the spine
owns scores and tables, the detail source owns lineups and incidents, and the
coverage profile (T-027) records which source supplied each one.

Rejected for this purpose: **API-Football** free (verified again on 2026-09-12 -
"Free plans do not have access to this season, try from 2022 to 2024"; it cannot
see a match happening now, so it is a replay source only); **TheSportsDB** free
(`lookuplineup`, `lookuptimeline` and `lookupeventstats` each return exactly five
rows - truncated lists that do not declare themselves truncated are the failure
rule 3 exists to prevent); **OpenLigaDB** (German competitions only, no lineups -
kept as a free cross-check on Bundesliga scores, nothing more); **ESPN's
undocumented JSON** (richest free payload of all and explicitly forbidden: the
Disney Terms of Use covering ESPN prohibit automated extraction and any
commercial use). **Big Balls Data** is the first thing to try if the 100/day
ceiling binds, but it needs a sign-up nobody has done, so nothing is built on its
claims.

**Why.** The pipeline has never been run against a real current season - the
bake-off (T-024) could only reach 2023/24, because the one adapter with full
field coverage is season-locked on its free plan. Everything T-026 and T-027
exist to prove - that a poll loop is idempotent, that a coverage state is
computed from what actually arrived, that freshness degrades visibly - needs a
season that moves. Two free keys we already hold cover that between them: one has
the breadth and no daily cap, the other has the depth and a small budget.
Splitting by module rather than blending keeps rule 6's spirit at the data layer
and makes each gap nameable instead of invisible.

**Alternatives considered.** *Buy the paid plan now* - the decision to defer is
D-033 and unchanged; nothing here needs money. *One source only* -
football-data.org alone never produces a lineup or an incident, so half the
match-centre code would stay unexercised; Highlightly alone burns its 100 daily
requests on fixture lists before reaching any detail. *Scrape ESPN* - the payload
is superb and the terms forbid it, which ends the discussion. *Wait for a real
provider* - the replay source removes the reason to wait.

**Consequences.** `INGESTION_SOURCE` selects the profile (`live` or `replay`);
`replay` is the default everywhere except a deployment that has both keys, so no
test and no CI job needs a key. The Highlightly budget is enforced in code, not
in hope: the job that spends it stops at a configured daily ceiling and records
the run as `partial` with the reason, which surfaces on `GET /health/ingestion`
and in the admin area. When a paid plan is bought (T-025), it replaces both live
sources and the coverage profile stops reporting `not_supplied` for lineups and
incidents - no other code changes, which is the switching-cost claim in
`05-data-providers.md` being cashed in.

---

## D-050 — A Cloudflare quick tunnel is the free public address for testing, and its missing server-sent events are stated, not worked around
**Status:** Accepted · 2026-09-12

**Decision.** Until a server exists (T-074), the way to put the running stack on
the public internet is `bash scripts/public-preview.sh`, which opens a
Cloudflare quick tunnel against the `web` container and tells the app the
`*.trycloudflare.com` name it was given. It needs no account, no domain, no
port forward and nothing installed on the host; the tunnel is a container behind
a compose profile, so it never starts unless it is asked for.

Its limits are documented at the point of use rather than discovered: no uptime
guarantee, 200 concurrent requests, and no server-sent events — so the live
scores path does not update through it and the page shows its connecting and
stale states. Testing the live path in public needs one of the options in
`docs/10-public-preview.md`, all of which require an account that an agent
session does not create.

**Why.** Three things cannot be checked on localhost and all three block work
that is otherwise ready: whether Android offers to install the progressive web
app (the prompt needs real HTTPS, and T-084's install tap is waiting on it),
whether the site behaves on a phone on a real network, and whether a link opens
for somebody else. Every other free route — a free subdomain pointing at this
machine, a free container platform, a free virtual machine — needs either an
account or a public IP with ports 80 and 443 open, and a home connection behind
carrier-grade NAT has neither. A quick tunnel needs none of it and is up in
about twenty seconds.

**Alternatives considered.** *A free subdomain (DuckDNS, `nip.io`, `sslip.io`)
pointing here*: `nip.io` resolves without an account, confirmed, but all of them
still need the router to forward 80 and 443, which is the problem the tunnel
exists to avoid. *A free container platform (Koyeb, Render)*: a genuinely better
answer for a stable address, and it carries server-sent events, but it needs a
sign-up, so it is recorded as the next step rather than taken. *Oracle Cloud's
always-free machine*: the best free option of all, since it runs `deploy/`
unchanged and would close out T-074 — same blocker, plus card verification and
scarce capacity. *A free top-level domain*: there is no longer such a thing;
saying so is more useful than hunting for one.

**Consequences.** `SITE_URL` now reaches the `web` service in the development
compose file, defaulting to localhost, so the preview script has something to
set. The address is different every run, which is acceptable for a session of
testing and is why nothing is documented as pointing at it. When a stable
address is wanted, the choice is in `docs/10-public-preview.md` and needs one
decision from the maintainer, not more research.

---

## D-051 — The stable free preview is one Koyeb container holding the web app and the API, and it declares what it does not have
**Status:** Superseded by D-064 · 2026-09-13, superseded 2026-09-15

> **Why it ended.** Not because the reasoning was wrong — the one-container shape
> it chose is the shape D-064 keeps. Koyeb was acquired in February 2026 and
> withdrew its free Instance from new accounts, so the platform underneath the
> decision stopped existing. Kept in full, because the shortlist and the
> trade-offs it weighed are what D-064 was decided from.

**Decision.** Koyeb is the platform for a stable public preview (T-086), chosen
over Render and Oracle Cloud from the shortlist in `docs/10-public-preview.md`.
A free organisation gets one Free Instance, so the deployment is **one
container** built from `deploy/koyeb/Dockerfile`: the Next.js web app on the
published port and the NestJS API on `127.0.0.1:3001` beside it, supervised by
`deploy/koyeb/start.mjs`, which migrates, waits for `/health`, starts the web
app and takes the container down if either process dies.

One port is enough because nothing in the browser talks to the API directly —
the Next.js route handlers proxy `/api/scores/stream` and
`/api/fixtures/:id/stream` server-side — so the live path works through a single
ordinary HTTPS route. That is the whole reason for preferring a platform to the
quick tunnel of T-085, which does not carry server-sent events.

What is not deployed is declared rather than hidden. `MODEL_SERVICE_URL=off` is
a new, explicit value meaning "this deployment has no model service": every
forecast is recorded as `model_unreachable` with that reason, which the pages
already know how to show. A missing variable still refuses to boot. The
ingestion scheduler is off because a container that scales to zero cannot poll,
and Redis is therefore absent too.

**Why Koyeb.** The shortlist wanted one thing the quick tunnel could not give:
server-sent events over a stable address. Koyeb's free Instance carries them,
needs no card in the normal case, and builds from the repository so nothing has
to be pushed anywhere. Render's free web services were the alternative and are
equivalent in kind; Oracle Cloud's always-free machine is better in every way
except that it needs card verification and scarce ARM capacity, and it would
close out T-074 rather than preview it.

**Alternatives considered.** *Two services, one for the API and one for the web
app*: a free organisation gets one Instance, so this is not available, and it
would also publish the API for no benefit. *Adding the Python model service to
the image*: it does not fit in 512 MB beside two Node processes, and it needs the
training store. *Keeping only the quick tunnel*: it cannot test the live path at
all, which is the one thing a public preview is for. *Pointing
`MODEL_SERVICE_URL` at a dead port to force the unreachable path*: the effect
would be right and the statement would be false.

**Consequences.** A Koyeb free Instance sleeps after an hour without traffic and
its database has five compute-hours a month, so the first request after a quiet
period is slow and a heavily used month runs out — both are in
`docs/11-koyeb.md` rather than left to be discovered. `apps/api/Dockerfile`
gained the `@fmip/ingestion` manifest it had been missing since T-026, which the
image emulation in `06-session-handoff.md` exists to catch. The preview's
database is migrated at every start and seeded only on `PREVIEW_SEED=on`, which
logs that it is loading development fixture data.

---

## D-052 — The community consensus is weighted only by established ratings, and is not published below five predictors

**Date:** 2026-09-13 · **Task:** T-134 · **Status:** accepted

Blueprint 6.6 asks for two distributions: "the simple crowd distribution and a
rating-weighted distribution", and adds in the same breath that "the website
must not disguise community opinion as the statistical model". Building that
needed two judgements the blueprint does not make, and both of them decide what
the product is willing to claim.

**Only established raters carry weight.** A Performance Rating is `provisional`
until enough settlements stand behind it (T-053) — the system's own way of
saying it does not yet know how good a member is. Weighting by a provisional
number turns "unknown" into a coefficient, and the resulting bar would look
exactly like the one built from forty settled predictions. So a provisional
rating contributes nothing, and the payload carries `raters`, the count that
actually stands behind the weighted distribution, so a page can say how much
judgement is in it.

The consequence is accepted deliberately: on most fixtures, early on, there will
be no weighted distribution at all. It is then `null`, and the module is
`limited`. What it must never be is the crowd distribution returned a second
time under the other label — one answer shown twice is the disguise the
blueprint forbids, and it would be undetectable from outside.

**Nothing is published below five predictors.** Two reasons, either sufficient.
A distribution over three people reads as a finding and is one vote; "67% home"
carries a precision the sample cannot support, which is rule 3 applied to a
crowd. And a very small aggregate stops being an aggregate: with one predictor
it *is* that member's prediction, which they may have chosen to keep off their
profile (T-056). Below the floor the module is `not_supplied` — accurate, since
there is genuinely no consensus to supply — while `last_updated_at` still
reports when the last of those predictions arrived, so nothing is hidden.

Five is a floor, not a claim that five is enough for confidence. It is the point
below which publishing is indefensible rather than the point above which the
number is good. A page that shows the sample lets a reader judge the rest.

**Rejected:** weighting every rating and flagging provisional ones in the
payload. It moves the judgement to whoever writes the next page, and the first
page that forgets the flag presents guesswork as the community's considered
view, with nothing failing.

---

## D-053 — Moderation is built before the first member can message another, not after

**Date:** 2026-09-13 · **Task:** Phase 3 planning · **Status:** accepted

`01-roadmap.md` lists Phase 3 as "friends, private groups, direct and group chat
over WebSockets; public match discussion; community-written analysis; moderation,
reports, sanctions, audit history" — moderation last, after three epics of
surfaces that carry one member's words to another.

**Decision.** Reorder it. The social graph comes first (it is where blocking
lives), the moderation spine second, and **no messaging surface ships before
both**. Every conversational surface after that ships with block, mute, leave and
report in its own acceptance criteria rather than in a later epic.

**Why.** A moderation backlog is not a technical debt that accrues interest
quietly; it accrues on a person. The first unwanted message arrives the day the
surface opens, and if reporting is two epics away, the member who received it has
no block, no report and no recourse — and the only honest response is to take the
feature down again. Building the exits first costs one epic of ordering. Building
them afterwards costs whatever happened in between, to somebody who did not
choose to be the test case.

The blueprint agrees with this reading more than the roadmap did: blocking is
named in 8.1 as part of friendship itself, not in the moderation section, and 1.6
says abuse "must be reportable and manageable" as a property of social features
rather than as a later stage.

**Alternatives rejected.** *Shipping chat to a closed group of trusted testers
first and adding moderation before opening it* — reasonable in a funded team with
someone watching the room, and here it means the maintainer is the moderation
queue, at every hour, for as long as the gap lasts. *Relying on the existing
admin account-suspension (T-070)* — suspending an account is the largest
available action and the only one; a product whose only response to a rude
message is deleting a member has no proportionate answer and will therefore not
answer at all.

**Consequences.** `docs/04-tasks-phase-3.md` orders the epics E20 social graph,
E21 moderation, E22 conversations, E23 realtime, E24 groups, E25 public
discussion, E26 community analysis, E27 notifications. Sanctions are enforced at
the write path rather than by hiding output, so a restricted member is told; and
every sanction carries a scope and an end, because an unbounded restriction is
one nobody remembers to lift.

---

## D-054 — What Phase 3 deliberately does not build: uploads, an abuse classifier, and push delivery

**Date:** 2026-09-13 · **Task:** Phase 3 planning · **Status:** accepted

Three things a community phase is expected to contain are left out on purpose.
Recording them here is the point: an unbuilt corner that nobody wrote down is
indistinguishable from an oversight, and somebody eventually builds it in a
hurry.

**No user-uploaded images or files.** Blueprint 8.3 lists it and marks it
optional in the same sentence: "only if the platform deliberately enables and
manages it; it is not required by this blueprint". Accepting uploads means object
storage, scanning, a moderation queue for binary content nobody can skim, and a
legal exposure that is different in kind from text. Chat is text and structured
football cards (T-222). If uploads are wanted later they are a
project, with their own decision entry.

**No automated abuse-language classifier.** Blueprint 10.4 allows that automated
filters "can assist with spam and abusive language". The two halves of that
sentence are not alike. A **rate** limit is a rule about volume, works identically
in every language, and is built (T-213). A **classifier** for abusive language is
not: anything buildable here is an English keyword list with some regular
expressions, it would ship on a product that speaks eight languages, and it would
under-moderate seven of them while the administration page reported that
filtering was on. That is rule 3 — never fake coverage — wearing a safety label,
and it is worse than the honest absence because it invites the moderation team to
trust it. Reports and human decisions are the mechanism; the admin surface says
which of the two caught what.

**No push or email notification delivery.** Blueprint 12.2's *controls* — types,
quiet hours, frequency limits, deep links — are Phase 3 (E27) because the
features of this phase are useless if a friend request is never noticed. The
*delivery channels* are Phase 4: push needs a service worker subscription flow
and a signing key, email needs the mail provider that T-074 leaves to the
maintainer, and both are campaigns-and-deliverability work rather than community
work.

**Alternatives rejected.** *A word list behind an "experimental" label* — nobody
reads the label, and the queue it does not fill looks like a queue that is under
control. *Images via a third-party embed only (paste a link, we render it)* —
that is uploads with the storage problem outsourced and the moderation problem
retained, plus a request from our servers to an arbitrary host.

**Consequences.** Messages are text plus football cards resolved by UUID.
Moderation is reports, human decisions and rate limits, and the product does not
claim otherwise anywhere a reader can see. Notification preferences are built
with no channel behind them but the inbox, which is exactly what Phase 4 extends.

---

## D-055 — The chat socket is plain `ws` on the server already running, and the `Origin` header is a security control

**Date:** 2026-09-14 · **Task:** T-230 · **Status:** accepted

D-010 reserved WebSockets for chat. Building one raised three questions the
decision did not answer: which library, what the socket is allowed to do, and how
a browser reaches it when D-027 says the browser never talks to the API.

**Decision.**

**One dependency: `ws`, attached by hand.** The gateway takes the Node server
Fastify already listens on, handles `upgrade` itself with
`WebSocketServer({ noServer: true })`, and does authentication before the
handshake completes rather than after. This is the same choice the SSE gateway
made for the same reason (D-034): the interesting part is the handshake, and a
wrapper hides exactly that. `@nestjs/websockets` was rejected because it adds an
adapter and a second lifecycle to own a `ws` server we would still configure;
`socket.io` because it is not WebSocket — it is a protocol above one, requiring
its own client, and it answers a reconnection problem we answer with sequences
(T-231) rather than with a framework.

**The socket delivers; it never decides.** Sending, removing, reacting, pinning,
muting and leaving stay on the HTTP surface of T-221, where every write already
passes the database guards (PL003 to PL007). A socket that could also write would
be a second place to get those guards right, and two places drift. The client
frames are `subscribe` and `unsubscribe`, and nothing else.

**Authorisation happens at subscribe and again at every delivery.** A socket is
long-lived; membership is not. Each delivery re-asks the store, and a
subscription whose membership has ended is closed with a `dropped` frame rather
than waiting for a reconnect. The re-check also has to ask a *second* question:
`participation()` deliberately still returns a row after a member leaves, so
history stays readable (T-223) — live delivery is not the same question as
readable history, and the socket asks both.

**The `Origin` header is the whole defence against cross-site socket hijacking.**
A WebSocket handshake is not subject to CORS: any page on any site can open one
to us and the browser will attach the session cookie. `Origin` is the only thing
that separates our page from somebody else's, so the allow-list
(`WEB_BASE_URL`, plus `CHAT_ALLOWED_ORIGINS` for an edge that differs) is an
access control and not a convenience setting. A handshake with **no** `Origin` is
allowed: only a browser has the ambient cookie this protects, and a browser
always sends one.

**A session that ends closes the socket.** The heartbeat re-authenticates every
connection, so logging out hangs up the delivery channel instead of leaving it
open until the tab closes. The cost is that the connection holds its session
token in memory for as long as it is open; the alternative is a socket that
outlives the session behind it.

**Consequences.** The browser cannot reach the socket yet, and that is
deliberate: D-027 routes every browser request through the web origin, Next.js
route handlers cannot answer an `upgrade`, and the answer is an edge route
(Caddy proxies WebSockets transparently) rather than a second public origin with
CORS. That route, and the page that uses it, are **T-234** — after T-231, because
there is no reason to connect a browser to a transport that nothing publishes
into yet. The Koyeb preview (D-051) has no such edge, so the socket is not part
of what that preview demonstrates, and it says so.

---

## D-056 — Chat fan-out is Redis pub/sub on one channel, and a bus that cannot deliver says so

**Date:** 2026-09-14 · **Task:** T-231 · **Status:** accepted

T-230 built a socket that delivers whatever it is handed. This is what hands it
things when the message was written somewhere else.

**Decision.**

**Redis pub/sub, on one channel, from the first commit.** `fmip:chat` carries
every broadcast; every instance receives all of them and drops the ones no local
socket subscribed to. In-process fan-out was never a step on the way: it works on
one instance, works in a one-instance preview, and then delivers half the
messages the day there are two — a failure that is invisible in development and
total in production.

**One channel rather than one per conversation.** Per-conversation channels would
save the local filter and cost a Redis subscription table that must stay in step
with the socket registry through every subscribe, unsubscribe, leave, disconnect
and crash. That is a second source of truth for who is listening, which is the
class of bug this epic is built around. The filter is a `Set.has` per broadcast
per instance. Sharded channels are the answer when that is measurably the
bottleneck, and T-233's numbers are what would say so.

**At-most-once delivery, deliberately.** Redis pub/sub drops a message for an
instance that is disconnected at that moment. The answer is not a durable stream:
every message already carries a sequence number, and a client that reconnects
asks for everything after the last one it holds (T-235). A stream would add
durability we would still have to reconcile against sequence, and two mechanisms
for one guarantee is one more than the number that stays correct.

**A publish that fails never fails a send.** The message is stored, guarded and
answered for before anything is published. A bus that is down costs immediacy,
not the message.

**Without `REDIS_URL` the bus is absent and admits it.** It logs once, reports
`healthy: false`, and T-233 publishes that. The alternative — an object that
accepts broadcasts and delivers nothing — is rule 3's "never fake coverage"
applied to a transport, and it is the exact thing every paragraph above is trying
not to build.

**Alternatives considered.** *Postgres `LISTEN`/`NOTIFY`*, which the live score
feed already uses (D-034): it works, and it was rejected here because chat volume
is member-driven rather than fixture-driven, and putting it on the database
connection pool couples message delivery to the same resource the writes need.
*Redis Streams with consumer groups*: durability per instance, at the price of
per-instance cursors to maintain and prune, answering a question sequence numbers
already answer. *Socket.io's Redis adapter*: brings the framework rejected in
D-055 to get the fan-out we can write in a file.

**Consequences.** `REDIS_URL` becomes a requirement for live chat rather than
only for the ingestion queue, and CI gains a Redis service so the two-instance
test runs instead of skipping. `ioredis` becomes a direct dependency of
`apps/api` — which also repairs BullMQ, whose Redis client is an *optional* peer
dependency that nothing had installed, so the ingestion scheduler (T-026) would
have thrown on boot the first time it was switched on.

---

## D-057 — How you get into a group follows from its visibility, and the one-owner rule is a deferred constraint

**Date:** 2026-09-14 · **Task:** T-240 · **Status:** accepted

The Phase 3 plan settled that groups have three visibilities and that the middle
one — discoverable-private, found but not read — is why there are three.
Building the schema raised three questions it did not answer.

**Decision.**

**The join route is derived from the visibility, not stored beside it.** Public:
you join. Discoverable: you ask, and an owner or a moderator answers.
Invite-only: you are invited, and there is nothing to ask for. A second column —
a join policy crossed with a visibility — would have been nine combinations of
which several mean nothing ("invite-only, but anyone may join") and one is a
silent contradiction ("invite-only and discoverable"). The database refuses the
wrong route rather than a query filtering it: asking to join an invite-only or a
public group raises `PL011`.

The case this deliberately does not serve is a group readable by everyone that
still approves its members. It is a real shape and the product does not have it
today. A `join_policy` column is the extension point, and it should arrive with
the case that needs it rather than ahead of it — the same reason
`sanction.scope` has only ever listed what something enforces.

**Exactly one owner, enforced in two halves.** *At most one* is a partial unique
index on `group_member (group_id) WHERE role = 'owner'`. *At least one* is a
**deferred** constraint trigger (`PL009`), checked at commit rather than per
statement — because handing a group over is demote-then-promote, and a
per-statement check would refuse the moment in between and make the one safe way
to pass a group on impossible. The same function guards the group table too, so
a group that never gets an owner is refused at commit rather than existing
ownerless.

**A slug never changes** (`PL008`). A group link is shared into conversations
(T-222), and a renamed slug would break every share silently — the failure
nobody reports because nobody knows it happened. The display name is what
changes.

**A `groups` sanction stops the outward moves and nothing else.** Making a group
and joining one are refused (`PL004`); reading and leaving are not. This is the
gate pointing the same way it always does in this product: reaching *into* a
place is a privilege, getting *out* of one never is.

**Why.** Every one of these is the same argument in a different place: a rule
that lives in one query leaks the first time somebody writes a second query. The
rules that define what a group *is* — its visibility, its roles, its owner —
belong where nothing can route around them.

**Alternatives considered.** *A `join_policy` column from the start*: more
product surface than the blueprint asked for, and most of the grid is
meaningless. *A `BEFORE` trigger for the owner rule*: simpler to read and it
makes handing over ownership impossible, which is worse than the complexity it
saves. *A mutable slug with redirects*: a table of former slugs, forever, to
avoid a rename nobody needs. *Naming the table `"group"`*: a reserved word in
every statement that touches it, quoted forever, for a word — `user_group` sits
beside `user_account`, `user_block` and `user_prediction`.

**Consequences.** Four tables (`user_group`, `group_member`, `group_invite`,
`group_join_request`), four new SQLSTATEs (`PL008` a renamed slug, `PL009` an
ownerless group, `PL010` somebody already a member, `PL011` the wrong way in),
and three new ceilings. `sanction.scope` gains `groups`; `report.subject_type`
and `moderation_decision.subject_type` gain `group` — in this migration, because
a group is now a thing that can be reported. Deleting an account that owns a
group is refused until the group is handed on or deleted, which is the deferred
constraint doing exactly what it says.

---

## D-058 — A group conversation's membership is the group's, not a copy of it

**Date:** 2026-09-14 · **Task:** T-245 · **Status:** accepted

The acceptance criterion was "membership changes take effect on the conversation
immediately", and there were two ways to get it.

**Decision.** `group_member` **is** the membership of a group conversation.
`conversation_participant` keeps what it is actually for -- the read position and
the mute -- and carries no authority at all. `refuse_non_participant()` branches
on the conversation's kind: a direct conversation asks
`conversation_participant`, because there is nowhere else its membership lives; a
group asks `group_member`. On the read side, `ConversationsStore.participation()`
does the same, and it is the single place the conversations module asks "is this
viewer in this conversation" -- the page, the search, the catch-up, the socket's
subscribe and the socket's delivery re-check all come through it, so teaching one
query about groups made a membership change immediate on all of them at once.

The participant row for a group is written the first time somebody reads or
mutes, not the moment they join. Its absence means "has read nothing", never "is
not here", and every column taken from it is coalesced accordingly.

**Why.** The alternative was to mirror `group_member` into
`conversation_participant` with triggers: join writes a row, leaving sets
`left_at`, a removed member gets the same. Two records of who is in the room,
kept in step by code that has to be right every time, and "immediately" true only
for as long as the mirror is. Every bug in that shape is invisible at the moment
it happens and looks like a permissions failure a week later. With one record
there is nothing to synchronise, so there is nothing that can drift, and the
criterion holds by construction rather than by vigilance.

**Consequences.**

*Leaving means two different things, deliberately.* A direct conversation can be
left and still read (T-221, T-223): half of it is yours, and the other person's
copy is unaffected. A group is a place, and leaving it means you are not in it --
the history goes with the membership. `POST /me/conversations/:id/leave` on a
group conversation is therefore refused with "leave the group instead" rather
than setting a `left_at` that would change nothing and report success. A silent
no-op is the failure rule 3 exists to prevent, wearing the shape of a result.

*A group conversation's summary carries its group and no members.* `group`
non-null is exactly when `members` is empty, so the pair is never ambiguous: it
is not a conversation *with* particular people.

*Two members who have blocked each other share the room.* The message block
guard was written direct-only in T-220 and stays that way. A block stops them
reaching *each other* -- which is why the mention guard of T-225 exists, and this
is the migration that finally made it reachable.

**Alternatives considered.** *Mirroring with triggers*, above. *Dropping
`conversation_participant` for groups entirely*: the read position and the mute
have to live somewhere, and a second table for them would be the same duplication
one layer down. *Letting a group conversation be left like a direct one*: two
ways out of one place that mean different things, and the one that does nothing
reports success.

---

## D-059 — The Phase 3 policy is settled as configuration, and the two texts it needs are drafts until the maintainer approves them

**Date:** 2026-09-15 · **Task:** T-250 (and E25, E26 behind it) · **Status:** accepted

`docs/04-tasks-phase-3.md` says in three places that what Phase 3 is blocked on
is not code but policy: what the platform rules say, what conduct earns which
sanction, and who qualifies as a contributor. Those answers now exist.

**Decision.** `docs/13-policy.md` holds them. The numbers are configuration and
reach the code as named constants; the two member-facing texts are **drafts**
carried in the same file and marked as drafts, because the words are editorial
and legal judgements (`CLAUDE.md` §7) and drafting one is not approving it.

**The thresholds confirm `privilege-eligibility@1.0.0` rather than replacing
it.** A rating of 70 over at least 50 settled predictions were already the values
in `eligibility.ts`; what is new is the fourth requirement its own comment
promised — a clean recent conduct record — fixed at no active sanction and no
`sanctioned` decision in ninety days.

**The conduct ladder is shown to a moderator, never applied by code.** D-053 put
the exits before the surfaces and put a person at every one of them; a table that
sanctioned automatically would undo that, and would do it while the admin page
reported that a human had decided. So the ladder is what the surface offers as a
default duration, and a moderator who departs from it records why — which is
already how every decision works.

**Counting runs per reason.** A member warned for spam and later reported for
abuse meets the abuse row at its first step. Merging the two into one ladder
would escalate a second behaviour for the weight of an unrelated first one.

**An approval does not expire.** A yearly re-review is a deadline nobody keeps,
and a lapsed one reads as a judgement when it was only a calendar. Pause exists
for the case a review would have caught, and is honest about being somebody's
decision.

**What this does not decide.** Who is approved. The gate says who qualifies; a
person decides who gets through it, and cannot before there are members with
fifty settled predictions — which is after a real deployment (T-074).

**Rejected.** *Leaving the rules text to the code and shipping categories alone*:
`report_reason` values are not rules, and a member accepting "spam, abuse,
impersonation" as a list has accepted nothing. *An automatic sanction ladder*:
faster, and it would make the report queue a formality. *A rating threshold with
no floor on settled predictions*: it would be met most easily by predicting
almost nothing, which is the failure D-037 already refused once.

---

## D-060 — The group board is the global board with its population narrowed, and reputation imports groups rather than the reverse

**Date:** 2026-09-15 · **Task:** T-243 · **Status:** accepted

Blueprint 9.3 lists group-based boards beside global ones, and the obvious
implementation is a second ranking. A second ranking is how a group board ends
up flattering small groups.

**Decision.** There is one board. `ReputationService.leaderboard` gained an
optional set of members and nothing else: same rules version, same floor, same
formula, same tiers, same parser. `PostgresRatingStore.board` gained one
predicate on that set. There is deliberately no second method, because a second
method is where a second formula begins -- and the test does not compare numbers
between the two boards, it compares the *rules* they report and fails if they
differ.

**The rating is global and the rank is scoped.** A member's rating comes from
their settlements, not from their company, so it is the same number on both
boards. What the group board narrows is the population, and therefore the
position -- a board showing rank 4,891 of 12,300 would not be a board.

**The floor does not bend.** D-037's minimum-sample filter applies unchanged, so
a group whose members have all settled fewer than the floor has an empty board.
It says which filter emptied it, because an empty list would say nobody is in
the group, which of a group is never true (rule 3).

**The dependency points from reputation to groups.** Each boundary needs exactly
one answer from the other, so the direction is a choice about what each drags in.
Reputation reads match difficulty from forecast; importing it into groups made
every group test require `MODEL_SERVICE_URL` in order to list members. So groups
answers `audience()` -- who is in this group, and may you ask -- and the ranking,
along with every rule behind it, stays where those rules already were.

**Who may see a board is who may see the membership**, because a board is the
membership with numbers beside it. The predicate is the one `read()` already
uses, an invite-only group nobody may know about is still 404, and the page
fetches the board only where `members` came back non-null rather than asking a
second time and rendering the refusal.

**Rejected.** *A `group_leaderboard` view or table*: a second place for the
ranking to drift. *A lower floor for small groups*: the failure D-037 refused
once, wearing a friendlier face. *A join against `group_member` inside the
reputation store*: it would work, and it would teach the reputation boundary what
a group is -- the set of ids keeps it ignorant and is the same door the
friends-only board of blueprint 9.3 will use.

---

## D-061 — News comes from free publisher feeds as headline and link, and every source carries its own rights so a licensed one is an adapter rather than a rewrite

**Date:** 2026-09-15 · **Task:** T-140 · **Status:** accepted

The gate `CLAUDE.md` §7 requires before any article ingestion is written: news is
other people's copyright, and a feed is licensed, syndicated with rules, or
scraped.

**Decision, from the maintainer.** Free sources for now, **and** the ability to
take a licensed one later built in from the start rather than promised.

**What "free" actually permits, which is narrower than "news".** Publisher
RSS/Atom feeds, and from each item only what the publisher put in the feed for
that purpose: headline, their own summary, byline, publication time, and a link
to the original. **Not** the article body, not paywalled content, not images
re-hosted here. Every item shows the publisher's name as a link to their page,
and a publisher who asks to be dropped is dropped without argument. Fetching
obeys `robots.txt` and each feed's stated terms.

**So the product's news is a front page that sends readers to publishers**, and
saying that out loud is the point: a section that looked like full articles while
holding three-sentence summaries would be rule 3 wearing a newspaper's clothes.
Blueprint 3.3's article page is built against what a source actually grants.

**Rights live on the source, and surfaces obey them.** A `news_source` carries
what may be shown -- headline-only, summary, or full text -- and the renderer
asks rather than assumes. This is what makes "a licensed source later" an
adapter and a rights row instead of a rewrite, and it is why the constraint is
structural now, while there is only one kind of source, rather than retrofitted
when there are two.

**Nothing here is on the critical path** (D-014, rule 9). News is a section; a
match, its score and its forecast never depend on it. A source that goes away
takes its own items with it and nothing else.

**No translation of a publisher's words.** An Arabic reader gets the headline in
the language the publisher wrote it, with the interface around it translated --
machine output presented as a publisher's sentence is the same invention rule 3
forbids and T-151 already refused once.

**Rejected.** *Scraping article bodies*: it is the version that looks best in a
demo and is the one CLAUDE.md §7 names. *Waiting for a licence before building
anything*: four tasks blocked on a purchase that is not planned, when the
schema's hard parts -- entity links by UUID, story clustering, per-language
versions -- are the same either way. *One rights setting for the whole product*:
it would be wrong the first day a second kind of source arrives, which is the day
this decision exists to prepare for.

---

## D-062 — A match thread is a conversation with a fixture on it, not a new kind of place

**Date:** 2026-09-15 · **Task:** T-244 · **Status:** accepted

Blueprint 8.2 asks for "group chat and match-specific discussion threads", and a
thread has every attribute of a small forum: a subject, its own unread count, its
own mute, its own membership.

**Decision.** It is a `conversation`, with `kind = 'group_thread'`, `group_id`
and `fixture_id`. Its membership is the group's, exactly as the group's own room's
is (D-058). What that buys is everything already built: it arrives in the
conversation list, the socket delivers it (T-230), the search finds it (T-224),
the catch-up fills it (T-235), a `messaging` sanction silences it, and a member
removed from the group loses it at once. None of that is code written for
threads, and all of it would have had to be written -- and kept right -- if a
thread had been its own table.

**The subject is on the row, not in a title.** `fixture_id` is what lets a thread
be listed under its match, linked to it, and refused a duplicate: one thread per
fixture per group, by unique index. A title would have given the product a
string, which is not a match.

**And the subject is read now, not stored.** The thread's fixture comes back
through the same read a shared fixture card uses, with the same
`last_updated_at`, so a thread about a match that has since kicked off does not
still say it is scheduled (rule 4). One mapper serves both, because two would be
two places for a stale score to be shown as a current one.

**Two constraints had to be narrowed, and one had already been written wrong.**
`conversation_one_per_group` predates threads and, left alone, refuses a group
its first thread with a duplicate-key error. And the standing query's direct
branch read `kind <> 'group'`, so a new kind fell into it by default -- a thread
would have been admitted on a `conversation_participant` row it never has. Both
branches now name their kinds: an untaught kind belongs to neither, which is a
conversation nobody can open rather than one anybody can.

**Opening a thread is guarded in the database (`PL012`), not only in the API.**
A thread in a group its opener is not in would be a room they could then write
in, because the write guard asks the group rather than the row. The API check
above it is the courteous answer, not the control.

**Both BEFORE guards step aside for a malformed row.** A `group_thread` with no
group reached the membership trigger first and was told "only a member can open a
thread in it" -- true of a row naming a group, a misdiagnosis of one naming none.
The membership guard and the ceiling now skip such a row so the shape CHECK, which
actually describes what is wrong, is the one that answers.

**Rejected.** *A `group_thread` table with its own membership and read state*:
four things to keep in step with the group, and "immediately" true only while
they are. *A thread as a message subtype inside the group's room*: it would make
the room's unread count the thread's, and a group that discusses three matches
would have one conversation nobody can follow. *Threads outside groups*: that is
E25's public panel, which is gated on approval and is not this.

---

## D-063 — A group's prediction comparison repeats the stored settlement and obeys the member's own visibility, adding no rule of its own

**Date:** 2026-09-15 · **Task:** T-246 · **Status:** accepted

Blueprint 8.2 asks for prediction comparisons inside a group. The shape that
invites two defects: scoring the calls where they are displayed, and deciding
afresh who may see them.

**Decision.** The comparison computes nothing and decides nothing. Each call
carries the settlement stored for it (T-052), read through the same mapper the
single settlement read uses; whether a member's calls may be shown is
`prediction_history_visibility`, asked of the profile boundary exactly as
`GET /users/:username/predictions` asks it.

**Never a second settlement is the load-bearing half.** A comparison that scored
the calls itself would be a second answer to "was this right", and on the day the
two disagreed there would be no saying which was the product's (rule 8). The test
writes a settlement deliberately at odds with the obvious reading of the score
and expects the comparison to repeat it -- a comparison that recomputed would
"correct" that row and pass every test that only checked plausible data.

**The silent and the withheld are separate numbers.** A member who said nothing
and a member whose calls this viewer may not see are different facts, and neither
may be dropped: a comparison that quietly omitted both would report a smaller
group than exists and a reader would take the calls shown for all of them
(rule 3).

**A group can therefore see a call before kick-off**, because a profile already
can. That is a consequence of adding no rule, not an oversight, and it is
recorded in `docs/13-policy.md` §7 with the one-condition change that would
reverse it -- the maintainer's to make, since it would override a setting members
have already chosen.

**Visibility is asked once per member who actually called the fixture**, which
bounds it: a group of fifty with eight calls asks eight times. A bulk answer
would have meant re-implementing the rule in SQL, which is the second rule this
decision exists to avoid.

**Rejected.** *Computing the verdict at display time*: faster to write, and it
is the second settlement. *A group-wide visibility setting*: a second control
over the same thing, and the first one to be forgotten. *Hiding a call until
kick-off by default*: defensible, and it silently overrides the member's own
`public` choice -- a decision for the maintainer to make explicitly, which is now
possible because the place to make it is written down.


## D-064 — The preview runs on Render with a Neon database, keeping the shape D-051 chose and replacing only the host

**Date:** 2026-09-15 · **Task:** T-086 · **Status:** accepted

D-051 put the preview on Koyeb's free Instance. Koyeb was acquired by Mistral in
February 2026, turned toward AI infrastructure, and stopped offering the free
Instance to new accounts; its plans now begin at $29/month. The maintainer's
account, opened on 2026-09-15, is a new one. So the preview had no host, three
days after it had one.

**What was actually lost.** Very little, and this is the part worth recording.
Of the three files under `deploy/`, exactly one named Koyeb: the script that
called its CLI. The image holding the web app and the API on one port, the
supervisor that takes the container down if either half dies, the declared
absences — none of that was ever about the platform. The directory is now
`deploy/preview/` and the script is gone.

**Decision.** Render runs the container, Neon holds the database.

*Render*, because its free tier is still real in 2026, it needs no card, it
builds a Dockerfile straight from the repository, and `render.yaml` makes the
whole service reviewable in git. It sleeps after 15 minutes and wakes in about
one — a worse nap than Koyeb's hour, and the same kind of trade-off D-051
already accepted.

*Neon and not Render's own Postgres*, because **Render deletes a free database
after 30 days.** A preview that expires on a schedule is a worse failure than no
preview: it breaks weeks later, silently, for a reason nobody still remembers,
and the first person to notice will be looking at an unrelated bug. Neon's free
project is permanent and allows `CREATE EXTENSION` for `pg_trgm` and `unaccent`,
which T-038's search migration needs.

**The address is no longer a step to remember.** On Koyeb, `SITE_URL` and
`WEB_BASE_URL` were set by hand after the first deploy, and forgetting them left
canonical links, the sitemap, the manifest and every link in an e-mail saying
`localhost` — wrong in a way that raises no error anywhere. `start.mjs` now
takes the address from the platform when neither variable is set, and logs which
source it used, including neither. `RENDER_EXTERNAL_URL` is the one
host-specific name in the image, and it lives in the supervisor because that
file *is* the deployment: the app reads its own two variables and knows nothing
about who set them.

**Rejected.** *Paying for Koyeb Pro*: $29/month for a preview, and no session
spends the maintainer's money (`CLAUDE.md` §7). *Render's free Postgres*: one
fewer account, in exchange for a deployment with a 30-day fuse. *Going straight
to the VPS (T-074)*: defensible — the preview exists only to exercise the live
path before there is a server — but it converts a free step into a purchase and
a deploy, and the maintainer chose to keep the preview. *Fly.io, Railway*:
neither has a free allowance worth the name in 2026. *Holding the preview until
the VPS exists*: leaves T-085's tunnel, which cannot carry the stream, which is
the entire reason T-086 exists.

**What would reverse this.** T-074. Once the product has a server, the preview
is a second place for the same thing, and the reason to keep it is habit.

---

## D-065 — Demonstration data is a statement the deployment makes about itself, separate from the instruction that loaded it

**Date:** 2026-09-16 · **Task:** T-087 · **Status:** accepted

Phase 3's exit criteria say the social list is checked **on the public
deployment**. The preview's database was empty, so none of it could be. The
maintainer chose to load development fixtures rather than leave the phase
formally open until there is a VPS.

That puts matches that were never played on an address anybody can open, which
is rule 3 — inventing a value — told to every reader and every crawler. So the
fixtures ship with four things saying so, and one guard making them
inseparable from the data.

**Decision.** `DEMONSTRATION_DATA=on` is a statement about what the database
holds. The web app then carries an undismissable band on every page, prefixes
every page title, marks every page `noindex`, empties the sitemap, and has
`robots.txt` forbid the whole site. `deploy/preview/start.mjs` refuses to boot
if `PREVIEW_SEED=on` and this is not.

**Why it is not `PREVIEW_SEED`.** That variable is an instruction, and it is
spent the moment it runs: turn it off afterwards and the fixtures are still in
the database. A marker keyed on it would disappear while the thing it marks
stayed — which is the failure it existed to prevent, arrived at by tidying up.
`DEMONSTRATION_DATA` stays true for as long as the data does.

The tie runs one way on purpose. Marking a deployment nobody seeded costs
nothing. Seeding one that is not marked is the thing that must not be possible,
so that is the direction the guard refuses in — and it refuses rather than
warns, because a warning in a boot log is read by nobody and the container goes
on to serve the pages anyway.

**Why the crawler gets two answers and not one.** `noindex` is what a crawler
obeys after fetching a page; `robots.txt` is what stops it fetching. Both,
because an invented score in a search index outlives the deployment that
produced it: the preview can be emptied and the snippet stays. The sitemap is
emptied as well, because a sitemap is fetched even where `robots.txt` forbids
crawling, and a map of matches that never happened is the same claim made
twice.

**Why the title is a Next.js template and not a prefix in `pageMetadata`.**
Nine pages export a plain `metadata` object and never call that function. A
prefix added there would have missed every one of them, and the miss would have
been invisible — the pages would have looked fine. A template on the layout
applies to whatever a child segment set, however it set it.

**The cost, named.** `DemonstrationBanner` calls `connection()` before it reads
the environment, because Render supplies the variable at runtime and not to
`docker build`; a check that ran during prerendering would read nothing, decide
"not demonstration data", and bake a page of invented scores with no marker on
it. That stops prerendering for every page. Twenty-six of the thirty were
already `force-dynamic`; the three that were not — `offline`, `forgot-password`,
`reset-password` — carry no football data and no meaningful saving, and the
service worker caches the offline page's response rather than its rendering
mode, so T-082 is unaffected. If it ever costs more, the fix is a Docker build
argument, not a quieter banner.

**What this does not close.** Setting `DEMONSTRATION_DATA=off` by hand while the
fixtures are still in the database removes the marker and leaves the data. No
guard here prevents that, and the honest reason is proportion: it is a
deliberate act by the one person who knows what the database holds, and closing
it would cost a migration and a query on every page render. `start.mjs` states
the marker's value at every boot so the log answers the question.

## D-066 — The translator's catalogue is a JSON file per locale that a fluent speaker edits directly, with the English beside every key and a status a person set

**Date:** 2026-09-18 · **Task:** T-302 · **Status:** accepted

**Decision.** `apps/web/src/i18n/catalogues/en.json` is the source of every
message the product shows. Each other locale has one file beside it carrying
every source key as `{ source, text, status, note? }`, where `status` is
`untranslated` (text empty; the page shows English and says so), `translated`
(a fluent speaker wrote it) or `reviewed` (a second fluent speaker approved it,
blueprint 13.2). `messages.ts` only reads these files. A script refreshes them
from the source and never touches a translation; a spec fails on a stale
`source`, a missing or extra key, or a status the text does not support.
"How much of `tr` is done" is `coverage(locale)` -- four numbers the product
computes -- and not a grep.

**Why JSON, in the repository, and not a translation platform or `.po`/XLIFF.**
The catalogue is twenty-one keys and will be a few hundred. A fluent speaker
with a text editor can open a JSON file, see the English on the same line, and
write beside it; nothing has to be installed, no account has to be created
(§7), and the change arrives as a pull request the same way everything else
does, reviewed by whoever reviews it. `.po` and XLIFF would each be a format,
a parser and a tool the maintainer does not have, for a benefit -- translation
memory, plural forms -- the first of which blueprint 13.1 wants eventually and
the second of which T-301 will need. When T-301 arrives the entry gains a
`forms` field keyed by CLDR category; the file shape was chosen so that is an
addition, not a migration.

**Why the English is copied into every file.** A translator who has to open
`en.json` in a second window to know what they are translating will stop
looking, and the day a source string changes they would go on translating the
old sentence. Copying it costs nothing and makes staleness a thing a test can
see: `source !== EN[key]` fails the build.

**Why a script that refuses.** Refreshing drops a key the source no longer has
*only if it carries no text*. A translation is removed on purpose, by a person,
never by a script that noticed the English moved; the script stops and names
the key. The same shape as every other guard in this repository: it does the
safe thing and reports the unsafe one, rather than warning and continuing.

**What `reviewed` changes.** Nothing a reader sees: a translated and a reviewed
string are both a person's words and render the same way. `isShippable` counts
both as done, because blueprint 13.2's review is for headlines, founder
analysis and sensitive claims, not for "Sign in". The number is reported so
that whoever decides a language is finished can see how much of the done part
a second speaker has read -- a decision that stays theirs (`14-maintainer.md`
§1), now with the information it needs.

## D-067 — A plural is a catalogue entry of CLDR forms, selected by `Intl.PluralRules`; a translated entry missing a form its language has fails the build

**Date:** 2026-09-18 · **Task:** T-301 · **Status:** accepted

**Decision.** A key whose English is an object of forms keyed by CLDR category
(`one`, `other`, …) is a plural. The category for a count comes from
`Intl.PluralRules` for the locale — cardinal, or ordinal when the English says
`type: "ordinal"` — and the form for it from the locale's file when the entry
is translated, otherwise from the English, marked `untranslated` like any
other fallback and selected by *English* rules. `{count}` is filled with the
number in the locale's own digits and grouping; other `{name}` placeholders
from the call site. A translated entry must carry **exactly** the categories
its language has, every one filled: the script refuses the file and the spec
fails the build. Nothing fills a missing form in.

**Why exactly, and not at least.** "At least `other`" would let Arabic ship
with two forms out of six and read correctly for 0 and 1 and wrongly for 2,
3–10 and 11–99 — a sentence wrong in a way only a native speaker sees, which
is the failure this task exists to make impossible. "Exactly" also catches the
opposite: a form for a category the language does not have is a translator
guessing at English's grammar, and it is refused with the same message.

**Why the English fallback is selected by English rules.** A count of 2 on
`/ar` with no Arabic forms yet shows "2 members"; asking Arabic's rules would
have picked `two` and found nothing, or picked a form the English does not
have. The fallback is English text, so English arithmetic.

**Why `message()` still answers a plural key.** With the `other` form, its
placeholders unfilled. "Never returns a blank, for any key in any locale" is a
promise the spec makes over every key, and a plural must keep it; what it must
not do is be rendered that way, so pages render plurals through `plural()`
and `Translated` takes a `count`.

**Why the ordinal is one of the seven.** `lib/team.ts` spelled "1st, 2nd,
3rd, 11th" by hand, in English arithmetic, on a page that ships in eight
languages. English ordinals have four categories, French two, Italian two and
Arabic one; the hand-rolled version could not have been right in any of them.
`type: "ordinal"` selects `Intl.PluralRules`' ordinal rules and the file shape
is otherwise unchanged.

**What the file shape gained, as an addition.** A plural entry carries `forms`
where a sentence carries `text`; D-066 said this would be an addition and not
a migration, and it was — the six existing sentence files refreshed with the
seven new keys as `untranslated` and nothing else moved.

## D-068 — Public discussion goes live over the fixture stream, not the chat socket

**Date:** 2026-09-18 · **Task:** T-254 · **Status:** accepted

**Decision.** A panel post raises `fixture_change` like a goal does, and the
match page's server-sent stream turns that into a `panel` event -- no payload
beyond the time, because the page re-reads the panel the way it already reads
it. The stream is the one the match page already holds open, it is public, and
it reaches guests and members alike.

**Why not the chat socket.** Blueprint 14.1 lists WebSockets for "direct, group
and public chat", and the chat gateway is where members' conversations are
delivered. But the gateway refuses a handshake with no session, and a public
panel is read by everybody: routing it through the socket would make "arrives
in real time" true for signed-in readers and false for the rest, on the one
discussion surface that is public. The fixture stream (D-034) is already the
public live transport on exactly this page. One transport per page, and the
one the page has.

**Why an event with no payload.** `LiveConversation` (T-237) set the shape: the
client renders nothing from an event and asks the page to render itself again,
so there is one way a post can look. A snapshot would be the wrong event: the
panel is not part of the match centre, and re-sending the match for every
reply would cost every open page a payload it did not ask for. Snapshots are
for the match; `panel` is for the panel.

**What "live" means to a reader.** The same freshness line the page already
shows. A page whose stream is stale says so, and a panel under it is as stale
as the score beside it -- rule 4 is answered once, for the page.

---

## D-069 — Viewing data is editorial and link-only until a licence says otherwise

**Date:** 2026-09-18 · **Task:** T-310, T-313 · **Status:** accepted

**Decision.** The first viewing source is the editorial desk: a
`viewing_source` row of kind `manual` with `rights = 'link'`, fixed by id in
the T-313 migration. An editor declares which seasons the desk covers in which
territories, keeps the broadcaster list, and enters listings -- this match, in
this territory, on this service, with this access, at this official page --
and highlight pages, from public schedules. Nothing is ingested from anybody
and nothing is hosted: a listing is a fact an editor entered and signed (an
audit row), and a viewer is sent to the official destination.

**Why this road.** Three were open (`14-maintainer.md` §8): a licensed
listings provider, broadcasters' own schedules under their terms, or the desk.
The maintainer delegated the choice to the agent on 2026-09-18 under the
standing rule that nothing is bought and no account is opened, which leaves
the desk. It is also the only road that puts no third party's terms between
the product and a reader, and the schema was built (T-311) so that a second
source with more rights slots in beside it rather than replacing it.

**What it means for the surfaces.** Every territory the desk has not declared
is `not_supplied`: the product says it knows nothing about Turkey, not that
there is nothing to watch there. A territory the desk declared `available`
turns an empty listing into a fact. A highlight from the desk is the official
page and never a player -- the desk holds no rights to anybody's video,
`PL017` refuses an embed under it in the schema, and a surface renders a
player only for a source that grants one, which today is none.

**What it costs.** Editors' time, per match and per territory; the product
will cover few territories and say so. Coverage is per season, so a desk that
covers the Premier League in Iran and nothing else is honest by construction.

**Rejected.** *Scraping listings sites*: their terms, and a listing nobody
signed. *Inferring "not available" from an empty desk*: the failure the epic
exists to avoid (rule 3). *Waiting for a licence*: leaves blueprint 11 unbuilt
for a decision that may never be taken, when the honest half needs none.

**What would reverse this.** A licence (T-310 revisited): a second
`viewing_source` with `thumbnail` or `embed` rights, an ingestion job behind
it, and the same surfaces.

---

## D-070 — A language model runs behind one port, speaks only from the record, says it is a machine, and keeps every version

**Date:** 2026-09-19 · **Task:** T-401, T-402, T-403 · **Status:** accepted

**Decision.** Phase 5's four features share one boundary and four rules.

*The port.* A language model is a provider chosen at deployment, behind
`LANGUAGE_MODEL` in `apps/api/src/modules/intelligence/`, exactly as delivery
is behind `OUTBOUND_DELIVERY` (T-330). `INTELLIGENCE_PROVIDER=off` is an honest
absence that `/health/intelligence` reports and every surface of the phase
turns into a sentence; a provider this build cannot drive, or one it can drive
with no key beside it, refuses to start. Nothing on the critical path calls
the port: scores, the match centre, forecasts, predictions and settlement never
wait for a model, and a model that fails is an outcome a caller records, never
a page that falls over.

*The rules.* Machine text is **labelled** wherever it appears -- as a
machine's, with the model and the time (`MachineText`). It is **grounded**:
a prompt carries only what the product already serves under a coverage state,
with the absences named, and an answer is checked against those facts by code
before anyone sees it. It is **versioned**: every generation is an immutable
row with its inputs, model, prompt version and time, and a regeneration is a
new row with a reason in the audit log (rules 5 and 10). And it is **never a
fourth product**: the model is not asked who will win, and nothing it writes
is blended into the statistical forecast, the founder's analysis or the
consensus (rule 6). Machine translation stays out (T-151, D-066).

*The first adapter.* Anthropic's Messages API, through the official SDK
(`@anthropic-ai/sdk`, a new dependency, which this entry records per
`CLAUDE.md` §2), with the model named by `INTELLIGENCE_MODEL` and defaulting
to the reference's current default, adaptive thinking, an effort of `medium`
unless the deployment says otherwise, and the API's server-side refusal
fallback enabled. A refusal and a truncation are stop reasons the adapter
returns and the caller treats as rejections, never text.

**Why this adapter first, and the conflict named.** The agent that built this
phase is a Claude model. That is a reason to be careful about the choice,
which is why it is a decision entry and not a default: the port is
provider-shaped, `INTELLIGENCE_PROVIDER` is whichever name the maintainer sets,
and a second adapter sits beside the first the way a second viewing source
sits beside the editorial desk (D-069). The narrower reason this adapter came
first is that it is the API the agent can write from its documentation rather
than from memory -- model identifiers, thinking configuration and refusal
handling checked against the reference -- which for code that will run
unattended matters more than the name on it.

**What it costs.** Per generation, by the provider's token prices, and nothing
until a key exists: the maintainer decides when by putting one on the server
(T-400), which is the same shape as the delivery provider and the paid data
provider before it.

**Rejected.** *A model on the critical path* (summaries computed inside the
match centre's request): a slow or absent provider would take the page with
it. *Unlabelled prose*: a reader who cannot tell a machine's paragraph from the
founder's has been misled about the one thing the product promises to keep
apart. *Free-text chat with the model*: no surface takes free text and returns
free text; every prompt is composed by the product from rows, and every answer
is structured or gated. *Machine translation as a Phase 5 feature*: refused
twice already (T-151, T-305).

**What would reverse this.** A second provider, which is an adapter and a
name, not a change to any of the four rules.

---

## D-071 — The launch acceptance review is signed, with the real-fixture clause re-checked on the first real deployment

**Date:** 2026-09-19 · **Task:** T-084 · **Status:** accepted, conditional

**Decision.** The maintainer reviewed the roadmap's exit criteria for the
launch slice -- Phase 0 and Phase 1 -- with the agent on 2026-09-19, one
criterion at a time, each with the agent's finding and a recommendation, and
signed off on all of them.

*Phase 0, three criteria.* `docker compose up` runs Postgres, Redis, the API
and the web app: the production stack was rehearsed end to end on the
maintainer's machine on 2026-09-19 (`09-deploy.md`, "Rehearsal on a laptop").
CI is green: Verify, E2E and E2E journeys on `main` after PR #213. The
right-to-left pseudo-locale renders: `/x-rtl` on the public preview, and the
RTL test inside Verify. **Passed.**

*Phase 1, one criterion* -- "the acceptance list in `04-tasks-phase-1.md`
passes on a public deployment with real fixtures" -- reviewed in four parts.
Public read and live (E3): **passed** on the preview, where scores, search,
news and watch answer and every absence is a sentence. Accounts, predictions
and reputation (E4, E5): **passed**, on the E2E journeys and the preview's
surfaces, the leaderboard naming its formula and rules version. Model and
operations (E6, E7): **passed with a note** -- the model service in public and
the load test on a server are seen only on the real deployment; the preview
runs with the model off and says `model_unreachable`. Delivery (E8):
**passed** -- the PWA install was confirmed on Android on 2026-09-17,
accessibility and feed-failure resilience are green in CI.

**The condition.** The public preview runs demonstration data with the
scheduler off, so the words "with real fixtures" cannot be observed today.
The sign-off stands on CI and the preview, and **is re-checked on the first
real deployment (T-074)**: the same four parts, walked on the server with
ingestion on, and the result appended to this entry. If that walk fails, this
decision is reopened, not amended.

**Consequences.** T-084 is checked. The Phase 1 exit is closed subject to the
condition above. Phase 4 and Phase 5 have exit criteria of their own, checked
on the real deployment when those phases close, not here.

**Rejected.** *Waiting for the server before signing anything*: every
criterion but one clause is observable now, and a review that waits for the
last clause records nothing about the others. *Signing without the
condition*: it would claim a public deployment with real fixtures that does
not exist.

---

## D-072 — A second adapter behind the intelligence port: the chat-completions shape, Mistral as a named preset, and any compatible endpoint by URL

**Date:** 2026-09-19 · **Task:** T-404 · **Status:** accepted

**Decision.** D-070 said a second provider is an adapter and a name, not a
change to the rules, and the maintainer asked for one on 2026-09-19: Mistral's
free tier to test the phase with, and the freedom to run any language model
later. Both are one adapter, `internal/chat-completions-model.ts`: the `POST
/chat/completions` shape that Mistral's La Plateforme serves and most other
vendors and local runtimes answer, spoken over `fetch` with no dependency
added. It has two names in `INTELLIGENCE_PROVIDER`:

- **`mistral`** is a preset: the base URL, the key variable (`MISTRAL_API_KEY`)
  and a default model (`mistral-small-latest`) are known, and the effort the
  deployment set travels as `reasoning_effort`, which Mistral's reference
  documents. Studio's free mode is enough to exercise every surface of the
  phase.
- **`openai_compatible`** is any endpoint that answers the same shape, named
  by the deployment: `INTELLIGENCE_BASE_URL`, `INTELLIGENCE_API_KEY` and
  `INTELLIGENCE_MODEL`, all three required, because no default is honest for
  an endpoint nobody has named. It sends only the fields every such server
  accepts; a field one server does not know is a 400 on another.

The port's rules hold unchanged: `off` is an honest absence, a name this
build cannot drive still refuses to start, a driveable name with no key
refuses to start, and the finish reason is read before the text so a
truncation is an outcome and never prose cut off mid-sentence. There is no
`refusal` stop on this shape; a server that declines answers with an error,
which is a failure the service records. A 429 -- what a free tier says when
asked too fast -- is retried once after the pause the server names, capped
at five seconds, and then recorded as a failure the surface says out loud.

**Consequences.** `/health/intelligence` names the provider and the model as
before. Every `MachineText` carries the model that wrote it, so a briefing
written by `mistral-small-latest` says so. What the maintainer weighs when
choosing: the free tier's rate limits and the provider's terms on the data
sent, which for briefings is a member's feed; the choice of provider is
theirs and is a line in the server's `.env`.

**Rejected.** *Mistral's SDK*: a dependency for a request `fetch` sends in
twelve lines. *Streaming*: nothing in the phase shows text as it arrives;
every answer is gated before anyone sees it. *A per-provider adapter for
every vendor*: the shape is shared, and the generic name covers the ones
nobody has asked for yet.

**Learned on the free plan, 2026-09-19 (same day).** The workspace's free
plan served the Ministral models (`ministral-3b`, `-8b`, `-14b-latest`)
and answered 429 with `x-ratelimit-limit-req-minute: 0` for Small, Medium
and Magistral, and 403 for Large. Two consequences in the adapter, not in a
footnote: a 429 with a zero limit is thrown as "not in this workspace's
plan" rather than retried as "too fast", and a 400 that names
`reasoning_effort` (the Ministral models take none) turns the field off for
the rest of the process and sends again. The default model stays
`mistral-small-latest`; the free plan sets `INTELLIGENCE_MODEL`.

---

## D-073 — The e-mail channel is SMTP, which every service speaks and no vendor owns, and identity's mail leaves by it too

**Date:** 2026-09-20 · **Task:** T-330 · **Status:** accepted

**Decision.** The e-mail provider behind the delivery port (T-330) is not a
vendor's API but SMTP: `DELIVERY_EMAIL_PROVIDER=smtp`, `SMTP_URL` for the
whole connection (`smtps://user:pass@host:465`, or `smtp://host:587` with
STARTTLS) and `DELIVERY_EMAIL_FROM` for the sender. Every transactional
service -- Brevo, Mailjet, Postmark, Amazon SES, a self-hosted relay -- hands
out SMTP credentials, so the maintainer chooses the service on the day and
this build does not choose for them; the same shape the intelligence port
took with `openai_compatible` (D-072). `nodemailer` is the one dependency,
the standard transport for it in this ecosystem, added to `apps/api`.

**Identity's mail goes the same way.** The verification and the password
reset links (D-026 deferred their provider to T-074) now leave by the
delivery port's e-mail channel through `DeliveryMailer`, and where the
deployment has no channel they are printed as before, so local development
still finds the link in the terminal. A send the channel reports as failed
is printed too and never thrown: the account exists, and the member can ask
again.

**Rules kept.** A channel named without its URL or its sender refuses to
start. Nothing connects until the first send, so a wrong password is a
`failed` outcome in the log at the first message, not a boot that hangs.
`/health/delivery` names the provider as `smtp`; the inbox stops saying
`in_product_only`. The push channel stays absent until its own decision.

**Rejected.** *A vendor SDK*: it would name the service in the build. *A
`verify()` at boot that refuses to start*: a provider's outage would take
the API down for e-mail's sake. *Sending identity's mail some other way*:
two channels are two configurations and two things to get wrong.

---

## D-074 — Push is Web Push signed with the deployment's own VAPID keys: no account anywhere, a member's devices as rows, and "nowhere to receive" as its own outcome

**Date:** 2026-09-20 · **Task:** T-330 (T-324's push is the same) · **Status:** accepted

**Decision.** The push provider behind the delivery port is Web Push (RFC
8030), the standard every browser's push service speaks, through the
`web-push` library: `DELIVERY_PUSH_PROVIDER=webpush` with a VAPID key pair
the maintainer generates once on the server (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`) and `VAPID_SUBJECT`, a `mailto:` or `https://` the push
services may contact. No account is opened with anybody: the browser's own
service carries the message, and the key pair is the only credential. The
same shape as SMTP (D-073) and `openai_compatible` (D-072): a standard,
not a vendor.

**A device is a row.** `push_subscription` holds what the browser's push
manager hands out -- the endpoint and two keys -- one row per browser,
unique by endpoint, so registering again refreshes rather than doubles.
The member registers from the settings page ("On this device"): the browser
asks their permission, subscribes with the public key from `GET /me/push`,
and hands the result to `POST /me/push-subscriptions`; turning it off is
the same in reverse. A device whose service answers 404 or 410 is gone and
its row is removed by the channel.

**A fourth outcome.** A member with no device on a channel that exists is
`skipped` in `notification_delivery`: neither the channel's absence nor its
failure, and recording either would be a lie about what happened (rule 3).
The channel throws `NoRecipient`, the port records `skipped`.

**What the service worker does.** `sw.js` shows the payload -- the inbox's
sentence and the route it opens -- as the browser's notification, and a
click opens that route in the app (T-324: the same notification the inbox
has, not a second one).

**Rejected.** *A push service (FCM, OneSignal)*: an account and a vendor
for what the browser already carries. *Storing subscriptions per session*:
a device outlives a session. *Treating "no device" as failed*: the log would
fill with failures that were nobody's fault.

---

## D-075 — A campaign is the inbox's own kind sent to a saved audience: the vocabulary is what a member can see about themselves, the send is claimed once, and every row says who it reached

**Date:** 2026-09-20 · **Task:** T-332 · **Status:** accepted

**Decision.** Campaigns (blueprint 16, "notification campaigns") reach a
member only through the inbox's own `emit()`, as the `campaign` kind: a
kind of its own, on by default, in the `account` category, so a member can
turn campaigns off without turning off what happens to their account -- and
a member who did is `muted` in the report, not reached around the side.
From the inbox they leave the building like everything else (the carrier,
SMTP, Web Push), with the campaign's own title and body, opening the in-app
path the campaign chose.

**An audience is a saved query with a closed vocabulary.** A followed team
or competition, a country, a language, verified only, joined after a date,
all conditions together; an empty filter is every active member. Every
condition is one a member can see about themselves on their own settings
page, nothing is inferred and nothing is a score, and a word outside the
vocabulary is refused. Audiences and campaigns are immutable, so what a
past campaign reached stays true; a change is a new audience.

**A send is a row, claimed first.** `campaign_dispatch` is one row per
campaign by its primary key, written before the first member is told, so a
second send finds it taken (409); `campaign_send` is one row per member
with what the inbox did, and the notification's dedupe key (the campaign
id) is the second guard. `campaign_dispatch_result` is the tally when the
pass is over, and the audit log carries `audience.create`,
`campaign.create` and `campaign.send` with the administrator's reason.

**Who may.** Administrators only. A campaign is the platform speaking to
many members at once, which is the one voice the product has that is not a
member's, and it is not an editor's job.

**Rejected.** *Free SQL or a rule engine for audiences*: a query nobody can
read is a query nobody can be told about. *Sending around the inbox* (a
direct mail merge): it would ignore a member's preference, their quiet
hours and their mutes, which exist precisely for messages like these.
*Editing a sent campaign*: the report would describe a message nobody
received.

---

## D-076 — API-Football's Pro tier is the licensed source: the bake-off's most complete provider, bought on 2026-09-21, and the catalogue is what now stands between the key and the data

**Status:** decided · **Date:** 2026-09-21 · **Closes:** T-025, T-100

**The decision.** The maintainer bought API-Football (`api-sports.io`) on the
Pro tier, and the key is on their machine. `/status` answers `plan: Pro`,
`active: true`, `limit_day: 7500`, which is the tier D-049's evidence pointed
at: in the bake-off this provider answered 35 of 35 calls and filled 90% of
fixture fields, 99% of line-up fields and 95% of detail, against 70/25 and
40/57 for the two free alternatives. Its one fatal limitation was the seasons
a free key may see (2022-2024), and that is what a paid tier ends.

Daily need is 1,000-1,500 requests, so 7,500 is roughly five times the
product's appetite; `API_FOOTBALL_DAILY_BUDGET` can hold the ceiling in code
if a runaway job is ever a worry. Bought direct rather than through RapidAPI,
because the adapter sends `x-apisports-key`, which is the direct API's header.

D-049 is not superseded: the free split (football-data.org for the spine,
Highlightly for the detail) remains what `INGESTION_SOURCE=live` means, and
the replay source remains what CI uses. This adds the third profile, T-028's
`api_football`, as the one a deployment with a licence chooses.

**What the first paid run showed (2026-09-21, all five jobs, once each).**
The profile resolved every job to `api_football`; the provider answered; and
**nothing was written** -- for a reason worth having in writing:

- `standings` saw **20 teams**, a real Premier League table, and wrote none:
  *"18 teams in the provider's table have no mapping"*, and the two that are
  mapped have no table row here to update.
- `fixtures` saw nothing at all. The catalogue's current season is
  **2025/26**, which ended in May; the job asked the provider for that
  season's fixtures in a window around today and the answer was correctly
  empty.
- 20 teams and 25 people are now queued in `unresolved_entity`, each with the
  provider's own name, which is rule 1 working: an unknown external id is
  queued, never silently turned into a second row for a club we already hold.

So the licence is not the last blocker; **the catalogue is**. A deployment
needs the competitions, seasons and teams it covers to exist as internal rows
with mappings, and nothing builds them today: `packages/db/seed` writes seven
teams and two seasons for development, `src/modules/catalog/` only reads, and
no surface anywhere shows the unresolved queue or acts on it. That is the next
decision and it is recorded as its own gate rather than smuggled in here.

**Rejected.** *Treating the empty run as a failure of T-028*: the profile did
exactly what it should -- asked the right provider for the right competition
and refused to invent rows for clubs it cannot identify. *Mapping the 18 teams
by hand to get a green run*: it would prove nothing about a deployment that
covers five leagues, and the same wall stands the next morning.

---

## D-077 — The catalogue is adopted from the resolver's queue, one row per external id, and never matched by name

**Status:** decided · **Date:** 2026-09-21 · **Task:** T-029 · **Follows:** D-076

**The problem.** D-076 bought the licence and found the wall behind it: a
provider answers, and nothing is written, because the competitions, seasons and
teams it names do not exist here. `unresolved_entity` had been collecting them
since T-013 -- every external id we could not place, with the provider's own
name beside it -- and nothing read that table. Not the API, not the admin page,
not a script.

**The decision.** `packages/db/scripts/catalog.mjs`, in the `migrate` image the
server already builds, is the operator's side of the resolver: list what is
waiting, adopt the teams, add a competition or a season, or place one external
id by hand. It is SQL and the mapping table; it calls no provider, so it needs
no adapter and cannot drift from one.

**Adoption creates, it never matches.** A queued team becomes a *new* team row
and a mapping from that external id to it. It is never attached to a club whose
name looks the same, because a name is not a key (rule 1) and "Manchester
United" is a different row in two different leagues. When the provider is
talking about a club that is already here, a person says so -- `--map --to
<id>` -- and the queue records that it was placed by hand rather than adopted.

**What an adopted team holds.** Its name, `club`, `men`, `senior`, active. Not
a country, not a founding year, not a badge: the queue knows a name and an
external id, and inventing the rest would be a coverage lie of exactly the kind
rule 3 forbids. Those fields are filled in later, by a person or by a provider
that serves them.

**Audited when there is somebody to name.** `--by <address>` writes the
`audit_log` row; without it the write still happens and the output says why it
could not be audited -- `audit_log.actor_id` is NOT NULL and a fresh deployment
has no account. The same shape as T-076's role grants, for the same reason.

**Rejected.** *A `listTeams` call on the adapter*: it would add a method to a
contract three adapters implement and two contract suites check, to fetch names
the standings call already brought back and the queue already holds. *Matching
by name with a similarity threshold*: the first time it is wrong it merges two
clubs, and nothing downstream can tell. *Adopting people as well as teams*: a
person is a career, not a row -- 25 are queued and they wait for a decision of
their own.

## D-078 — The migrations write FIFA's member associations, because registration requires a country and production is never seeded

**Status:** decided · **Date:** 2026-09-25 · **Task:** T-040 · **Follows:** D-077

**The problem.** Registration requires a country (blueprint 7.1,
`user_account.country_id`) and offers the rows of `country`. No migration wrote
one and the seed is refused in production, so a freshly deployed platform
showed a required list with nothing in it, and nobody could register. The
first production deploy found it on 2026-09-25, at the first attempt to create
the first account. Every test environment is seeded, so nothing had ever seen
an empty list.

**The decision.** `1763300000000_member-countries.sql` writes FIFA's 211 member
associations, keyed by the FIFA trigram as every `country` row is: the
football country a member identifies with. England, Scotland, Wales and
Northern Ireland are four rows with no ISO code; Kosovo (`KVX`) has none
either, because XK is not in ISO 3166 and inventing one is what rule 3
forbids. The nine rows the development seed also writes keep the seed's ids;
any row that already exists by code or ISO code is left as it is. The down
migration removes the rest of these codes, keeping any row something points
at.

**The order is ICU's.** `GET /countries` sorts with `COLLATE "und-x-icu"`: the
Alpine image's default collation is byte order, which files "Côte d'Ivoire"
after "Czechia" and "Türkiye" after "Turks and Caicos Islands".

**An empty list says so.** The register page, given no country at all, says
registration is not open yet rather than rendering a form nobody can submit.

**Not the territory list.** Where a member watches from is `territory`
(T-312), ISO 3166, a different question; neither is read as the other.

**Rejected.** *Leaving it to `catalog.mjs --add-country`*: every deployment
would start unable to register, and a member from a country the operator did
not think of would have no honest answer. *The full ISO list*: `country.code`
is a FIFA trigram by constraint, and England is a football country ISO does
not have. *A member from outside FIFA's list* (Monaco, Greenland) has no row;
`--add-country` adds one when somebody asks.

## D-079 — People and grounds are adopted from the queue like clubs: one row per external id, never matched by name

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-029 · **Follows:** D-077

**The problem.** D-077 adopted clubs and left people for "a decision of their
own", with 25 queued. The first production deploy made it urgent: once the
post-match job asked about every finished match (T-102), the queue held 700
people and 66 grounds within an hour, and every one of them had been left out
of what it arrived in. The resolver never writes a blank for an id it cannot
place (T-026), so the line-ups were empty and a goal had no scorer -- on a
licensed feed that supplies both.

**The decision.** `catalog.mjs --adopt-people` and `--adopt-venues` do for a
person and a ground what `--adopt-teams` does for a club: a new row per queued
external id, its mapping, the queue entry resolved, an audit row per adoption
when `--by` names an administrator. A person gets the name the provider printed
-- often "J. Bellingham" -- in `full_name`, because it is the only name we have;
a ground gets its name and the city when the provider gave one. Nothing else is
invented: no birth date, no nationality, no capacity. Adopting people or grounds
then deletes this provider's `fixture_detail_fetch` rows, so the post-match job
asks those matches again, a batch at a time within its budget, and writes the
line-ups and incidents it had to leave out.

**Why not by name, even for people.** The objection in D-077 -- "a person is a
career, not a row" -- is an argument against matching, not against adopting.
The provider's id for a player stays the same from club to club, so one id is one
career; a name does not, and two "J. Rodriguez" are two people. When the
provider means someone we already hold under another id, `--map` says so and
the queue records that it was a judgement.

**Why an operator's command and not the resolver.** The resolver's rule --
queue what cannot be placed, never create -- is what keeps a typo or a
provider's test record out of the catalogue. Keeping adoption a deliberate,
audited act costs a command after each busy week; `14-maintainer.md` says when.

**Rejected.** *Creating people automatically at ingestion*: it would end the
queue's review for every kind of entity at once. *Waiting for a player
endpoint to supply full names first*: every match page would stay without
line-ups until then, when an abbreviated name is what the provider itself
prints.

## D-080 — The model's bridge to the catalogue is a committed list keyed by the provider's club id, and checked against results

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-063 · **Follows:** D-016, D-079

**The problem.** The forecast model and the Power Index are fitted on
football-data.co.uk's results (D-016), which name clubs as that source spells
them -- "Man United", "Nott'm Forest", "Ath Bilbao" -- and `training.team_alias`
is the bridge to our catalogue ids. The development seed writes two aliases by
hand. The first production deploy had no training data, no division on any
competition and no alias, so neither the model nor the Power Index could
answer for a single match, and no runbook step said otherwise.

**The decision.** `catalog.mjs --alias-training` writes the bridge from
`packages/db/scripts/data/training-aliases.csv`: provider, the provider's club
id, the football-data.co.uk division and the name as that source spells it.
Keyed by the provider's id because our ids are minted per deployment by
adoption (D-077, D-079) and the provider's are not. A name the training data
does not hold is refused, not written. `--set-division` records which division
a competition's results are in.

**Checked against results, never matched by likeness.** After writing, the
tool counts, per division, how many of the newest season's results agree with
ours: same day (±1), same two clubs, same full-time score. On 2026-09-26 the
list's 96 clubs are every club of the five leagues' 2026/27 seasons, and
all 250 results of those seasons so far agree (D1 36, E0 50, F1 45, I1 50,
SP1 69), checked on the production database before the list was committed. A name pairing that is wrong
cannot pass that check for long; one that is merely similar is never tried.

**Rejected.** *Matching names by similarity at training time*: the model's own
note on the alias table already refuses it, and "Paris SG" is not a
similarity away from "Paris Saint Germain" in any metric that also keeps
"Man City" from "Man United". *Keying the list by our ids*: every deployment
would need its own list.

## D-081 — Line-up quality and stability are read from our own match records, as positions among the season's teams

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-112 · **Follows:** D-049, D-080

**The problem.** Two of the blueprint's seven Power Index components -- line-up
quality (20%) and managerial and team stability (5%) -- were absent on the free
data, and the index said so at 70% completeness. The paid feed now supplies
line-ups, coaches and each player's match rating (T-101), and who will miss a
match (T-103).

**The decision.** Both are measured from our own tables, before the kick-off,
as positions among the teams of the same season (the rule T-111 set for every
component):

- *Line-up quality*: a player's rating is the mean of the provider's 0-10
  match ratings this season over matches they played 20 minutes or more of; the
  team's XI is the announced one, or else its last XI less the players reported
  out; its strength is the mean rating of its rated starters (seven at least);
  the component is its position among the other teams' latest XIs (five at
  least).
- *Stability*: the share of the season's matches led by the current coach, and
  the share of starters kept between consecutive matches over the last three
  pairs, each placed among the season's teams, averaged; either alone when the
  other cannot be read.

The formula version moves to `power-index@1.1.0`; stored 1.0.0 rows stay as
they were.

**What it does not claim.** The provider's rating is its own judgement of a
performance, and the index says whose it is. An expected XI does not know who
will replace an absent player, so it is `limited` and says it is expected.
Neither component can be backtested -- the training data holds results, not
line-ups or ratings -- so the blueprint's weights stand unvalidated, and
`12-power-index.md` says that in so many words.

**Rejected.** *A plain average over every appearance*: a substitute's ten
minutes would count as much as a starter's ninety, so a rating counts only from
matches of 20 minutes or more. *Replacing an absent starter with the
bench's best-rated player*: it guesses a manager's choice. *Points for a new
coach*: arbitrary, and the blueprint forbids fixed points.

## D-082 — A candidate model version runs in shadow, and is promoted only on its own pre-kick-off record

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-531 · **Follows:** D-029, D-031

**The problem.** Phase 6's second model (E53) adds what the first could not
see: constants tuned per division (T-532), clubs of different leagues on one
scale (T-533), line-ups and absences (T-534). Two of the three cannot be
backtested -- the history holds no line-ups and no European cup matches -- so
the evidence for them can only be matches recorded from now on.

**The decision.** A candidate version is computed beside the published one for
every forecast the published one makes, and stored exactly as a forecast is:
immutable, with its input snapshot and its model (rule 5), in `forecast` with
`role = 'shadow'`. Version numbers count within a role, so a published
forecast's numbering never shows a gap. Every read the product serves -- the
match centre, the lists, the rating's difficulty (D-035), the summaries, the
model performance pages -- reads `role = 'published'` only; the evaluation
records (T-066) are written for both, so the candidate is judged on forecasts
it made before kick-off (D-031). The model service offers the candidate at
`/forecast/candidate` and answers 404 when it has none, which is the usual
state; a shadow that fails is logged and the published version stands.

**What it is not.** Not a second prediction product (rule 6): it is the same
model's next version, never shown beside the first and never blended with it.
Promotion is a decision entry with the numbers (T-535), after at least 300
pre-kick-off forecasts, and the stored forecasts keep the version they were
made by.

**Rejected.** *A backtest alone*: it cannot see line-ups or cup matches.
*Publishing both with a label*: two numbers from one model is the blending
rule 6 forbids, seen from the other side. *A separate table*: two places for
one kind of row, and every evaluation query written twice.
