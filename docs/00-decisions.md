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

---

## D-083 — The feed's own records may train the model, and reach it through our tables, not a second connection

**Status:** decided by the maintainer · **Date:** 2026-09-26 · **Tasks:** T-511, T-512, T-533, T-534 · **Follows:** D-014, D-016, D-076

**The question.** The training store has held only sources whose terms were
read and recorded (D-016, rule 9): football-data.co.uk and Club Elo. Neither
covers Iran's league, European cup matches or line-ups, and the only source
that does is the feed the product already licenses (D-076). Whether its plan
allows training a model on its data was the maintainer's to answer.

**What the terms say.** API-SPORTS' terms of service (read on 2026-09-26 from
the copy archived on 2026-04-15; "last updated" 21 May 2025; the live page sits
behind a bot check) forbid one use: reselling the data, since a customer who
sells it directly competes with the provider. They describe the data as
provided for building projects such as applications and websites, and ask a
customer in doubt to write to them. They say nothing about models, statistics
derived from the data, or how long it may be kept. They also grant no licence
to publish competitions' data, which the rights holders may restrict -- a
point about publication that D-076 already carries and training does not add
to: a forecast is our own number, not the feed's data.

**The decision.** The maintainer's answer (2026-09-26): training the model on
the feed's data is allowed. The model's forecasts are the model's own output,
never a resale of the feed.

**How the data reaches the model.** Not through a second client of the
provider. The API's ingestion is the only path to the feed: every request is
counted against the day's ceiling (T-501), every club and player is a
catalogue id (rule 1), and nothing provider-shaped passes the adapter (rule 2).
The training store gains a third source, **our own records**: the model's
loader copies finished matches from `fixture`, `fixture_participant` and
`fixture_score` (read only; the API still never reads `training`) into
`training.match` under a division code per competition, with our team ids as
the team names, and writes the matching identity rows into
`training.team_alias` in the same load. A past season reaches `public` the way
the current one did: the catalogue adds the season (`--add-season`, not
current) and the backfill reads it (`--season <label>`), audited and counted.
The load records the feed's terms URL and this decision as its licence note,
so every row still answers "were we allowed to have it" from the store alone.
Because a season in progress changes every match day, the model service
refreshes a division of our own records once a day, before its first fit of
the day, through the same loader and the same load rows; a refresh that fails
is recorded as a failed load and the fit uses the copy already held.

**What it covers.** Iran's league history (T-512), European cup results for
putting clubs of different leagues on one scale (T-533), and line-ups and
absences as recorded after each match (T-534). Iran's league is one more
division for the same model, and enters the published version the way every
division did: once its backtest stands beside the others'. The other two
change what the model is, so they enter as the candidate version (D-082) and
are published only on their own pre-kick-off record.

**Limits, stated.** The feed's records carry no bookmaker odds, so a backtest
on them has no market to compare against and says so. The terms are silent on
keeping data after a plan ends; the plan on the server runs to 2026-10-21, and
whether held records keep training after a lapse is the maintainer's call at
that point, not a default this entry sets.

**Rejected.** *The model calling the provider itself*: a second key holder,
requests the day's ceiling cannot see, and provider names in the training
store with no catalogue identity. *No forecast for these matches*: honest, and
what the product said until today, but the maintainer has answered the
question it waited on.

---

## D-084 — No native app for now: the installable web app is the mobile product

**Status:** decided by the maintainer · **Date:** 2026-09-26 · **Task:** T-320 · **Follows:** D-042

**The question.** E32 planned a native app with Expo, reusing the API and the
contracts; T-321 proved the contracts platform-independent. Building it adds a
framework (`CLAUDE.md` §2), and publishing it needs store accounts that cost
money and are the maintainer's to open.

**The decision.** Not now. The web app installs on a phone already (D-042:
manifest, service worker, offline shell), and one interface is what a single
maintainer can keep true. No framework is added, no store account is opened.
T-322 to T-324 stay in the plan, not started; T-321's guard stays, so the
contracts remain ready for a second client if the question is asked again.

**Rejected.** *Building the app now and publishing later*: a second interface
to keep in step with every change, before anyone has asked for it.

---

## D-085 — Clubs of different leagues on one scale: one fit, a club's strength its league's plus its own

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-533 · **Follows:** D-029, D-082, D-083

**The problem.** The model fits each league on its own (D-029), so it can say
how Arsenal compares with Chelsea but not with Inter: nothing inside one
league's matches says how strong the league is. T-533 planned to take that
scale from Club Elo, whose API has answered 502 since 2026-09-25, and a
scraped page is not its API.

**The decision.** The scale comes from the matches that cross leagues. One
fit takes every loaded division's matches and the cup matches of our own
records (D-083, the pseudo-division `XL`: every competition that is not one
domestic league, as the API already decides it), with each club's attack and
defence written as its group's plus its own. A club's group is the division of
its latest domestic match; a club from a league the model does not hold is in
one shared group, `other`. Ridges pull a club toward its group and a group
toward zero, so a league's level is what its clubs did against other leagues,
and a club with three cup matches is judged mostly by its group's. The fit has
an exact, vectorised gradient; the published per-division fit is untouched.

**Where it runs.** Only in a version that names its constants
(`cross_league` in `candidate.json`); the published version answers such a
request "unavailable: rates clubs within one league". The constants are
chosen by the cup backtest (`python -m fmip_model.backtest.cross_league`) on
one season and scored once on the next, and the candidate stays in shadow
(D-082) until the season's cup forecasts show it calibrated.

**Limits, stated.** One home advantage for all leagues. No Elo while Club Elo
is down. The `other` group puts Andorra's champions and Denmark's beside each
other until their own matches separate them. Extra time and penalties are not
goals the model learns from.

**Rejected.** *Scraping Club Elo's website*: not its published API. *Fitting
the cups alone*: a few hundred matches cannot rate several hundred clubs.
*Averaging each side's domestic forecast*: two leagues' numbers are on two
scales, which is the problem, not its answer.

---

## D-086 — Line-ups and absences move the expected goals by one fitted number, in the candidate only

**Status:** decided · **Date:** 2026-09-26 · **Task:** T-534 · **Follows:** D-081, D-082, D-083

**The problem.** The model rates a club from its results, so a side without
three starters is the side it was last week. The API already measures each
XI before a kick-off -- the announced one, or else the last one less the
players reported out -- by its starters' season ratings (D-081), but the
history the model learns from holds no line-ups, so the size of the effect
cannot come from there.

**The decision.** The request carries both XIs' strength (`xi_strength`, the
raw mean ratings, only when both sides are measurable), and it is stored with
the forecast as part of its question. A version with a `lineup_beta` moves
the expected goals by the difference Δ between the two:
`lambda' = lambda * exp(beta * Δ)`, `mu' = mu * exp(-beta * Δ)`. `beta` is one
number, fitted by maximum likelihood on our own recorded matches (D-083),
with the candidate's own expected goals for each match -- from a fit on the
matches before it -- as offsets, and each match's XIs measured the way the
API measured them before its kick-off (`xi_before_kickoff`: a starter's mean
rating over the season's earlier matches of 20 minutes or more, seven rated
starters at least). The fit uses the matches before a split date and is
scored on the ones after, the same matches with and without the term
(`python -m fmip_model.backtest.lineups`); a candidate carries the term only
if the gain is real, and stays in shadow (D-082).

**Limits, stated.** The ratings are the provider's judgement (D-081). Early in
a season a player's mean rests on a few matches. A starter with no rating
this season is left out of the mean rather than guessed. Cup matches carry no
XI strength yet: a cup season's ratings are too few to rank a squad by.

**Rejected.** *A weight per position or per player*: thousands of parameters
for a few thousand matches. *The line-up component's position among the
season's teams*: a position has no scale between leagues or seasons; the raw
rating does. *Fitting on the published version's expected goals*: the term
would then correct a model it will never be added to.

## D-087 — Search widens to stories, groups and members on the same trigrams; only what may be found is a result

**Status:** decided · **Date:** 2026-09-27 · **Task:** T-642 · **Follows:** D-039, D-061

**The problem.** Blueprint 2.2 puts articles and users in the global search.
D-039 kept search to the catalog and left articles, groups and members to "a
`tsvector` or the external index revisited". T-642 needs them, and its
acceptance is that a private profile is never a result.

**The decision.** `GET /search` gains three kinds -- `story`, `group`,
`member` -- matched exactly as the catalog is: `search_key()` on both sides,
trigram word similarity or prefix, the same threshold. No `tsvector` (a
headline is one line, not prose, and stemming needs one language where the
product has eight) and no index service. Each kind is its own list in the
response, `null` when it was not asked for; the catalog's `results` and
`SEARCH_ENTITY_TYPES` are unchanged, so `/ask` reads and answers exactly as
before. Who can be found is decided in the SQL, never filtered afterwards:

- a **story** is its promoted original from a source not dropped, headline
  and link only (D-061), the newest version in each language;
- a **group** is `public` or `discoverable`; `invite_only` never, for anyone;
- a **member** has an `active` account and a **public** profile (no
  `privacy_setting` row is public). `friends` is not found even by a friend:
  otherwise a stranger could tell a friends-only member from nobody. A
  signed-in viewer never finds anyone on either side of a block
  (`users_blocked()`); a private member does not find themselves.

**Limits, stated.** No index serves the new kinds (the catalog's GIN indexes
are not used by `word_similarity()` calls either); at today's volumes a scan
is fine. If headline search grows slow, the remedy is a GIN index on
`search_key(headline)` and the `<%` operator, in a new migration.

**Rejected.** *A "discoverable" profile switch*: a new privacy setting is
product behaviour to decide first; public-only needs none. *One mixed,
ranked list*: a story's headline and a club's name score on different
scales, and a section per kind is what the page shows.

## D-088 — A guest's first-run choices live in a cookie and reach the account at sign-up

**Status:** decided · **Date:** 2026-09-27 · **Task:** T-620

**The problem.** Blueprint 2.3 encourages a guest to choose a language,
territory and favourite teams; T-620's acceptance is that the choice survives
until sign-up. Storing anything about a visitor on the server would be a
record of someone who never agreed to one.

**The decision.** A guest's answers are kept in one first-party, HttpOnly
cookie (`fmip_first_run`, a year), read field by field and never trusted
whole. At **sign-up** every answer is applied to the new account through the
endpoints Settings already uses (`PATCH /me/preferences`, `PUT /me/territory`,
`PUT /me/following/team/:id` as a favourite, `PUT /me/first-run`). At
**sign-in** they are applied only to an account whose own first run is still
pending: a member who already chose is never overwritten by what a browser
remembers, and favourites are only ever added. The cookie is then cleared.
Whether the flow is done is `user_account.first_run_done_at`, set once; the
column is nullable with no backfill, so an account older than it is offered
the flow once too, and one click dismisses it.

**Rejected.** *A server-side guest record keyed by a random id*: the same
information, plus a table of anonymous visitors to retain and delete.
*Applying at every sign-in*: a shared or old browser would silently change a
member's settings.

## D-089 — The identity: FMIP, calm and data-first, one green, the device's theme, Vazirmatn, a monogram mark

**Status:** decided, delegated · **Date:** 2026-09-27 · **Tasks:** T-600, T-601, T-604 · **Follows:** D-042

**Who decided.** The maintainer delegated these choices to the agent on
2026-09-27 ("decide yourself"). Each is revisable: none is load-bearing for
data, and a change is a new entry here, a token or an SVG, not a migration.

**The decision.**

- **Name shown:** "FMIP", unchanged: the header, the manifest, the title and
  the share cards.
- **Tone:** data-first and calm. Dense and legible, few decorative elements,
  in the spirit of FotMob and Sofascore; the numbers carry the page. No hype
  language: no "insane", no exclamation marks, no "guaranteed", nothing that
  sells a forecast as more than a forecast (rule 6).
- **Primary colour:** the existing theme green, named and measured (WCAG 2
  relative luminance; AA is 4.5:1 for text, 3:1 for large text and graphics):

  | Name (a token in T-602) | Role | Pair measured | Contrast |
  |---|---|---|---|
  | `green-700` `#0b6b3a` | primary, light theme | on white `#ffffff` | **6.61:1** |
  | `green-700` `#0b6b3a` | primary, light theme | on a light surface `#f9fafb` | 6.32:1 |
  | `green-700` `#0b6b3a` | fill under white (buttons, the mark) | white on it | 6.61:1 |
  | `green-900` `#063c21` | strong / pressed, light theme | on white | **12.53:1** |
  | `green-300` `#4cc88a` | primary, dark theme | on Chrome's dark canvas `#121212` | **8.86:1** |
  | `green-300` `#4cc88a` | primary, dark theme | on Firefox's dark canvas `#1c1b22` | 8.08:1 |
  | `green-300` `#4cc88a` | fill under dark text, dark theme | `#121212` on it | 8.86:1 |

  `#0b6b3a` on `#121212` is 2.84:1, which is why dark has its own variant:
  the light green is never used as text on a dark page.
- **Default theme:** follow the device (`prefers-color-scheme`). A member may
  choose light, dark or system; the switch is T-602 and not built here.
- **Font:** Vazirmatn (SIL Open Font License 1.1), one variable family (weights
  100-900) covering Latin and Arabic script, for every locale. Self-hosted:
  the dependency is **`@fontsource-variable/vazirmatn`** in `apps/web`, whose
  `@font-face` rules point at woff2 files inside the package; Next copies them
  into `/_next/static/media` at build time, one file per script subset by
  `unicode-range`, `font-display: swap`. No request leaves the site for a
  font, at build time or in a reader's browser (`src/app/fonts.spec.ts`).
  System fallback: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans',
  'Noto Sans Arabic', Tahoma, Arial, sans-serif`, then the emoji fonts.
- **Type scale:** seven sizes and no others, in `globals.css` `@theme`:
  12, 14, 16, 18, 20, 24 and 30 px (`xs` to `3xl`), with Tailwind's line
  heights. The larger sizes are removed so that a new size is a decision.
- **Mark:** a geometric monogram, `apps/web/public/icons/mark.svg`: a rounded
  square in `#0b6b3a` with a white "F" built from three bars and a white ball
  in the corner the F leaves open. Drawn to stay legible at 16 px (the stem is
  2.5 px there). `scripts/make-icons.mjs` rasterises the icons from it; the
  header and the share cards draw it inline (`components/brand-mark.tsx`). It
  is replaced when the maintainer supplies a logo, by editing the SVG and
  rerunning the script.
- **Persian (`fa`) locale:** not now. It is outside the blueprint's eight
  languages, and its strings would need a fluent human reviewer before they
  are shown as translated (the missing-string policy, T-151). Vazirmatn
  already covers Persian, so adding it later costs no font work.

**Rejected.** *`next/font/google`*: the build (and in development the page)
fetches from Google, which the production build has no reason to reach and a
reader's privacy has no reason to pay for. *`next/font/local` with woff2
files committed*: equivalent at run time, but a binary to vendor and update by
hand where a versioned package already carries the same files and licence.
*A new brand colour*: `#0b6b3a` is already the theme colour, the manifest and
the icons, and passes AA on white; changing it buys nothing measurable.

## D-090 — Colour tokens on `:root`, a theme chosen by cookie and kept on the account

**Status:** decided, delegated · **Date:** 2026-09-28 · **Tasks:** T-602 · **Follows:** D-089, D-041

**The decision.**

- **Tokens.** Fifteen semantic colours as CSS custom properties,
  `apps/web/src/app/tokens.css`: canvas, surface, surface-raised, text,
  text-muted, border, border-strong, accent, accent-strong, on-accent, focus,
  danger, warning, success, live. Light on `:root`; dark under
  `prefers-color-scheme: dark` unless `data-theme="light"`, and again under
  `data-theme="dark"`. `globals.css` maps them to Tailwind with `@theme inline`
  (`bg-surface`, `text-muted`, `border-default`, ...), so a class reads the
  token and follows the theme. The values keep D-089's greens; every text role
  is AA (4.5:1) on the page and both surfaces in both themes, a field's edge
  and the focus ring 3:1 or better, and `tokens.spec.ts` recomputes each pair.
- **The focus ring** is the focus token (near-black on light, near-white on
  dark), no longer `currentColor`, which vanished around a button with light
  text on the page's own light background.
- **Where the choice lives.** The cookie `fmip_theme` (`light` | `dark` |
  `system`, a year) is what a page renders with, for a guest and a member
  alike: the locale layout reads it and writes `data-theme` on `<html>`, so
  the first paint is the chosen theme with no script and no flash. The layout
  was already dynamic (the header reads the session), so this costs no static
  rendering. A member's choice is also `user_account.theme` (additive column,
  constant default `system`, no backfill), written through
  `PATCH /me/preferences`; at sign-in the account's own choice reaches the
  browser, and an account that never chose takes the browser's.
- **Image renderers** (share cards, the manifest) cannot read a CSS variable;
  where they need a colour it comes from one exported constants object that
  mirrors the light tokens, held to them by a spec. That object and
  `tokens.css` are the only places a colour value is written.

**Rejected.** *An inline script that sets the attribute before paint*: it
works on a static page, but the layout is already server-rendered per request
and a script is one more thing a strict CSP must allow. *CSS `light-dark()`*:
one declaration per token instead of three blocks, but Safari before 17.5
ignores it, which would leave those readers with no colours at all. *The
account as the only store*: a guest could not choose, and a member's first
page after sign-in would render before the choice was known.

---

## D-091 — Achievements are derived and change nothing; a group poll is a member's question with counts, not a second voice

**Status:** decided, delegated · **Date:** 2026-09-28 · **Tasks:** T-643 · **Follows:** D-059, D-060

**Who decided.** The maintainer delegated these product rules to the agent
(T-643: "their list and the poll rules are product behaviour to confirm
first"). Each is revisable: an achievement is a rule in a pure function and a
poll limit is a constant or a row, so a change is a new entry here, not a
backfill.

### Achievements

- **Derived, never stored.** An achievement is computed on read from the
  member's stored predictions and current settlements
  (`deriveAchievements`, `apps/api/src/modules/reputation/internal/achievements.ts`),
  exactly as T-640's rating history is. There is no table and no mutable
  state, so there is nothing to backfill or keep in step: the same rows give
  the same list, and a settlement later voided takes its milestone with it
  (rule 8's discipline, applied to milestones). Rules are versioned
  (`achievements@1.0.0`) and the version is in every answer.
- **They change nothing.** Like Career Points (blueprint 9.2: points "cannot by
  themselves unlock expert status"), an achievement is never read by the
  Performance Rating, any board, contributor eligibility or any privilege. The
  profile says so beside the list.
- **The initial list, conservative on purpose:**

  | Kind | Earned when | `earned_at` |
  |---|---|---|
  | `first_settled`, `settled_10`, `settled_50`, `settled_100` | the 1st / 10th / 50th / 100th settled prediction | that settlement |
  | `first_exact_score`, `exact_scores_5` | the 1st / 5th settled prediction with the exact score right | that settlement |
  | `streak_5`, `streak_10` | the first run of 5 / 10 correct outcomes in a row, counted as the `streak_5` / `streak_10` Career Points reasons count it (settlement order; voids neither break nor extend) | the settlement completing the run |
  | `full_matchday` | a round (one season, one `round` value) none of whose fixtures is still scheduled, live or suspended, with **at least two** finished fixtures, every one of which the member predicted and had settled. Fixtures that settle void (postponed, abandoned, cancelled, awarded) are neither required nor counted. Predictions are refused after kick-off by the database, so "all before kick-off" holds by construction | the last of those settlements, for the first round to complete |
  | `competitions_5` | a prediction in a fifth different competition, settled or not | the first submission of the first prediction in the fifth |

  Each is earned once, the first time. No notification is sent (not in T-643).
- **Visibility.** `GET /users/:username/achievements` follows
  `prediction_history_visibility` through `ProfileService.predictionHistoryAccess`,
  like the rating history, because an achievement says when and where a member
  predicted. `GET /me/achievements` is always the member's own.

### Group polls

- **Where.** A poll belongs to one group. There are no polls in direct
  messages. Any current member of the group may create one.
- **Shape.** A question of 1-200 characters, 2-6 distinct options of 1-80
  characters each, single choice. It closes at a time chosen at creation:
  7 days by default, at least 1 hour and at most 30 days ahead.
- **Votes.** One per member per poll, changeable (and withdrawable) until the
  poll closes; only current members vote. A vote already cast stays counted if
  the voter leaves the group, because the result is a record of what was asked
  and answered.
- **Results.** Visible to group members only, as a count per option and a
  total, and only to a member who has voted or once the poll is closed; before
  that a member sees the question and the options. **Who voted is never
  shown**, to anybody, including the creator and the group's staff. There is no
  anonymous toggle in this version, because there is nothing to toggle: votes
  are only ever counts.
- **Closing early.** The creator or the group's owner may close a poll before
  its time. Closing is final.
- **Removal.** The group's owner or a moderator may remove a poll with a
  reason. The removal writes an `audit_log` row (actor, time, reason, and the
  poll as it was: question, options, counts, status) in the same transaction
  (rule 10), and a removed poll is no longer shown. The group has no separate
  "administrator" role (T-240: owner, moderator, member); "admin" here is the
  owner.
- **Reports.** Group content is not a report subject: `REPORT_SUBJECTS` is
  still `['member']`, and it grows only with a surface that enforces the new
  value (see `packages/contracts/src/moderation.ts`). A poll is handled like
  every other thing a member writes in a group: the group's staff remove it,
  and a member reports the **member** who wrote it through the existing path.
- **Limits.** At most **3 open polls per group** at once (a fourth is refused
  until one closes or is removed), and creating polls is under the same hourly
  ceiling mechanism as every other write (`rate_limit` row `group_poll_create`,
  10 an hour). A member under a `groups` sanction cannot create a poll
  (the sanction stops making things in groups, T-240); voting is not refused.
- **Separate from the three prediction products (rule 6).** A poll is a
  member's question to their group. It is never labelled or shown as a
  prediction, a consensus or a forecast, and it is never read by the
  community consensus.

**Rejected.** *An `achievement` table written by a job*: a second place for a
fact already derivable from settlements, and one more thing to backfill when a
rule changes. *Achievements that unlock anything*: activity is not skill
(blueprint 9). *Showing who voted*: in a small group a count per name is a
roll call, and a poll that exposes a vote gets fewer honest answers. *Polls in
direct messages*: two people do not need a poll. *A new report subject for
polls*: nothing else a member writes in a group is one, and a subject nobody
enforces is a promise to the moderation team that is not kept.

---

## D-092 — Text size, contrast and motion kept like the theme; more contrast is AAA; a guest has Settings too

**Status:** decided, delegated · **Date:** 2026-09-28 · **Tasks:** T-621 · **Follows:** D-090, D-041

**The decision.**

- **Three preferences, each stored the way D-090 stores the theme.** A cookie
  per preference (`fmip_text_size`, `fmip_contrast`, `fmip_motion`, a year)
  that the locale layout renders on `<html>` (`data-text-size`,
  `data-contrast`, `data-motion`), so the first paint is right with no
  script; for a member, the same values on `user_account` through
  `PATCH /me/preferences` (additive columns with constant defaults, no
  backfill), reconciled at sign-in by the theme's rule.
- **Text size** is `default` | `large` | `larger`: the root font size at
  100% / 112.5% / 125% of the browser's own, never a pixel value, so a reader
  who already raised the browser's size keeps that and gains on top of it.
  Every size and spacing is in rem, so the page scales as one; at 360px the
  page does not scroll sideways (a wide table may, inside its container).
- **Contrast** is `system` | `standard` | `more`. `more` is a second set of
  token values per theme in which every text role is WCAG AAA (7:1) on the
  page and both surfaces, muted text is close to body text, the hairline is a
  visible edge (3:1), and the dark backgrounds go to black. `system`, the
  default, follows the device's `prefers-contrast: more`; `standard` is a
  choice to keep the standard values whatever the device says.
- **Motion** is `system` | `reduce`. Blueprint 2.2 names reduced motion as a
  preference, so it is a control, not only the OS setting: `reduce` stops
  animations and transitions whatever the device says. There is no "always
  animate": overriding a device that asked for less motion is not a choice
  this product offers.
- **A guest has Settings.** Blueprint 2.2 lists these among the global
  controls, so a guest can reach them: `/settings` without a session shows
  Appearance alone (theme, text size, contrast, motion) with a sign-in link,
  instead of redirecting to login, and the header shows guests a Settings
  link. The theme also stays in the header; the three new ones are not
  added there, because a header row of four switches does not fit a phone.

**Rejected.** *A `more` that only changes muted text*: the green, the
warnings and the live marker were below 7:1 too. *Honouring
`prefers-contrast` with no way to decline it*: a reader whose device asks
for more everywhere may want this site's standard look, as a theme choice
wins over the device. *A redirect for guests with the controls in the
header*: four switches crowd the one row the header has at 360px.

---

## D-093 — Sign-in rate limits: per address and per identifier typed, on `rate_limit`, the address from CF-Connecting-IP

**Status:** decided, delegated · **Date:** 2026-09-28 · **Tasks:** T-810 · **Follows:** D-026, D-054, T-213

**The decision.**

- **The ceilings** (rows in `rate_limit`, per hour, changeable with an UPDATE):
  failed sign-ins 10 per identifier typed and 50 per network address;
  registrations 5 per e-mail address and 20 per network address; reset
  e-mails 3 per e-mail address and 20 per network address; the two e-mailed
  links (verify, reset) 60 per network address. A successful sign-in is not
  counted (it is counted first and given back, so parallel guesses cannot all
  be checked before any is counted). A password reset forgets the failed
  sign-ins against the account's username and e-mail.
- **The counter** is `auth_rate_window`: the fixed hourly window of T-213,
  keyed by an HMAC (SESSION_SECRET, D-026) of the address or of the
  identifier, so the table holds neither in clear. The check is a query the
  identity service makes before the password is verified, not a trigger,
  because a failed sign-in inserts nothing.
- **Per identifier typed, not per account found.** A username and an e-mail
  that name the same account are two counters. Resolving to the account would
  let the lock on one reveal that the other is the same person; counting the
  string typed makes a refusal identical for an account that exists and one
  that does not, at the cost of twice the guesses per account.
- **The refusal** is 429 `rate_limited`, `Retry-After` in seconds (the end of
  the hour) and "Too many attempts. Try again in N minutes." -- no account is
  named, and the web forms show the sentence as they show any API error.
- **The address** is Cloudflare's `CF-Connecting-IP`, read by the web app and
  forwarded to the API as `X-Fmip-Client-IP` on the account forms only; the
  API accepts it only when it is a well-formed IP, and Caddy drops a reader's
  copy on the one route that reaches the API without the web app (the chat
  socket). `X-Forwarded-For` is not used: past Caddy its entry is a
  Cloudflare edge, and a limit keyed on that would lock everyone out
  together. Without the header (local development, tests, a deployment
  without Cloudflare) the per-address ceilings do not apply and the
  per-identifier ones still do.

**Why these numbers.** Addresses are shared -- a household, an office, a
mobile carrier's NAT, which is common where this product's readers are -- so
the per-address ceilings count only failures on sign-in and sit far above
what one person does; the tight ceilings are per identifier, where ten wrong
passwords an hour is generous to a person and useless to a guesser. Three
reset e-mails an hour keeps a mailbox from being flooded. The e-mailed links
carry 256 random bits, so their ceiling is only against a flood.

**Rejected.** *Redis counters* (D-026's original plan): Redis is optional at
run time here, and a safety rule that stops when an optional dependency is
missing is not one (the argument of T-213). *A lock keyed per account found*:
see above. *`X-Forwarded-For`*: see above. *Per (identifier, address)*: a
guesser spread over many addresses would never be refused.

**Consequences.** Anyone can lock an identifier out of signing in for up to an
hour by typing ten wrong passwords for it; the account's owner can still ask
for a reset e-mail, and the reset lifts the lock. A request that reaches the
origin without Cloudflare can choose its own `CF-Connecting-IP`, and so its own
per-address counter; the per-identifier ceilings hold regardless. Restricting
the origin to Cloudflare's addresses would close that and is an operations
step, not code.

---

## D-094 — Deleting an account leaves an anonymous tombstone: records stay, the person goes, the username is retired

**Status:** decided, delegated (N-3 in `04-tasks-phase-8.md`) · **Date:** 2026-09-28 · **Tasks:** T-812 · **Follows:** D-057, D-053, D-025

`13-policy.md` §4 promised that a member can delete their account and that
their predictions stay "as records without your name". N-3 asked what else
deletion removes. The plan's proposal is adopted and made exact.

**The decision.**

- **The `user_account` row stays, as a tombstone.** Predictions, settlements,
  rating snapshots, points, reports, moderation decisions, grants and the
  audit trail hold the account with ON DELETE RESTRICT, and rule 8 needs the
  settlements. So deletion *anonymises* rather than deletes: `status =
  'deleted'`, username `deleted_` + 12 hex digits, display name `Deleted
  member`, e-mail `deleted-<id>@deleted.invalid` (unverified), every
  preference back to its default. Every public read already filters
  `status = 'active'` (profile, boards, period boards, predictions on a
  match, search, following feed), so a deleted member disappears from them
  with no further change. Country and the registration dates stay: they are
  NOT NULL, coarse, and T-807's counts need the dates.
- **Removed:** credentials, sessions, e-mail tokens, roles, the profile
  (biography, avatar), followed entities, notification preferences, mutes and
  quiet hours, push subscriptions, rate windows, member briefings, member
  follows and friendships and friend requests and blocks **in both
  directions**, group memberships, group invitations (sent and received) and
  join requests, and unsubmitted community-analysis drafts. Privacy is set to
  private as a second fence. (T-842 added saved articles to this list: a
  member's own reading list is personal data like a follow.)
- **Kept, without a name:** predictions, prediction versions, settlements,
  rating snapshots and points (rule 8 -- other members' ratings never read
  them, and the member's own rating remains recomputable from them, it is
  simply shown nowhere); messages in direct and group conversations and
  public match-panel posts, shown as **"a deleted member"** (the member leaves
  every conversation; reactions and poll votes stay as counts); notifications
  already sent to the member (the delivery record T-807 counts; unreachable
  without a session).
- **Taken down:** published community analysis. Its versions are immutable,
  so the public read (`/fixtures/:id/community-analyses`) and the review queue
  drop an author whose status is `deleted`. A live contributor grant is
  withdrawn with an event, so no post calls the tombstone approved.
- **Kept for the audit:** reports the member filed (their words included --
  a decision was, or will be, made on them), sanctions and appeals.
- **The username is retired permanently, not reserved for a period.** It is
  copied into `retired_username` -- the string and a date, deliberately
  without the account id, so it cannot be joined back to the tombstone -- and
  a trigger refuses it (and any `deleted_…` name) to every account that is
  not deleted, as a unique violation, so registration answers "already
  taken". A 90-day reservation was the alternative; a username is how other
  members recognise someone in old messages, mentions and screenshots, and
  impersonation (§4) does not expire.
- **Groups (D-057, exactly one owner).** A group the member owns passes to its
  longest-standing moderator, else its longest-standing member. A group with
  nobody else in it is deleted; if a conversation in it holds messages --
  which are removed by tombstone, never deleted -- it is **closed** instead:
  made invite-only, with the tombstone as its nominal owner, so nobody can
  find it or get in and what former members wrote is kept.
- **One transaction, one audit row.** `POST /auth/account/delete` takes the
  password and the username typed again, and runs every step above in one
  transaction with an `audit_log` row: actor the member, action
  `account.delete`, reason `self-service deletion`, previous `{status:
  'active'}`, next `{status: 'deleted'}` plus counts (groups handed over,
  deleted, closed; analyses taken down; grants withdrawn). The audit row keeps
  no copy of the username or address -- that would keep what was deleted.
- **Final.** A trigger refuses setting a deleted account back to any other
  status; the admin status control treats a deleted account as unknown.
- **Admin deletion (for abuse)** is the same store call with the
  administrator as actor and their reason. It is not exposed as an endpoint
  in T-812: the console's suspension already stops an abusive account, and
  deleting someone else's account is a heavier act that should arrive with
  its own task and UI.

**The policy text.** `13-policy.md` §4 now lists exactly the above. It
describes what leaving does; it does not change what is allowed, so under
§4's own "Changes" rule it needs no new acceptance and the version stays
`platform-rules@1.0.0`.

**Rejected.** *Deleting the row and cascading*: RESTRICT foreign keys and
immutable tables refuse it, and removing predictions would change consensus
counts and the record other members' results sit beside. *Keeping the
username on the tombstone*: every message would still carry the name.
*Deleting messages and panel posts*: the conversations around them would read
as non sequiturs, and the message schema already chose tombstones over holes. *Refusing
deletion while the member owns a group* (D-057's original wording): it makes
leaving depend on an admin chore the member may be unable to do.

---

## D-095 — The watchdog: one tick a minute, stated thresholds, an alert is a transition
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-801's watchdog is a BullMQ job scheduler (`watchdog` queue,
every minute) in the process that has `INGESTION_SCHEDULE=on`, so no new
variable and no second poller. Each tick reads the health views and turns
them into conditions with a level `ok` | `degraded` | `failing` | `unknown`,
keeps the current state in `watchdog_condition` and writes a row to the
append-only `watchdog_event` only when a level changes. Leaving `ok` opens an
incident (`raised`), returning to `ok` closes it (`recovered`); moves inside
an incident are `escalated`/`eased`, and `unknown` neither opens nor closes
one. `raised` and `recovered` are the alerts T-802 delivers, read by id after
a cursor (`WatchdogService.alertsAfter`). The state is at
`GET /admin/health/watchdog`, admin role only, `stale` when the newest tick is
older than three minutes. The thresholds, each `degraded` / `failing`:

- `ingest:<job>`, since the newest completed (succeeded or partial) run:
  live 5 / 15 min, lineups 20 / 60 min, post_match 90 min / 4 h, fixtures and
  standings 3 / 12 h. A job with no source is `unknown`.
- `live_feed`, since the longest-unchanged match in progress last changed:
  20 / 40 min.
- `request_budget`, the day's requests against `API_FOOTBALL_DAILY_BUDGET`:
  80 / 95 %; `unknown` with no budget.
- `jobs:<queue>` (ingestion, news, channel-post, watchdog), failed jobs in the
  last hour: 1 / 3.
- `model_service`, consecutive failed health checks: 1 / 3; `unknown` with
  `MODEL_SERVICE_URL=off`.
- `delivery:<channel>`, the failed share of the last hour's deliveries once
  there are three: 25 / 75 %; `unknown` with no provider.
- `backup`, since the newest successful backup: 26 / 50 h -- `unknown` until
  T-805 records backups where the API can read them.

**Why.** The acceptance is one alert per incident, not per tick; a
transition log gives that by construction and is also the history T-804
shows. The live feed's threshold is not D-045's two minutes on purpose:
half-time is a match in progress whose data does not change for fifteen
minutes, so two minutes would wake an administrator at every interval,
while a feed that stops for everything is caught within five minutes by
`ingest:live`. `unknown` is its own level because "could not be read" is
neither fine nor an outage (rule 3), and an incident that goes unreadable
and comes back still bad must not alert twice.

**Alternatives considered.** A systemd timer running a script: the backup's
pattern, but the views are inside the API and a script would re-implement
them. Alerting on every tick while bad, rate-limited: more alerts for the
same news. A public endpoint like `/health/*`: it names what is broken and
since when, which is the operator's, not a visitor's.

**Consequences.** T-802 reads `alertsAfter` and keeps its own cursor; T-804
renders `WatchdogReport`; T-805 replaces the backup probe's `undefined` with
the newest recorded backup. Changing a threshold is a one-line change in
`apps/api/src/modules/watchdog/internal/conditions.ts` and an edit here.

## D-096 — System alerts go to every administrator once, through the inbox and the device, at any hour
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-802 delivers each watchdog `raised` and `recovered` event
(D-095) as a `system_alert` notification to every active account holding the
`admin` role, through the existing path: the inbox always, then Web Push and
e-mail through the delivery port where the deployment has them and the
administrator has a device or an address (T-330). The rules:

- **Once, by a cursor and a dedupe key.** `watchdog_alert_cursor` holds the
  newest event delivered; a run takes its own advisory lock, writes the
  notifications event by event with the dedupe key `watchdog_event:<id>`, and
  moves the cursor in the same transaction. A second process skips; a run
  that dies before committing is repeated and writes nothing twice; a write
  that fails stops the run there, so no later event jumps the cursor over it.
  Push and e-mail are claimed per notification before sending (T-330).
- **Quiet hours do not hold it.** `QUIET_HOURS_EXEMPT = ['system_alert']` is
  the one exception to "everything waits" (T-273). The alert is the pager
  for an outage; one that waits until morning is hours of a broken product
  nobody was told about. It is one message per incident and one per
  recovery, never a stream, so there is no cap either. An administrator who
  does not want it turns the kind off in Settings like any other.
- **Administrators only.** The kind is left out of a member's settings
  (`ADMIN_ONLY_NOTIFICATION_KINDS`) and only the watchdog emits it. It is in
  the `account` category.
- **No replay of the past.** The cursor starts at the newest event already
  logged when the migration runs; with no administrator at all the cursor
  still moves (and the log says so), so the first administrator appointed is
  not handed a week of old alerts.
- **Where it went is readable.** `GET /admin/health/alerts` gives the
  channels, the number of administrators, the cursor, pending events, and
  per alert the inbox count and each channel's sent, failed, skipped, absent
  and not-yet-carried counts, so the System page (T-804) says "inbox only"
  when that is all there is and never counts a send that did not happen.

**Alternatives considered.** Writing the notifications inside the cursor's
own transaction: the notifications module owns its SQL and its rules
(mutes, blocks, the dedupe index), and a second copy of the insert would
drift; the dedupe key gives the same outcome across two transactions.
Honouring quiet hours for alerts: the product rule was written for members'
notifications; an operator's pager with a night-time delay is not a pager.
A per-channel preference (push only, no inbox): the preference model is per
kind today and the inbox is the record the System page reads.

**Consequences.** The alert's line is read from the event (`System alert:
<condition> is <level> (<note>)`, `Recovered: <condition> is ok again`),
English like the condition names; it opens the System page
(`/[locale]/admin/system`, T-804).

## D-097 — Data-quality checks: a sweep every five minutes over stored rows, findings that resolve, a watchdog condition for live matches
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-820's checks read only what ingestion has stored -- no
provider request of their own -- and run as a BullMQ job scheduler
(`data-quality` queue, every five minutes) in the process with
`INGESTION_SCHEDULE=on`, like the watchdog. Each finding is a row in
`data_quality_finding` naming the check and its subject (a fixture, one side
of one, a pair, a team in a season's table), with `first_seen_at`,
`last_seen_at` and `resolved_at`; a partial unique index keeps one unresolved
row per (check, subject), so a sweep that sees the same problem moves
`last_seen_at` on and never writes a second row, and a sweep that no longer
sees it resolves it; an unchanged finding's row is rewritten at most hourly, and
`data_quality_check_run` says exactly when each check last ran. Nothing is
corrected automatically. The checks and
the numbers the plan left open:

- `finished_without_score`: `finished` with no `full_time` row.
- `goals_disagree`: the goal incidents per side against `current` (live), or
  `current`, then `extra_time`, then `full_time` (finished). Judged only when
  the fixture has at least one incident. An own goal is accepted under either
  side (feeds differ on which they file it under), and when a shoot-out is
  recorded, penalty goals at minute 120 may be shoot-out kicks.
- `live_overrun`: still `live` **180 minutes** after kick-off -- past ninety
  minutes, the interval, stoppage, extra time and a shoot-out, and half an
  hour before the live job stops asking about the match (210).
- `lineup_not_eleven`: a stored line-up side with other than eleven starters.
- "One provider id on two fixtures" is refused by `provider_mapping`'s unique
  key, so it is read as its two real forms: `fixture_mapped_twice` (one
  fixture carrying two ids from one provider) and `duplicate_fixture` (one
  season, the same home and the same away team, kick-offs within **three
  days**, neither cancelled).
- `table_disagrees`: the standings job's existing comparison with the
  provider's table (T-030), per team, kept as findings for that season; it
  rides on the request that job already makes.

T-821's watchdog condition `data_quality` counts the open findings nobody has
marked reviewed that are about a match that is live or kicked off in the last
**six hours**, and have been open for at least **ten minutes** (two sweeps):
`degraded` at **1**, `failing` at **3**. Older findings are the admin page's,
not an alert.

**Why.** Five minutes because a sweep reads every stored fixture, and doing
that every minute would be most of the database's work for nothing new, while
a live contradiction still reaches the watchdog within a quarter of an hour.
Findings resolve instead of being deleted so the page can say how long a
problem lasted. The ten-minute age is the difference between a score that
arrived one tick before its goal event and a timeline that is wrong; the
six-hour horizon is what "a live match's data contradicts itself" means for
an administrator woken by it, and a finished season's leftovers are not news.

**Alternatives considered.** Running the checks at the end of every ingest
run: the live job runs every minute and would sweep every minute. Correcting
obvious cases (closing a stuck live match): the plan forbids it, and a wrong
correction is worse than a visible question. Deleting resolved findings: the
history of what went wrong is the point of the page.

**Consequences.** A threshold is a one-line change in
`apps/api/src/modules/data-quality/internal/checks.ts` (checks) or
`apps/api/src/modules/watchdog/internal/conditions.ts` (the watchdog), and an
edit here.

## D-098 — Match alerts: raised from the live job's own writes, one per member per event, one push per run
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-830's match alerts are five notification kinds -- `match_kickoff`,
`match_goal`, `match_red_card`, `match_half_time`, `match_full_time` -- in a
mute category of their own, `match`, for members who follow either team or
the competition. They are raised inside the ingestion jobs, not by a poller:
the live job (every minute) and the post-match run read each match before
and after they write it, and `MatchAlertsService` turns the difference into
events. Kick-off is scheduled → live; a goal is a side's count going up, one
event per step (`goal:home:2`), so two goals in one tick invent no order; a
count going down is a withdrawn goal; a sending-off is a `red_card` or
`second_yellow_card` incident, once per player; half-time only when the feed
says the match is at the interval (API-Football's `HT`); full-time is live →
finished. Each event is a row in `match_alert` with a key that is also the
notification's dedupe key, so a retry, a replay or a second process reaches
nobody twice. A withdrawn goal is a correction (`match_goal`, "Goal
disallowed ...") sent only to the members who hold the goal it withdraws; a
goal given again afterwards is a new occurrence (`#2`). The scorer is named
only when the side's recorded goals equal its score and the match has no own
goal. The live job writes the incidents the live list carries, and asks by
id, at most every five minutes per match, about a match it holds as live
that left the live list, so the result and its alert are not half an hour
late. Emission goes through `NotificationsService.emit` (switches, mutes,
quiet hours delay and never drop); a run's alerts are carried when the run
ends, and one member's alerts of one run leave as one push. A match alert is
a push and an inbox row, never an e-mail.

**Defaults.** Kick-off, goals (with their corrections) and full-time on;
red cards and half-time off. A follower wants the start, every goal and the
result without asking; half-time and red cards roughly double the pushes of
an ordinary match for news the next goal or the result carries anyway, so
they are for a member who asks. This departs from the E83 row, which asked
for goals off too: the maintainer's brief for T-830/T-831 names goals among
the defaults, and a goal is the one thing a follower of a live match is
certain to want.

**Why.** The live job already knows the moment a score or a status changes,
and a second reader polling the same tables would be late by its own
interval and would have to guess what changed. A key per event rather than
per score keeps "one per member per event" a unique index instead of a
memory. One push per run is the frequency limit that fits a match: a goal
and a red card in the same minute are one interruption. Quiet hours delay a
match alert like any other notification (the product's rule, T-273), and the
held alerts leave together when the window ends.

**Alternatives considered.** A database trigger writing an outbox on every
score or status change: every writer covered, but the derivation would live
in SQL and the scorer and the lines with it. Per-team, per-kind overrides
(goals for one team, not another): the preference table is per member per
kind, and a second table read on every emit is a schema change the brief
allowed deferring; a team or competition mute already silences one team or
one competition. A match alert by e-mail: a minute-by-minute stream is not
what e-mail is for.

**Consequences.** `wants()` now reads a member's own "on" for a kind that is
off by default (it used to read only an "off"). T-831 gives the kinds their
own section in Settings → Notifications. T-832 (line-ups) can add a kind to
the same derivation; T-834 measures the queue at a Saturday's load.

## D-099 — The API takes JSON bodies only: a url-encoded body is refused before any handler
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** The API's HTTP application is created with Nest's
`bodyParser: false` (`apps/api/src/http-options.ts`, used by `main.ts`). That
removes the one body parser Nest adds to Fastify's own --
`application/x-www-form-urlencoded` -- so such a body is answered 415 before
any controller runs. JSON is parsed by Fastify's own parser, with the same
prototype- and constructor-poisoning refusal as before.

**Why.** T-813's security tests found that a url-encoded body reached the
controllers: `POST /admin/ingestion/backfill` with `reason=...` as a form
body ran a backfill. A url-encoded body is what a plain HTML form sends, and
a form needs no CORS preflight, so it is the shape of a cross-site request
forgery. D-026's `SameSite=Lax` cookie already keeps a cross-*site* form from
carrying a session, but "site" is the registrable domain: any page on a
subdomain of it would be same-site. The API speaks JSON only -- the web app
sends nothing else (`apps/web/src/lib/api.ts`), and no browser calls the API
directly (D-027) -- so refusing the body costs nothing and closes the class
rather than one route.

**Alternatives.** An `Origin`/`Referer` check or a CSRF token on every write --
more code on every path for the same result, and the API is not meant to be
called from a browser at all (D-027). Leaving it -- the cookie makes it
unexploitable cross-site today; rejected because the fix is one option.

**Consequences.** A client that posts a form directly to the API gets 415;
there is none. `text/plain` stays parsed by Fastify as a string, which no
controller accepts as a body (each reads fields from an object), and the
security spec checks every console write with a form body.

## D-100 — Team news, line-ups and a friend's prediction: opt-in, once each, and never the pick
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-832 adds three notification kinds.

- `match_availability` and `match_lineups` are match alerts (the `match`
  category, D-098's batch and carrier, a push and an inbox row, never an
  e-mail), raised inside the line-ups job, which reads each match before and
  after it writes the line-up or the availability answer
  (`MatchAlertsService.teamNewsBefore/After`, `internal/team-news.ts`). The
  line-ups are announced when **both sides first have starters stored**, for
  a match that is scheduled or live -- not one already announced before this
  shipped, not a correction, not a line-up that arrives with the post-match
  detail. A player is announced the first time the provider lists them
  `out` for a scheduled match; `doubtful` is not announced (it is not news a
  follower can act on), a player dropped from the list is not announced as
  fit (the feed never says "fit", T-103), and a player with no name is not
  announced as somebody. Each is a `match_alert` row keyed
  `<fixture>:lineups` or `<fixture>:out:<person>`, the notification's dedupe
  key, so a retry, a second process or a player listed, dropped and listed
  again reaches nobody twice. A long-term absentee is named once per match.
  They open the match at its line-ups (`#lineups`).
- `friend_predicted` (the `social` category): when a member makes their
  **first** prediction on a match, each friend who follows either team or the
  competition, or has predicted the match too, is told -- only where the
  predictor's own `prediction_history_visibility`, asked of the profile
  boundary per recipient exactly as D-063 asks it, lets that friend read the
  prediction. It is sourced (the friend's name, so a block applies), keyed
  `friend_predicted:<fixture>:<friend>` so a revision is the same news, and
  says **that** they predicted, never **what**: the plan does not say whether
  a pick should reach a friend before kick-off, and a notification is not the
  place to decide it, so the pick stays where the member's own setting
  already shows it. It opens the match. It is written from
  `PredictionsService.submit` and never fails the prediction.

**Defaults.** All three **off** (the E83 row says opt-in). Team news and
line-ups arrive for every followed match and most of them nobody is waiting
on; a friend's activity is not something the product interrupts anybody
with unless they asked. Each is a switch in Settings → Notifications: the
first two in the match-alert section, the third in its own "Friends'
predictions" section, both worded through the catalogues.

**Alternatives considered.** Announcing the line-ups when one side arrives:
half a line-up is the question, not the answer. One alert per match listing
every absentee: its key would have to change whenever the list did, and
then a list that grew by one player would repeat the rest. Including the
pick for a friend whose history is public: defensible, but a second rule
about when a pick may be seen, which D-063 declined to add; the friend can
open the profile. Telling followers who are not friends: that is a feed, not
a notification, and the blueprint's line is about friends (8.1).

**Consequences.** `notificationPath` takes the kind (optional), so a fixture
notification can open a region of the match page; the kind lists of
`notification`, `notification_preference` and `match_alert` are widened by
`1764780000000_lineup-friend-alerts.sql`, which reads each constraint as it
stands.

## D-100, continued (T-833) — Editorial notifications: the founder's analysis to its match's followers, a review to its author, a newly eligible member to administrators
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-833 adds three notification kinds, each a consequence of a
write that already happens, each deep-linking where the plan says.

- `founder_analysis_published` (category `football`): the **first** version
  of the founder's analysis of a match is announced to everyone following
  either team or the competition, the author excepted, keyed
  `founder_analysis:<fixture>` so a revision is the same analysis. Written
  from `FounderAnalysisService.publish` after the version commits, sourceless
  (the platform's editorial, not one member reaching another), and never
  failing the publication. Opens the match at the founder's analysis
  (`/match/<id>#analysis`). Only the founder's analysis: a community
  analysis is not announced to followers (rule 6 keeps the two apart, and
  the plan names only the founder's).
- `analysis_reviewed` (category `account`): the decision on a community
  analysis submission, to its author, once per submission
  (`analysis_review:<submission>`, the key it already had). It replaces the
  `contributor_grant_changed` notification the review used to send, whose
  words ("Your contributor approval changed") were about something else. Its
  subject is new, `analysis_draft` (the fixture's id), so it opens the
  analyst's editor (`/analyses/<fixture>`), where the decision and its reason
  sit beside the draft (T-262), and so a team mute -- which silences what is
  about that team's matches -- never silences the answer to a submission.
- `contributor_eligible` (category `account`, **administrators only**, like
  `system_alert`): a member who newly meets the four measurable requirements
  (blueprint 9.4, `eligibilityFor`) is announced to every administrator, the
  member excepted. The verdict is asked after every
  `ReputationService.recompute` of an existing member -- eligibility can move
  without the rating (a sanction ageing out, an address verified) -- and
  `contributor_eligibility_state` keeps the last one, so only a **transition**
  to qualifying is announced, in one statement that two recomputes racing
  cannot both win. `times_qualified` is in the dedupe key
  (`contributor_eligible:<member>:<n>`): a member who drops below and
  qualifies again is announced again, once. A member who already holds a
  grant in any standing is not announced -- a person has decided about them.
  The line names the member by username (read at display time, like a
  watchdog alert's); it opens the contributors page (`/admin/contributors`),
  where the requirements and the decision are. It grants nothing (T-250).
  Quiet hours hold it: it is a queue, not a pager.

**Defaults.** All three **on**. The founder writes a handful a week and a
follower of the match came for exactly that; an analyst who submitted is
waiting for the answer (it was on before, under the other kind); the
administrator who approves contributors is the one person who must know
somebody is waiting. Each has a switch in Settings → Notifications, in a
new "Analysis" section worded through the catalogues; the contributor switch
is shown to administrators only, because the API offers it to nobody else.

**No replay, and one exception to it.** Nothing is backfilled: analyses
already published and reviews already decided are not announced. The
eligibility state starts empty, so a member who qualified before this
shipped and holds no grant is announced once, at their next recompute --
the thresholds live in code (D-059), and seeding the state in SQL would be a
second copy of them. They are exactly the members the contributors page
already shows as waiting, so the notice is late news, not wrong news.

**Alternatives considered.** A poller over `contributor_eligibility_input`:
it would need the thresholds in SQL or every member read each pass, and
would announce on its own interval rather than when the recompute changed
the answer. Announcing every revision of the founder's analysis: a revision
is the same analysis, and the page shows the newest. Keeping the review under
`contributor_grant_changed`: a member who switched off grant changes would
stop hearing about their analyses, and the sentence was wrong.

**Consequences.** `notificationPath` routes `analysis_draft` and, by kind, a
`contributor_eligible` member and a `founder_analysis_published` fixture;
`1764790000000_editorial-notifications.sql` widens the kind and subject lists
as they stand and creates `contributor_eligibility_state`.

## D-101 — The restore drill runs itself monthly, and both runs are rows the watchdog reads
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-805 puts D-032's monthly drill on a systemd timer beside the
backup's: `fmip-restore-drill.timer`, the first Monday of each month at
04:40 UTC (an hour after the daily 03:30 backup), running
`restore-drill.sh --scheduled` as `fmip`. That run takes the newest dump and
manifest from the off-provider remote (the local copy only when no remote is
set, and says so), fails if the dump is more than 48 hours old, runs the
existing manifest checks (checksum, every migration, every table's exact row
count, the forecast CHECK and trigger) and then compares the restored copy
with the live database: the same migrations (or an earlier prefix, for a
deploy after the dump), and six key tables' counts within 10 % (never under
100 rows). Its container and downloads are removed on exit.

The API learns of both scripts through a table, `backup_run` (migration
`1764770000000_backup-run`): each run, pass or fail, ends by appending one row
(kind, start, finish, ok, dump name, what failed) through `psql` in the
postgres container, which is how the scripts already reach the database. The
watchdog (D-095) reads it:

- `backup`: 26 / 50 h since the newest successful backup as before, and now
  at least `degraded` when the newest run failed, `failing` when runs exist
  and none succeeded.
- `restore_drill` (new): 35 / 70 days since the newest drill that passed;
  `failing` when the newest drill failed, whatever its age.
- Both `unknown` when nothing was ever recorded (a laptop, a server without
  the timers), never `ok` by default.

**Why.** A table is the simplest record the API can already read: no new
mount, no file format, no second writer to trust, and the history comes for
free. A status file mounted read-only into the api container was the other
candidate; it needs a compose change on the server, holds only the newest
result, and a stale file looks exactly like a fresh one. A failed newest
backup raising at once, rather than after the age catches up, is the exit
criterion ("a failed backup reaches an administrator's device within
minutes"). The comparison with live exists because a manifest proves a dump
is whole, not that it is ours or recent. The first Monday stays D-032's day;
thresholds of five and ten weeks allow one missed drill before failing.

**Alternatives considered.** The drill as a BullMQ job inside the API: the
API would need the Docker socket to start a throwaway Postgres, which is
root on the host. A drill restoring into a second database inside the live
container: it shares the disk and the memory with production during the
restore. Counting a drill of the local copy as a pass when a remote is set:
the local copy is not the one in doubt.

**Consequences.** The maintainer installs `fmip-restore-drill.{service,timer}`
once (`07-backups.md`, "Schedule") and records the first timed run in the
handoff. `check-setup.sh` has a `Restore drill` line. T-804's System page
shows both conditions through the watchdog report. A threshold change is a
one-line change in `apps/api/src/modules/watchdog/internal/conditions.ts` and
an edit here.

---

## D-102 — Activity counts: what is counted, per UTC day, from rows the product already keeps
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-807's Activity page (`GET /admin/activity`, admin role) counts
per UTC calendar day, over 30 days by default (at most 90): registrations
(`user_account.created_at`), verifications (`email_verified_at`), sign-ins
(`session.created_at`), active members (distinct members who started a
session or submitted a prediction version that day), deletions
(`retired_username.retired_at`), predictions, prediction changes (versions
after the first), settlements (settled or voided), rating snapshots, direct
messages, group posts (messages in groups and their match threads), match
panel posts, group polls, reports, notifications written, and push and
e-mail deliveries sent and failed (`notification_delivery.carried_at`).
Every figure is a `count(*)` or a `count(DISTINCT ...)` computed in the
database; the answer carries numbers and day labels only.

**Why.** E80 says "counts, not tracking": nothing new is recorded about a
member to produce these numbers, so each one is a column the product already
writes for its own work. "Active" is the one definition with a choice in it:
signing in or predicting are the two acts that leave a dated row per act
(`session.last_seen_at` is only the newest visit, so a daily "seen" count
would need a new record of each visit, which is tracking). UTC days, because
the server's day is the one every other admin count uses (T-803).

**What deletion does to the counts.** D-094 keeps a deleted account's
tombstone, predictions, settlements, messages and reports, unnamed: they
keep counting. It erases the address with its verification time and the
sessions: those are not reconstructed, so a past day's verifications and
sign-ins can fall after a deletion, and the page says so.

**Alternatives considered.** A daily rollup table written by a job: faster on
a large database, but a second copy of the same facts that can drift, and
unnecessary at this size (one statement over indexed timestamp columns). A
page-view or visit counter: new tracking, refused by E80.

**Consequences.** Adding a count is a line in
`apps/api/src/modules/activity/internal/activity-store.ts`, a name in
`ACTIVITY_METRICS` and its words in `apps/web/src/lib/activity.ts`.

---

## D-103 — The rate-limit inventory: every write has a ceiling or a stated reason, and three gaps closed
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26) · **Tasks:** T-811 · **Follows:** D-054, D-093

**Decision.** Every write the API takes (any method but `GET`, `HEAD`,
`OPTIONS`) is listed in `apps/api/src/modules/rate-limits/inventory.ts`,
either under the `rate_limit` ceiling that holds it or with the reason it
needs none, and the console security spec fails on a write the router has
that the list does not cover. The console (`/admin/...`) is exempt as a
class: role-gated and audited. The list is written out in
`02-architecture.md`, "Rate limits", and a unit test holds the section to the
file. The inventory found three writes that needed a ceiling and had none:

- **`POST /me/briefing`**, a language-model call on every press, from a plan
  the briefing, "ask", the moderation assistant and the match summaries
  share: `briefing`, **6 an hour** per member.
- **`POST /me/push-subscriptions`**, an https endpoint the member names, to
  which every notification of theirs is then POSTed: `push_subscription`,
  **10 an hour** per member.
- **`POST /auth/account/delete`**, which checks the password: held to the
  sign-in ceilings (`login_failure_account` against the account's username,
  `login_failure_ip`), counted before the check and given back when the
  password is right, so the lock is the sign-in's own. Without it a session
  left open was an unlimited way to guess the password it was opened with.

The two new ceilings are counted in `rate_window` by the API before the work
(`RateLimitsService.take`), not by a trigger: the briefing's cost is the model
call, which comes before any insert, and the push registration is an upsert
only the API writes. Refusals are counted per ceiling per UTC day in
`rate_refusal` -- the ceiling and the day, never the member, address or
identifier -- for 30 days, and the System page shows the last seven next to
each ceiling's number as the table has it now (`GET /admin/rate-limits`). A
trigger's refusal rolls its own count back with the refused insert, so those
are counted by a response hook on a 429 from a route one trigger ceiling holds.

**Why these numbers.** A member asks for a briefing a few times a day, and a
briefing covers a day of their feed; six an hour is far above that and far
below what drains a shared model allowance. A member turns push on in each
browser they use, once; ten an hour leaves room for turning it off and on
again, and stops the one thing an unlimited list of endpoints allows, the
server sending each notification to as many addresses as a member cares to
name.

**Deliberately unlimited, and said so.** Reporting and appealing stay
unlimited (T-213: the exit is never gated; reporting is limited by target).
Blocking too: it protects the caller and reaches nobody. Every other write
without a ceiling is bounded by a key (one row per member and target), is the
caller's own setting or state, answers something already limited, or is
role-gated; the inventory gives each its reason.

**Rejected.** *A total cap on push devices per member*: a rate is what this
task asked for, and ten an hour already makes a flood slow; a cap is a
product decision about how many browsers a member may use. *Counting
refusals per route instead of per ceiling*: sign-in has two ceilings on one
route, and which one refused (one identifier or one address) is the thing an
operator needs to know. *A trigger for the briefing*: it would refuse only
after the model had been paid.

**Not a write, so not in the inventory, and a gap:** `GET /ask` calls the
language model for guests and members with no ceiling. A guest has no member
id and the web app forwards the reader's address only on the account forms,
so a limit there needs the address on that request too; it is left for its
own task rather than widened into this one.

**Consequences.** A new write fails CI until it is given a ceiling or a
reason in `inventory.ts` and a line in `02-architecture.md`. A new ceiling is
a `rate_limit` row plus an inventory entry (a test fails on either alone).

---

## D-104 — `GET /ask` is limited: a member per account, a guest per address, and a refusal still searches
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26) · **Tasks:** T-838 · **Follows:** D-093, D-103

**Decision.** The gap D-103 recorded is closed with two `rate_limit` rows,
both counted by the API before the model is called:

- **`ask`, 60 an hour per member**, in `rate_window` (`RateLimitsService.take`),
  for a request that carries a session.
- **`ask_ip`, 120 an hour per network address** for a signed-out reader, in
  `auth_rate_window` under the address's HMAC (`IdentityService.takeForAddress`),
  the address being Cloudflare's as the web app forwards it in
  `X-Fmip-Client-IP` -- now on `/ask` as well as the account forms -- and
  accepted only when it is a well-formed IP (D-093).

Past either, the answer is 429 `rate_limited` with `Retry-After` (the end of
the hour) and a sentence, the model is not called, and the refusal is counted
for the day in `rate_refusal`. A guest with no forwarded address is not
limited (as on the account forms: never one bucket for everybody), and a
deployment with no model is not limited at all, because its `/ask` is the
keyword search and costs nothing. `GET /ask` is the one read in the
inventory; the security spec now requires a ceiling's routes to exist and an
exemption's to be writes.

**The search page, refused, still searches.** It asks `GET /search` for the
catalog's kinds -- no model, no ceiling -- and shows the refusal's sentence
above the rows. A reader behind a shared address (a household, an office, a
carrier's NAT) loses the reading of the question, never the search.

**Why these numbers.** A question is a short call (at most 300 tokens back)
and search is how the site is navigated, so a member gets ten times the
briefing's six; one a minute for an hour is past what a person searching does.
An address is shared, so it gets twice a member's, and the fallback makes a
refusal cheap for whoever else is behind it.

**Rejected.** *Limiting per address for members too*: a member is known, and
a shared address would refuse members for a guest's traffic. *A 200 with the
keyword fallback from the API instead of 429*: the task and the other
ceilings answer 429, and the page can fall back without the API pretending
the question was read. *Limiting the keyword search*: it calls no model.

**Consequences.** A request that reaches the origin without Cloudflare can
choose its own address and so its own counter (as D-093 says); the members'
ceiling and the model's own plan limit hold regardless.

---

## D-105 — Match alerts leave the live job: recorded in the run, written per event in one statement by a queued worker
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

(D-104 is taken by T-838's open PR, so this is the next free number.)

**Decision.** T-835 changes how D-098's alerts are written and carried, not
what they say or to whom.

- **The ingestion run only records.** `MatchAlertsService.after` and
  `teamNewsAfter` derive the events as before and record each in
  `match_alert`; nobody is told in the run. At the end of the run `dispatch`
  adds one job to the `match-alerts` BullMQ queue carrying the run's event
  keys. The queue and its worker run in the process that runs the jobs
  (`INGESTION_SCHEDULE=on` with `REDIS_URL`); a worker may run in more than
  one process.
- **The worker writes per event, in one statement.** It claims each pending
  event of its job (and any pending for more than two minutes, whose job was
  lost) with `FOR UPDATE SKIP LOCKED` and a two-minute lease, reads the
  audience -- the followers, or for a correction those told of the goal -- and
  writes every notification with one `INSERT ... SELECT`
  (`NotificationsService.emitToAudience`). The rules are `emit`'s, as
  conditions of the SELECT: the member's switch or the default, the category
  mute, `notification_muted_for` (the one copy of the team and competition
  mute rule), `quiet_hours_end` for the hold, and the dedupe key's unique
  index with `ON CONFLICT DO NOTHING`. It marks the event done
  (`expanded_at`), and when its events are written it carries what it wrote
  for now, one push per member per page.
- **Idempotent by the keys, not by the claim.** A retry, a second worker or a
  replay reaches nobody twice because the event key is the dedupe key and the
  delivery claim is per notification. The lease only saves work. A correction
  is not claimed while the goal it withdraws is pending, so its audience is
  complete. An event a stopped worker had claimed carries its whole audience
  when it is taken over, since some of its notifications may be written and
  not yet carried (`carry` sends only what is due and unclaimed).
- **Without a queue** (no Redis, a test, a queue that refuses the job) the
  run expands its own events at its end, as before.

**Why.** T-834 measured the old path at about 12 ms per member told, all of
it inside the live job: a goal burst to 10,000 followers took 64-70 s, and a
three o'clock kick-off held the live job for ten minutes, so the scores were
late too. Taking the alerts out of the run keeps the live job at 3-4 s
whatever the audience, and one statement per event replaces about five
queries per member (docs/08-load-test.md, "T-835").

**Where the batch changed.** D-098's "one member's alerts of one run leave as
one push" is now "of one job, per page of 500 notifications": events of one
run are one job, but a member whose notifications straddle two pages, or two
jobs racing, may get two pushes. T-836 pages by member.

**Alternatives considered.** A job per event: many small jobs for a burst,
and the batch per member would be lost entirely. Expanding in the database
with a trigger on `match_alert`: the insert would run inside the live job's
transaction, which is the cost being removed. Keeping `emit` per member in
the worker: off the live job, but 50,000 round trips for a kick-off.

**Consequences.** `match_alert` gains `claimed_at` and `expanded_at`
(`1764820000000_match-alert-queue.sql`; rows already there are marked done).
The watchdog watches the new queue's failed jobs, and failure counts count
them. `emitToAudience` is sourceless only and sends a capped kind through
`emit`, because a block refusal or a per-member cap cannot be a condition of
one statement.

## D-106 — Carrying a burst: claims and outcomes set-based, and the send pool sized for the server
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision (T-901).** The carrier claims a page and records a page, one
statement each. What is carried, to whom, and the "at most once" rule stay
as D-074 and T-330 made them.

- **The claim is a page.** `claimDue(page, members)` selects the due page
  (past its hold, created within a day, no claim yet, ordered by member when
  scoped) and inserts every claim in the same statement. It returns the page
  and marks what this carrier won. The claim is still
  `notification_delivery`'s key, written before any send, so racing carriers
  never send one twice.
- **The plan is pinned.** "No claim yet" is a probe of the claim's key per
  candidate, written as a scalar subquery so it is never flattened into a
  join. The statement runs in its own transaction with `SET LOCAL
  enable_seqscan = off`. A burst is planned on statistics that have not seen
  it, and the planner's own choice scanned the claim table once per
  candidate, 3 to 12 s a page.
- **The outcomes are a page.** Each message's outcome is collected, and the
  page's are written with one `UPDATE ... FROM unnest(...)`. If Postgres
  refuses it, each row is written on its own.
- **A drain claims the next page while this one sends.** It does so only
  when this page was full and the bounds allow another pass. A page that was
  claimed is always sent. Match alerts deliver through the drain, in pages
  of 500 bounded by 200 passes.

**Why.** T-836 left about three round trips per notification around the
sends, and a kick-off of 90 matches at 10,000 members at p95 70 s. Now it
is two statements a page, and 53 s (docs/08-load-test.md, "T-901").

**What it costs.** A process that stops mid-page leaves that page's
unsent claims unsent. That is at most a page (100, or 500 for match alerts),
where it was the sixteen messages in flight. It is still "at most once,
never twice": a claimed notification is never sent again, and its outcome
stays empty, which T-802's counts show as pending.

**Alternatives considered.** An index for the claim (migration
`1764890000000` was reserved for it): the plans showed the scan was the
planner's choice on stale statistics, not a missing index, so an index
would not have changed it. Neither did `ANALYZE` after each burst, which
would only be a guess at when the statistics are stale enough. Nor
autovacuum settings on `notification`, since the burst is carried within the
minute and autovacuum wakes once a minute at best. A cursor over the pages,
so a page never re-reads what earlier pages claimed: better asymptotically,
but it changes `carry`'s contract for every producer, and the pinned probe
made the claims a small part of the minute.

**Consequences.** No migration. `claimDelivery`, `claimDeliveries`,
`recordDelivery`, `recordDeliveries` and `due` are replaced by `claimDue`
and `recordOutcomes`. `drain` takes the page size.

**Decision (T-902): the send pool.** `NOTIFICATION_SEND_CONCURRENCY` is set
per machine, from a measurement, against the API's `pg` pool of 10. In
production one process serves members' requests and runs the jobs, on the
same pool. A value **starves the pool** when a member's request waits for a
connection: a `SELECT 1` probe through the pool every 100 ms over 100 ms at
p95, or the live job more than 1.5 times slower than at 16. The value is the
largest of 16, 32 and 64 that does not starve the pool.

- **Laptop (8 cores), 2026-09-29: 64.** A kick-off of 90 matches at 10,000
  members, with pushes of 50 ms that read and touch the member's devices as
  Web Push does, reached p95 25.3–27.6 s at 64, 35.8–38.7 s at 32 and
  55.5–63.5 s at 16. The probe's p95 was 6–23 ms at every value, and the live
  job stayed at 2.4–4.8 s. None of the three starved the pool
  (docs/08-load-test.md, "T-902").
- **Production (2 shared vCPUs): pending the lead's run** of the command in
  docs/08-load-test.md, "T-902". Until it is recorded here, the server runs
  the default, 16. Every statement is slower there, so 64 may queue where 32
  does not; the laptop's answer is not carried over.

**Consequences (T-902).** The production compose file forwards
`NOTIFICATION_SEND_CONCURRENCY` to the API. Before, a value in the server's
`.env` never reached the process. The code's default stays 16 until the server
is measured. `load-match-alerts.mjs --push-reads` and its `api_pool` report
are how the value is measured.

## D-107 — Campaign emission is one statement per audience page, like match alerts
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-903 changes how a campaign's notifications and outcome rows
are written, not who is told or what the report says (D-075).

- **A page at a time.** `CampaignsService.send` takes the audience in pages
  of 500 (`EMIT_PAGE`). Each page is one `NotificationsService.emitToAudience`
  statement for its notifications (T-835, D-105: the same rules as `emit`),
  then one `PostgresCampaignStore.recordPage` statement for its
  `campaign_send` rows, which returns the page's count of each outcome.
- **The outcomes keep their meaning.** Written now is `sent`, held by quiet
  hours is `delayed`. A member the inbox did not write is `duplicate` when
  they already hold this campaign's notification (its dedupe key), and
  `muted` otherwise. `emit` checked the mutes before the key, so a member who
  is both muted and already told now reads `duplicate`. That member cannot
  exist while the dispatch claim comes first.
- **A failed page is `failed`, and the send goes on.** `emitToAudience`
  returns `null` when its statement fails. Every member of that page is
  recorded `failed` and the next page is still sent, as a failed `emit` used
  to fail one member and not the send.
- **Nobody twice.** The dispatch claim is still first. The notification's
  dedupe key and `campaign_send`'s primary key are the second and third
  guards (D-075's "claimed once").

**Why.** T-837 measured a 10,000-member send at 132 to 346 s of emission,
about six round trips per member. With T-903 it is 10 to 17 s, and the whole
send, carriage included, takes under a minute (docs/08-load-test.md, "T-903").

**Alternatives considered.** One statement for the whole audience: fewer
round trips, but one long statement and one 10,000-element array per
send, and a single failure would fail everyone. Pages of 500 keep each
statement short and a failure local. Keeping `emit` and batching only the
outcome rows: emission was the larger cost, so that would remove the smaller
half. Recording outcomes in the same statement as the notifications: the
inbox's statement belongs to the notifications module and campaigns may not
reach into its internals.

**Consequences.** `recordSend` is gone. `recordPage` reads `notification`
by the dedupe key to tell a duplicate from a mute. The remaining emission
cost, about 1 ms a member, is inside `emitToAudience`, which is shared with
match alerts.

---

## D-108 — A `forbidden` error code: 401 is "who are you", 403 is "not you"
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26) · **Tasks:** T-904, T-905, T-906, T-907

**Context.** `ApiError` had no code for "signed in, but not allowed". A 403
carried `error: 'unauthenticated'` in six admin modules and
`error: 'validation'` in about fifteen others, each with its own sentence
(`NOT_ADMIN`, `NOT_AN_EDITOR`, `NOT_A_REVIEWER`, ...). A client could not tell a
refusal from a bad form by the code, and "unauthenticated" told a signed-in
member to sign in.

**Decision.**

- **`forbidden` is the code of every 403**, and only of a 403. The request
  was understood and the caller is known; they may not do this.
- **`unauthenticated` stays the 401** (no session, or an expired one), and
  **`email_unverified` stays its own code**, because its answer is different:
  verify, then try again. `locked` and `rate_limited` are unchanged.
- **One refusal body per role**, in `packages/contracts` (`ROLE_REFUSALS`):
  `administrator`, `editor` (or administrator), `moderator` (or
  administrator) and `operator` (a featured-match panel's operator: a
  moderator or administrator). Every role-gated controller answers one of
  these, never a sentence of its own. A member-facing 403 (not your group,
  not the founder, a blocked member) uses `forbidden(message)` with its own
  sentence, since what it refuses differs.
- A refusal carries `error` and `message` only: no fields, no data.

**Migration in steps.** T-904 adds the code, the bodies and the assertion in
`console-security.http.spec.ts` (every `/admin` route: a member and every
non-entitled role get `403 forbidden`), with the routes still on their old
code marked for the task that moves them. T-905 moves the admin-only
controllers, T-906 the editor, moderator and operator ones, and T-907 the
member-facing 403s, after which the assertion runs over the whole router and
a 403 with any other code fails CI.

**Rejected.** *Keeping `validation` for a refusal*: it says "fix the input",
and nothing the caller sends can fix a missing role. *A code per role*
(`not_admin`, `not_editor`, ...): the client's answer is the same for each --
you may not do this -- and the sentence already names the role. *Reusing
`unauthenticated`*: it is the 401's, and tells a signed-in member to sign in.

**Consequences.** The web reads the code rather than a message's words; a
403 shows "you may not do this", never a validation message
(`apps/web/src/lib/action-failure.ts`). CI holds the rule two ways: the
console security spec calls every route as a member with no role, and
`forbidden-code.spec.ts` reads every `ForbiddenException` in the source,
because most refusals need a state (a group, a sanction) a probe cannot
reach. The chat socket's upgrade refusal is a bare 403 on the socket, not
an `ApiError`, and is outside the rule.

## D-109 — The past-season findings are our adoption lag, not the feed's gaps; coverage is judged on what is left after adoption and one re-ask
**Status:** Accepted · 2026-09-28 (revisable under the standing delegation of 2026-09-26)

**What T-910 found.** Of the 6,633 open findings on 2026-09-28 at 20:09 UTC
(`lineup_not_eleven` 5,486, `goals_disagree` 1,147), 6,622 come from one
cause. The feed supplied a player we have not adopted yet (D-079: people are
adopted once the past-season backlog finishes). The writer leaves such a
player out of a line-up or a timeline rather than write a blank (T-026). The
other 11 are the feed's own answer. In 8 cup qualifiers settled after extra
time, the score leaves out the extra-time goals the timeline carries. In 3
current-season line-ups, one starter most likely had no id. The classes, their
counts and example fixtures are in `05-data-providers.md`, "What the
past-season findings are". No check and no parser is wrong, so T-911 is closed
without a change.

**Decision.**

1. **A finding whose player is waiting in the queue is repaired, not
   reviewed.** Adopting people (D-079) re-asks every fetched match within the
   post-match budget, and the sweep resolves what then agrees. Bulk review
   (T-912) is for findings that remain after that. Marking the adoption lag
   reviewed would hide a gap that is ours to close.
2. **What the feed answered is confirmed by asking again once** (T-913,
   D-110), counted against the day's budget. That re-ask is the provider-side
   sample T-910 did not take: this diagnosis read stored rows only and spent
   no request. If the answer is unchanged, the finding is reviewed with the
   reason "the feed's own answer, asked again on <date>". Nobody overrides a
   stored value (N-3).
3. **Coverage follows the remainder, not the raw count.** A past season's
   `lineups` or `incidents` is proposed as `limited` (T-914) only when all
   of these hold:
   - Every finished match of the season has had its details fetched.
   - No person from the season's provider is pending in `unresolved_entity`.
   - At least **10%** of the season's finished matches still have an open
     `lineup_not_eleven` finding (for `lineups`) or `goals_disagree` finding
     (for `incidents`), after one re-ask.

   The proposal names those counts. An administrator applies it through the
   audited coverage write (T-070), and nothing is applied without a person.
   Before those conditions hold, the season's coverage is not proposed at
   all. Our own lag is not reported as the feed's gap.

**Why 10%.** A season whose line-ups are "mostly incomplete" must never show
as `available` (rule 3). One match in ten, left short after a re-ask, is
already a line-up page that misleads often enough to say so. A handful of
feed slips (class C and D: 11 in 4,684 fetched matches) is not a season's
coverage, and is reviewed one by one instead.

**Alternatives considered.** Reviewing the 2025/26 findings in bulk now: it
would clear the page, but it would label 6,622 gaps we are about to close as
accepted. Proposing `limited` from today's counts: 94% of 2025/26 matches
would qualify, but the feed supplied every missing player. Adjusting
`lineup_not_eleven` to ignore sides whose players are queued: it would hide the
gap's size, and the check would then depend on the resolver's queue.

## D-110 — Re-asking the feed: an administrator queues it, the post-match job carries it within 5 % of the day's budget, and the next sweep decides
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-913 lets a person ask the licensed feed again. No value is
ever corrected by hand (N-3).

- **Who.** Administrators only, from the data-quality page or
  `POST /admin/data-quality/refetch`. One fixture (`fixture_id`), or every
  fixture behind one check's open findings in one season (`check`,
  `season_id`). A reason is required. One `audit_log` row per request
  (`data_quality.refetch`, on the fixture or the season) names the fixtures
  queued (rule 10). Only a fixture some provider holds an id for can be
  queued. One request waits per fixture (a partial unique index), so asking
  twice while one waits is a 409, not a second request.
- **From which budget.** The post-match job carries the queue after its own
  recent matches and backlog, oldest request first, through the same writer
  as every other detail. It carries at most **5 %** of
  `API_FOOTBALL_DAILY_BUDGET` a UTC day (`INGESTION_REFETCH_SHARE`, 0 to 10;
  350 of 7,000) and at most **20** a run. It carries none while the day's
  recorded requests are at **70 %** of the budget or more. 70 % plus a share
  of at most 10 % is below the watchdog's `degraded` at 80 %, so the queue
  never raises the budget condition by itself (`refetch-share.spec.ts` walks
  a day at every share and budget). The ceiling itself stays
  `BudgetedTransport`'s. A fixture the run already asks about for another
  reason waits for the next run, so it is never asked twice in one run.
- **How it resolves a finding.** The job records when it asked and whether
  the answer changed any stored row (`fixture_refetch_request.changed`). The
  sweep then judges the stored data as always. If the data now agrees, the
  finding resolves. If not, it stays open, and the page says "asked again on
  <date>, unchanged", or that the answer changed and still disagrees. Per
  D-109, an unchanged answer is the feed's own, and is then reviewed with
  that reason (T-912).

**Why 5 %.** On a Saturday the plan projects about 4,000 of 7,000 requests
(`05-data-providers.md`, T-501). 350 more keeps such a day near 4,350, well
under the 7,000 ceiling, and the past-season classes D-109 names for a
re-ask come to 11 fixtures. A class of a whole season's line-ups (700
fixtures) takes two days at that pace. That is the right pace for a
correction nobody is waiting on live.

**Alternatives considered.** Deleting `fixture_detail_fetch` rows so the
backlog asks again, as adoption does (D-079): it has no reason, no audit and
no outcome, and it spends the backlog's batch rather than a stated share. A
separate BullMQ job for the queue: a second writer of fixture details, and a
second place the budget would have to be counted.

**Consequences.** `1764840000000_fixture-refetch-request.sql` adds
`fixture_refetch_request`. `DataQualityFinding.asked_again` and
`DataQualityReport.refetch` are in the contract. `INGESTION_REFETCH_SHARE` is
in `.env.example` and forwarded by the production compose file.

## D-111 — An Elo prior from our own records, within D-014, when Club Elo does not answer
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26) · **Tasks:** T-920, T-921, T-922 · **Follows:** D-014, D-016, D-029, D-080, D-082, D-083, D-095

**The problem.** The published model (`dixon-coles-elo@0.1.0`, D-029) pulls
each club's net strength toward its Club Elo rating. Club Elo's API has
answered `502 Bad Gateway` since 2026-09-25, so every forecast since has been
fitted without the prior (`elo_used: false`), and nothing said so anywhere an
administrator or a reader would look: the snapshots were loaded by hand, the
failures were rows nobody read, and the strength factor's note still named
"the Elo prior".

**T-920: the source's state is visible.**

- **The service asks, and records the answer.** The model service asks Club
  Elo for yesterday's snapshot (a fit's date is the day before the match, and
  never later than yesterday) at most every six hours, in the background of
  its health check, through the existing loader: one `source_load` row per
  ask, `succeeded` or `failed` with the error. A snapshot already held is not
  asked for again. It never blocks or fails a forecast; the held ratings stand.
  `MODEL_CLUBELO_REFRESH=off` stops the asking (CI sets it; N-4 would).
- **`/health` reports it.** `elo_source`: the newest snapshot day that loaded
  and when, the newest error and when, and `unanswered_since` -- the newest
  success, else the oldest failure since -- read from `training.source_load`.
  A store that does not answer is `unreadable`, never a failed health check.
- **The watchdog counts days.** Condition `elo_source`: seconds since
  `unanswered_since`. `degraded` at three days: forecasts are still made, from
  results alone, and say so, so it is worth a look, not a wake-up. `failing` at
  fourteen: a fortnight without the prior is the week's question (T-921's own
  Elo, or N-4). `ok` when the asking is off on purpose; `unknown` when the
  model service does not answer (that is `model_service`'s condition), does
  not report the source, or has never asked. The transition rule is D-095's,
  so four days of 502s at a check a minute is one incident and one alert, and
  the first answer after it is one recovery. The System page names it
  "Club Elo (the model's long-term ratings)" and shows the note: the day it
  last answered for and the last error.
- **The forecast panel says it per version.** A version whose stored inputs
  say `elo_used: false` adds "No Elo prior this time" to its factor list,
  from the version's own inputs (rule 5), never from the source's state now.
  New versions' strength note says "no Elo prior this time" too; older ones
  keep the words they were stored with, and the panel line corrects them.

**Rejected.** *Asking on every forecast*: a hanging source would hold a
forecast past the API's timeout. *Asking on the watchdog's minute*: sixty
requests an hour to a free API for a daily number. *A separate timer on the
host*: one more thing to install, and the service already holds the loader,
the store and the clock.

**T-921: an Elo of our own, from the training store.** (Migration
`1764850000000`.)

- **What it reads.** Every result in `training.match`: football-data.co.uk's
  divisions (D-016, training only) and our own records of the licensed feed
  (D-083). Nothing else, so the prior a fit may take from it is licensed and
  training data only, within D-014 -- unlike Club Elo, which is neither.
- **Who a club is.** Its catalogue id where the committed bridge names it
  (`training.team_alias`, D-080), so a club's league and cup matches are one
  club's; otherwise `<division>:<name>`, a club of that division only. Two
  spellings are never matched by likeness, and the same spelling in two
  divisions without the bridge is two clubs. The limit, stated: a club
  promoted from a division the bridge does not cover starts again in its new
  one.
- **The rules, frozen per version.** `own-elo@1.0.0` is World Football Elo:
  K 20, home advantage 60 points, the goal-difference multiplier (1, 1.5,
  (11 + d) / 8), a club entering at 1500 on its first match, matches applied
  by day, then division and clubs, so the same results always give the same
  numbers. A changed constant is a new version and a new run beside the old.
- **Clubs with no history are left out.** A club with no match on or before
  the day has no row, not 1500: a fit then gives it no prior beyond the ridge,
  as it does a club Club Elo does not rate.
- **Stored with the matches it was computed from.** One `own_elo_run` per
  (day, rules): the matches read -- their count, first and last date, and a
  sha256 over them in the order applied -- and one `own_elo` row per club.
  `python -m fmip_model.training.own_elo verify --day …` recomputes the day
  from the stored results and compares the hash and every rating; a result
  that changed under a stored day is reported, not absorbed. Storing a day
  again replaces its run.
- **Daily, by the service.** The model service computes yesterday's run once a
  day in the background of its health check (after its daily reload of our
  own records, so the day's results are in), and a fit that asks for a day not
  yet computed computes it first. A failure is logged and retried after an
  hour; a fit without the prior says so (`elo_used`).
- **Not read by the published model.** `dixon-coles-elo@0.1.0` is unchanged
  (rule 5, D-082). T-922's candidate is the first version to read it.

**T-922: candidate `dixon-coles-elo@0.5.0`, in shadow.** It is 0.4.0 unchanged
(its per-division constants and its cross-league fit) plus one new setting,
`elo_prior: own`. The prior is always our own Elo, read by the division's
training names. A version now names its prior: `clubelo` (the published
version's, D-029), `own`, or `clubelo_then_own`. Nothing else changes, and
`dixon-coles-elo@0.1.0` stays the published version.

*The backtest* (`python -m fmip_model.backtest.elo_prior`, 2026-09-29,
report in `apps/model/reports/dixon-coles-elo-0.5.0/`). For each of the ten
divisions, the 2025/26 season was walked forward with the same weekly fit
dates and the candidate's own constants. Each variant was scored only on
the matches that every variant which ran had forecast. Log loss (lower is
better):

| Division | Matches | No prior | Club Elo, last cached | Own Elo |
|---|---|---|---|---|
| B1 | 303 | 1.0385 | not run | 1.0353 |
| D1 | 305 | 0.9796 | not run | 0.9762 |
| E0 | 378 | 1.0486 | not run | 1.0300 |
| F1 | 305 | 1.0056 | not run | 1.0045 |
| I1 | 377 | 0.9978 | not run | 0.9972 |
| N1 | 305 | 0.9889 | not run | 0.9869 |
| P1 | 304 | 0.9271 | not run | 0.9275 |
| SC0 | 227 | 0.9884 | not run | 0.9864 |
| SP1 | 377 | 0.9834 | not run | 0.9824 |
| T1 | 304 | 0.9956 | not run | 0.9979 |
| **Pooled** | 3,185 | **0.9965** | not run | **0.9933** |

Our own Elo is better than no prior in eight divisions of ten, and by 0.0032
pooled. It is worse in P1 (0.0004) and T1 (0.0023). This run was made on the
laptop. It used a training store built for the purpose from football-data.co.uk
2023/24 to 2026/27. That store has no aliases and none of our own records, so
there each club is rated from its own division's results alone. On the
server, the bridge and our cup records also link clubs across leagues.

*Club Elo could not be compared here.* The laptop holds no Club Elo snapshot,
and the API answered 502. The server holds the snapshots loaded before
2026-09-25. There, the same command scores the "last cached" variant
(`06-session-handoff.md`, Production). The task's rule is "Club Elo when it
answers and ours when it does not, or ours always, whichever the backtest
favours". With no Club Elo evidence, 0.5.0 takes the choice that needs
none: ours, always. That is also the choice that keeps the prior within
D-014. If the server run shows Club Elo's ratings ahead of ours, the next
version is `clubelo_then_own`, as 0.5.1 with its own record. 0.5.0 is not
edited (rule 5, D-082). Promotion is T-535's evaluation (D-120), never this
table.

## D-118 — Leaders beyond goals: assists, clean sheets and cards, each a stated rule
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-943 adds three boards to the competition page beside the
scorers (blueprint 5.1). Each is its own `Covered` module in
`CompetitionPage.boards`, computed from what the fixtures boundary already
stores. No provider request is added.

- **Assists.** A goal or penalty goal whose `related_person_id` names a
  player is that player's assist, credited to the scoring side. Own goals
  are nobody's. The board takes the season's declared `incidents` state.
  When the season's goals name no assist at all, the board is
  `not_supplied`: a list of nobody would read as a season without assists.
- **Clean sheets.** A side of a finished match with a score is *judged* when
  its line-up names exactly one starter at `goalkeeper`. That keeper keeps a
  clean sheet when the other side's latest score is nil (`current`, else
  `full_time`: extra time counts, a shoot-out does not) and the keeper
  finished the match: no substitution took them off and no red card (or
  second yellow) sent them off. A substitute keeper who finishes a nil is not
  credited, because they did not start. Each row also carries
  `starts_in_goal`, the judged matches the keeper started. The board takes
  the declared `lineups` state. It is `limited` when some finished sides
  could not be judged, because the list may be missing a keeper, and
  `not_supplied` when none could. Judged sides with no clean sheet are an
  empty list, not an absence.
- **Cards.** `yellow_card` is a yellow; `red_card` and `second_yellow_card`
  are reds, exactly as the player page counts them. The board is ranked by
  reds, then yellows, then name, under the declared `incidents` state.
- **The minutes floor.** `?min_minutes=` (T-824) applies to every board
  under the scorers' rule (`reachesFloor`). `boards.unproven` counts, per
  board, the players left out because their minutes cannot show the floor,
  and a board with any left out is `limited`.
- **Rows.** Each row is one person for one team, as the scorers are, so a
  mid-season move gives two rows. The minutes are the person's in that
  season for every team (T-824). Ten rows per board.

**Alternatives considered.** Crediting a clean sheet to every keeper who
played in a nil, or splitting it by minutes: the plan names the keeper who
started and finished. A board of zeros for a season whose feed sends no
assists: rule 3 forbids it. A disciplinary points scale (yellow 1, red 3): a
weighting nobody asked for, where two plain counts say more.

**Consequences.** `LeaderBoards`, `BoardPlayer`, `AssistLeader`,
`CleanSheetLeader` and `CardLeader` are in the contract.
`StandingsService.boards` is the standings boundary's answer; the catalog
adds minutes and the floor. No migration: the plan's row names none.

## D-119 — The manager is the coach on the team's latest line-up; news on entity pages is the news boundary's linking
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-944 fills the team page's manager and the team and
competition pages' news (blueprint 5.1, 5.2) from what is already stored. No
provider request is added.

- **The manager.** The coach the feed named (`fixture_participant.coach_id`)
  on the team's most recent stored line-up: the latest kick-off among the
  team's matches whose side has a line-up row or a named coach. It is shown
  as a fact about that match, with a link to it (`TeamManager.lineup_fixture`).
  When that line-up names no coach, `coach` is `not_supplied` and the page
  says the latest line-up names none. An older coach is never carried
  forward, because a club that changed manager would then show the wrong
  one as current. When the team has no stored line-up, `lineup_fixture` is
  null and the page says so. Coaching spells are not read: nothing ingests
  them, so a spell would be a guess.
- **News.** `GET /teams/:id/news` and `GET /competitions/:id/news` are the
  news page's latest cards (`ENTITY_NEWS_LIMIT`, five) for stories any of
  whose reports the news boundary linked to that team or competition
  (`article_entity`, the same links the `team` and `competition` filters
  read), newest first, under the same rights (D-061). As on the match page
  (T-145): `not_supplied` with `feeds_unread` until the feeds have been read
  at all, then `available`, possibly empty with `nothing_linked`. An unknown
  id is 404. The routes live in the news module, which still imports nothing
  from the football boundaries (rule 9): it checks the id against the table
  directly, as `forFixture` does.

**Alternatives considered.** The latest coach named on any line-up: it
survives a sacking. Reading `/news?section=latest&team=`: before the feeds
are read it answers an available empty list, which on an entity page would
read as "nobody wrote about this club". A window around today, as the match
page has around kick-off: a club's latest story is news whenever it was
written, and the list is short.

**Consequences.** `TeamPage.manager` (`TeamManager`), `EntityNewsResponse`
and `ENTITY_NEWS_LIMIT` are in the contract. No migration.

## D-114 — The scores card summarises the model's latest pre-kick-off version, the community's totals at D-052's floor, and viewing in the viewer's own territory

**Date:** 2026-09-29 · **Task:** T-940 · **Status:** accepted

Blueprint 4.1 asks each match on the scores list for a model forecast
summary, community prediction totals and where it can be watched. All three
existed on the match centre; the card said "not on this page yet". Putting
them on a list of up to a few hundred matches needed three judgements.

**Which forecast version.** The latest *published* version computed before
kick-off (`computed_at < kickoff_at`, the evaluation's own `pre_kickoff`
test, T-066). Before a match that is simply the latest version. Once it has
started, a version recomputed during or after the match is not the forecast
the match was played against, and a list that swapped to it would quietly
show a number fitted with knowledge of the game. The card names the version
and its computation time, and says "the statistical model". An unavailable
version shows its reason; no pre-kick-off version is said in words, never an
empty bar. `GET /forecasts/pre-kickoff?fixtures=` answers a *summary*
(probabilities, version, kind, model, time, reason), not the full version:
the inputs, factors and scorelines stay on the match centre.

**What "community totals" are, and the floor.** The crowd counts (how many
members' standing predictions picked home, draw, away) and the sample, from
`GET /consensus?fixtures=`, and only when the consensus is published at all:
D-052's five predictors. Below it the card says "not published until 5
members have predicted this match". Counts rather than percentages, so the
community's line cannot be read as a second set of model probabilities; the
weighted distribution stays on the match centre, where there is room to
explain it. The two lines are two components fed from two endpoints and two
maps; nothing averages or relabels them (rule 6, `three-products.spec.ts`).

**Whose territory.** The member's stored one (T-312), through
`GET /viewing?fixture=`. A guest, or a member who has not chosen, is asked
("choose your territory", linking to Watch), and nothing is inferred. The
scores page does not ask the viewing boundary for a guest at all.

**Keeping the list fast.** The page asks each product once per 50 shown
matches, all in parallel, after the scores snapshot (never a request per
card), and reduces the answers on the server to a few values per card before
they reach the client. The SSE stream stays scores only: a match the stream
adds after load says its lines were not loaded. The T-808 budgets in
`apps/web/perf-budgets.json` are unchanged.

**Alternatives considered.** Adding the three to `ScoreCard` on `GET /scores`:
one payload holding two prediction products, which T-136 already refused
(rule 6), and a heavier stream on every snapshot. Showing the latest version
whatever its time: simpler, and wrong for every match in play.

## D-116 — Following a match: its alerts under the member's own switches, once, until three hours after full-time
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-945 lets a member follow one match (blueprint 12.1).

- **A row like any other follow.** `followed_entity` takes `fixture`. The
  match centre has one control, and it posts the same
  `PUT`/`DELETE /me/following/:type/:id` as every other follow. A match is
  never a favourite: a favourite is pinned on the scores page and shown on
  the profile, and a match pinned there would be stale within a week. Asking
  for one is a 400, and a check constraint refuses it in the schema.
- **What it sends by default: the match alerts, and nothing else.** A match
  follower joins the match-alert audience (`MatchAlertsStore.followers`)
  beside the followers of either team and of the competition. What reaches
  them is what their match-alert switches (D-098, D-100), the team,
  competition and `match` mutes and quiet hours allow, exactly as for a team
  follower, because the audience is still written by `emitToAudience` in one
  statement (D-105). There is no second set of switches for a followed match.
  Other producers that read `followed_entity` (the founder's analysis, a
  friend's prediction, campaigns, the Following feed) do not read a match
  follow.
- **Once per event per member.** The audience is one row per member however
  many ways they follow the match (the match, both teams and the
  competition), and the event key is the dedupe key, so nobody hears an
  event twice. A correction still goes to those told of the goal.
- **The follow ends by itself three hours after full-time.**
  `fixture_follow_open(id)` is the one copy of the rule: open until the match
  is finished, awarded, cancelled or abandoned and three hours have passed
  since the last period recorded ended, or since two hours after kick-off
  when no period is recorded. A postponed or suspended match keeps its
  followers until it is played. Every read of a match follow asks it: the
  audience, `GET /me/following` (an ended follow is not listed) and a new
  follow (a 409 once the window has closed). The row of an ended follow is
  removed the next time the member follows a match, and with the account.
  The match centre does not offer a follow for a match that is over.

**Why three hours.** Full-time is the last alert a follower asked for, and a
provider may still settle the score, or take a late goal off the board, in
the hour after it. Three hours covers that and a late full-time from a delayed
feed, and is short enough that a follow never lasts into the next matchday.
Two hours after kick-off stands in for full-time only when the feed recorded
no period.

**Alternatives considered.** An `ends_at` stored on the row: full-time is not
known when the follow is made, and a postponement would have to rewrite every
follow. A sweep job deleting ended follows: a second schedule for rows that
already follow nothing. A per-match set of switches: a second preference read
on every alert, the cost D-098 declined for per-team switches.

**Consequences.** `1764870000000_follow-fixture.sql` widens
`followed_entity_type_check`, adds `followed_entity_fixture_not_favourite` and
`fixture_follow_open()`. `FOLLOWED_ENTITY_TYPES` in the contract has
`fixture`, whose `name` is "Home v Away". `components/match-follow.tsx` is the
control. No new route, write or setting.



## D-117 — An achievement unlock is told once, the first time it is derived, and never taken back
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-946 makes an achievement (D-091) a notification (blueprint
12.2).

- **When.** After every rating recompute (after each settlement, and in the
  job's pass over recently settled members), the reputation boundary derives
  the member's achievements exactly as the profile does. It records each one
  it has not seen before in `achievement_unlocked`: the member, the kind, the
  stored time that earned it, and when it was first derived. For each new
  one it emits `achievement_unlocked`, keyed `achievement_unlocked:<member>:<kind>`,
  with the member as the subject. The notification opens their profile at
  the list (`/u/<username>#achievements`) and says "You earned an
  achievement."
- **Told once, and what was told is not lost.** A row is one per member and
  kind (the primary key), and a recomputation never deletes one. The plan's
  "only for achievements that cannot be lost" is read this way: the
  achievement on the profile stays derived and can still be withdrawn by a
  corrected settlement (D-091 is unchanged), but the unlock that was told is
  a fact that is kept. An achievement that a correction removes and a later
  settlement restores is therefore not told twice, and one lost and earned
  again later is not told again either. The notification is never withdrawn:
  it was true when it was sent.
- **Only when it is news.** An achievement first derived more than **three
  days** after the stored time that earned it is recorded with `told` false
  and no notification. That covers every achievement earned before T-946, on
  the job's first pass after the deploy (so there is no backfill and no
  flood), and one the job reached late.
- **The existing controls.** `achievement_unlocked` is a kind in the
  `football` category, on by default, and appears in the general list in
  Settings → Notifications ("When I earn an achievement (once each)"). The
  member's switch, the `football` category mute and quiet hours apply as they
  do to `prediction_settled`. A member who switched it off is still recorded,
  so switching it back on does not replay old unlocks.
- **A deleted member is never told.** The insert reads the account and
  records nothing for a tombstone (`status = 'deleted'`), so nothing is
  emitted.
- **Achievements still change nothing.** `achievement_unlocked` is read only
  by the job that writes it. The profile, the rating, the boards and
  eligibility read nothing new.

**At most once.** The row is written before the notification. If the write
of the notification then fails (`emit` never throws, and logs the fault),
that member is not told of that achievement. A second tell on a retry would
break the rule this decision exists for, and nothing depends on the
notification existing.

**Alternatives considered.** Storing achievements as rows and notifying on
insert: D-091 keeps them derived, and a stored copy would drift from the
settlements. Telling on every first appearance, without the record: a
correction that removes and restores would tell twice. Telling only the kinds
that no correction can remove (`competitions_5` alone): true to the letter of
the plan, but it would leave nine of ten achievements silent, and the
acceptance test for a removed-and-restored achievement would describe nothing.

**Consequences.** `1764880000000_achievement-unlocked.sql` widens the kind
lists and adds `achievement_unlocked`. The kind is in `NOTIFICATION_KINDS`,
`NOTIFICATION_DEFAULTS`, `NOTIFICATION_CATEGORY_OF` and `NOTIFICATION_TEXT`,
and `notificationPath` opens `#achievements`. No new route, write or setting.



## D-115 — The member's homepage: friends' calls under their own visibility, active group discussions, today's panels, and viewing in the member's territory

**Date:** 2026-09-29 · **Task:** T-942 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

Blueprint 2.3 asks the homepage for friends' recent predictions, active
private-group discussions, public match discussions from approved
contributors, and official viewing for relevant matches. Each needed a
judgement about whose activity, how recent, and who may see it.

**Friends' predictions: exactly a friend's own history visibility (D-063).**
`GET /me/friends/predictions` takes the viewer's accepted, active friends
(`SocialService.friendIds`), asks the profile boundary which of them this
viewer may read (`predictionHistoryAudience`, the same `canView` on
`prediction_history_visibility` as `GET /users/:username/predictions`), and
reads only those. A `public` or `friends` history is shown to a friend; a
`private` one never is; a stranger's never is, whatever their setting; the
viewer's own is not "a friend's". The pick is shown, before kick-off too,
because the friend's profile already shows it (D-063's recorded
consequence); only notifications withhold the pick (D-100). Each call is the
standing version with the **stored** settlement, never recomputed. "Recent"
is the latest version submitted in the last 7 days, newest first, at most 10.
`predictionHistoryAudience` now reads the viewer's friends once for the set
(`FriendshipOracle.friendIds`) instead of asking once per friends-only member,
so every caller of it -- the boards included -- asks one query, not N.

**Group discussions: the membership every conversation read already asks
(D-058).** `GET /me/group-discussions` is the viewer's group conversations and
match threads with a message in the last 48 hours, newest message first, at
most 5, as the same `ConversationSummary` `/me/conversations` answers. A muted
one is left out: a member who muted it asked not to be drawn to it.

**Today's panels: public, for everybody.** `GET /panels/latest?fixture=…`
(no session, up to 50 ids) answers, per known match, the panel state, total
and its newest three posts that still stand. Removed posts are left out of an
excerpt (a tombstone with nothing around it says nothing) while `total` still
counts them. The homepage asks it for the matches that kick off today in the
reader's zone and lists the three panels most recently written on. A guest
sees this section too: the panel is already public, and it is not a member
section.

**Viewing: the member's stored territory only (D-114).** The listed live and
upcoming matches carry the scores card's viewing line, from one
`GET /viewing?fixture=` for the list. A member with no territory is asked
once, not on every line. A guest's viewing is not asked for at all.

**What a reader is told.** A guest sees none of the member sections and is not
told they are empty. A member section with nothing in it says so once; one
that could not be loaded says that instead (rule 3). Friends' calls are
labelled as members' own and sit in their own section, never beside,
averaged with or relabelled as the model's forecast or the community
consensus (rule 6).

**Keeping the page fast.** Each section is one request for the whole page,
issued in parallel with the forecast and table requests, and each answer is a
fixed number of queries whatever the number of friends, groups or matches.
The T-808 budgets in `apps/web/perf-budgets.json` are unchanged (the budgeted
request is a guest's, which gains one panel request in the same parallel
round).

**No migration.** T-942 had none assigned and needed none.

**Alternatives considered.** One `/me/home` endpoint composing every section:
a module importing five boundaries' internals, and one payload holding a
member product beside the others. Showing a friend's call regardless of their
setting because the viewer is a friend: a second visibility rule, which D-063
exists to refuse. Showing removed posts as tombstones in the excerpt: honest on
the panel, noise on a homepage line.


## D-123 — Story types: blueprint 3.2's eleven, from the publisher's own category by an exact committed mapping or from an editor, never from a machine
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** A story's type (blueprint 3.2) is one of eleven:
`breaking_news`, `transfer`, `injury`, `suspension`, `tactical_analysis`,
`match_preview`, `match_report`, `interview`, `opinion`, `data_analysis`,
`explainer` -- the blueprint's list and nothing else (`STORY_TYPES` in
`@fmip/contracts`, the `story_label_type_known` check in the database, and a
spec that fails when the two differ).

- **Two origins.** `publisher`: the publisher's own category string on the
  story's promoted original, mapped by an exact, committed list (T-1002).
  `editor`: a person with the `editor` or `admin` role, with a reason, over
  `POST /admin/stories/:id/type` beside the debate mark (T-1001). The card and
  the story page carry `type: Covered<{ type, origin }>`, so a reader is told
  whose word it is.
- **No type is a stated absence.** A story with no current label is
  `not_supplied`; there is no default type and no "other". The story page
  says the story has none; a card carries no tag.
- **Superseded, never edited.** `story_label` rows take one change in their
  life, `superseded_at`, enforced by a trigger; a new label supersedes the
  current one in the same transaction; a partial unique index keeps one
  current label per story. There is no pointer to the replacing row, because
  a publisher's label goes with its article when a publisher is dropped
  (D-061) and a pointer would make the drop fail.
- **An editor's word wins.** An editor's label supersedes a publisher's, even
  of the same type, because the editor's origin is what keeps a later fetch
  from changing it (T-1002). The same editor label twice is refused rather
  than re-noted. Every editor label is an `audit_log` row (`story.type`,
  target `story`) with the label it replaced as `previous` (rule 10).
- **Never a machine (N-1).** No similarity, keyword or language-model rule
  assigns a type. A third origin is a new decision entry and a migration; the
  origin check, the contract's `STORY_LABEL_ORIGINS` and the web's total
  records over it fail the build until both exist.
- **"Breaking news" the type is not the breaking mark.** A publisher's
  "breaking" category or an editor's label types the story; only the
  editor's time-bound mark of D-125 puts it on the homepage strip.

**The publisher's category (T-1002).** The feed reader keeps each item's
category strings as carried (RSS `<category>` text, Atom `<category term>`,
in feed order, duplicates removed) in `article_category`, replaced by each
fetch so a category the publisher removed is gone. The committed list
`STORY_TYPE_MAPPING` maps (the source's feed host, the exact string) to a
type: no case folding, no trimming beyond the reader's whitespace, no prefix,
keyword or similarity rule. A story takes its promoted original's mapped
type; an item whose mapped categories name two different types has none
(choosing would be a guess); an original that no longer maps withdraws the
publisher label (superseded with nothing after it). The job recomputes the
label whenever an item's words or categories change, and never supersedes an
editor's label.

**The mapping ships empty.** Each entry must name a recorded item from its
feed that carries the exact string (`src/modules/news/_recorded/`, held by
`story-type-mapping.spec.ts`). Which publishers are carried is the
maintainer's (D-061, N-8) and is not in the repository, so no entry was
written from memory or by analogy. Adding one is a recording and a line; the
mechanism, the storage and the editor path work today.

**Alternatives considered.** A `story.type` column: no history, no author,
and an editor's correction would erase the publisher's word. A default type
("news") for unlabelled stories: a filter by type would then pretend to know
what the unlabelled half is. A type per article rather than per story: the
reader filters stories, and the promoted original is already the story's
voice (T-142).

## D-124 — News filters by story type, player and date, and what a filter says about the stories it cannot place
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** `GET /news` takes `type`, `player`, `from`, `to` and `tz`
beside the existing filters (blueprint 3.2), in every section, applied to the
whole cluster as the others are (a story matches when any of its reports
does).

- **Type.** One of `STORY_TYPES` (D-123), against the story's current label.
  A story with no type is never shown under a type filter and never counted
  as one; the answer's `untyped` says how many stories matching every other
  filter (the dates included) have no type, and the page says "N stories ...
  have no type, so they are not shown". Without a type filter `untyped` is
  `null`.
- **Player.** A person by id (rule 1), matched on the story's person links.
  Until any report links any person (T-1006 writes them), a player filter
  answers `not_supplied` with reason `persons_unlinked` rather than an empty
  list, because the list would be empty for want of linking, not of news.
  Once links exist an empty answer is an ordinary `no_match`. The news page
  shows an active player filter by name with a link to remove it; the way in
  is a player's own page (T-1007), since a picker over every player would be a
  second search box.
- **Dates.** `from` and `to` are calendar days (`YYYY-MM-DD`, both
  inclusive) in `tz`, an IANA zone (default `UTC`), compared with the story's
  first publication -- the earliest time its original's publisher gave, else
  when it was first read, the same instant the cards are ordered by. The web
  sends the member's own zone, and only with a date; a guest's days are UTC.
  A malformed day, an unknown zone or `from` after `to` is a 400 naming it.

**Alternatives considered.** Showing untyped stories under every type filter
("might be a transfer"): a filter that does not filter. Hiding the count:
the short list would pose as all the transfer news. A `player` filter that
answers an empty list before T-1006: indistinguishable from "no news about
him". Dates in UTC for everyone: a Tehran reader's "today" would drop its
first three and a half hours.

## D-125 — "Breaking": an editor's mark with a window, the homepage strip, and who is told
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** "Breaking" on the homepage (blueprint 2.3) is an editor's act,
never a publisher's word or a machine's (D-123, N-1).

- **The mark.** An `editor` or `admin` marks a story with a note readers see
  (`POST /admin/stories/:id/breaking`). The mark lasts
  `BREAKING_WINDOW_HOURS` (the proposal, **6 hours**) from the moment it is
  made; there is no per-mark window, so every strip entry means the same
  thing. An editor may end it early with a reason (`.../breaking/clear`).
  A second mark while one is in force is refused rather than re-noted; once
  a mark has ended, the story may be marked again. Every mark and clear is an
  `audit_log` row (`breaking.mark`, `breaking.clear`, target `story`) with
  what was there before (rule 10). `GET /admin/breaking` lists marks as
  `live`, `expired` or `cleared`.
- **The strip.** `GET /news/breaking` is public (a guest sees it): the
  stories whose mark is in force, newest mark first, at most
  `BREAKING_STRIP_LIMIT` (5). "In force" is `ends_at > now()` read at
  render, so an expired mark is gone at the next render with no job to take
  it down. With nothing marked the homepage draws no strip at all -- not an
  empty one (rule 3). A card carries `breaking` (the note and the window)
  wherever it appears, so the news page marks it too.
- **Not the type.** A story typed `breaking_news` by its publisher or an
  editor (D-123) is not on the strip unless an editor marks it: the type says
  what a story is, the mark says what is on the front page now.

- **Who is told (T-1005).** `breaking_news` is a notification kind, **off
  by default**: an interruption about news is something a member asks for,
  and the strip is there for everyone else. When a mark is made, the members
  who follow a team, competition or person any of the story's reports links,
  and whose switch is on, are told -- one audience query and one
  `emitToAudience` statement, as the match alerts are since T-835 (D-105), so
  the category mute (`football`), the team and competition mutes (a story is
  about every team and competition it links, through `notification_about`),
  quiet hours (delay, never drop) and the dedupe key apply exactly as to
  every kind. The kind has no hourly cap, like every kind but messages and
  reactions (T-273): marks are made by editors, by hand, a few a day. The
  dedupe key is the story, so a story marked, cleared and marked again is
  told **once**; a member who starts following in between is told at the next
  mark. A story that links nothing a member follows reaches nobody. The
  notification's subject is the story (`story`, a new subject) and opens the
  story page; its line is "Breaking: " and the editor's note, read from the
  mark rather than copied.

**Alternatives considered.** A flag on `story`: no author, no reason, no
window. A scheduled job that clears expired marks: an expired mark would stay
on the homepage until the job ran. Letting a publisher's "breaking" category
fill the strip: the homepage would be written by whichever feed labels most
generously. On by default: every member following a big club would be pushed
several times a day about stories they did not ask to be interrupted by.
Telling on every re-mark: a correction to a note would reach everybody
again.

## D-126 — Linking a person to a story: the rule, its precision on a sample, and what it never does
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-1006 lets the news clustering link a person (`article_entity`
type `person`, by UUID), by a rule narrower than the team linker's, and keeps
it switched off until its precision has been measured.

- **The rule.** A person is linked to an article when (1) one of the
  article's headlines or summaries carries their `full_name`, or an
  `entity_alias` recorded for them, as whole words after the same folding the
  team linker uses (`search_key`, every run of non-letters one space);
  (2) that key is at least two words and five letters -- a surname alone
  ("Salah", "Silva") never links, and `known_as` is not read, because the
  provider's short form is often exactly that; (3) the person holds an open
  `player_spell` at a team the story links (any report of the cluster); and
  (4) no other member of those squads answers to the same key, and no other
  matched candidate's key contains it or is contained by it ("Bruno Guimaraes"
  inside "Bruno Guimaraes Rodrigues"). A name that could be two people links
  neither (rule 1). The rule is `PERSON_CANDIDATES` in
  `news/internal/news-store.ts`, one SQL text read both by the writer and by
  the sample, so what is measured is what writes.
- **The bar.** The rule may write only when a person has hand-checked a random
  sample of stored headlines and found at least **95 %** of the proposed links
  right over at least **100** proposed links (`PERSON_LINK_PRECISION_BAR`,
  `PERSON_LINK_SAMPLE_MINIMUM`). A wrong link puts a story on a stranger's
  player page and in their followers' feed; a missed one costs a reader one
  story, so the bar is on precision, not recall.
- **The switch.** `NEWS_PERSON_LINKS=on` turns the writer on; anything else,
  and the default, leaves it off. The sample is
  `node dist/cli/person-link-sample.js [--size 300]`, read-only: one row per
  proposed link (article, person, matched words, headline, summary) for the
  checker to mark.

**Precision measured on 2026-09-29: none -- the sample is empty.** The public
site showed, as a guest, "The feeds have not been read yet" on `/news` and
"No squad on record for this team" on Arsenal's page: production has stored
no headline, and no `player_spell` row exists anywhere but the seed (nothing
ingests squads; D-119 found the same for coaching spells). A rule that needs
both can propose no link there, so there is nothing to check, and the switch
stays **off**. It may be turned on only after the feeds have run and squads
are stored, the sample has been checked, and the measured precision and the
sample's size have been added here.

**What it never does.** Link by surname, by `known_as`, by a person's name
outside the squads of the teams the story links, or by a machine's reading
of the words (N-1). It never links a coach or referee: spells are players'.

**Alternatives considered.** Matching `known_as` ("M. Salah", "Rodri"): the
provider's short form is a surname or a mononym as often as not, which is
the guess rule 1 forbids. Any person in the catalogue rather than the linked
teams' squads: common full names repeat across clubs. Turning the rule on
with a precision measured on invented headlines: a number about text nobody
published is not a measurement of this rule.

**Consequences.** `NEWS_PERSON_LINKS` in `.env.example`. The following
section already reads `person` links, so a followed player's stories appear
there once links exist. T-1003's player filter and T-1007's related news
read the same links and say `not_supplied` while there are none. No
migration: `article_entity` already accepts `person`.

## D-127 — A player's related news and current availability
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-1007 gives the player page (blueprint 5.3) related news and
current availability from what is already stored. No provider request is
added.

- **Related news.** `GET /players/:id/news` is D-119's entity-news shape
  (`EntityNewsResponse`, `ENTITY_NEWS_LIMIT` cards, newest first) over the
  stories any of whose reports link the person (D-126). It is `not_supplied`
  with `feeds_unread` until the feeds have been read, as on the team page.
  While no report links **any** person it is `not_supplied` with the new
  reason `persons_unlinked`: D-126 keeps the person linker off until its
  precision is measured, and an empty list then would read as "nobody wrote
  about this player". Once any person link exists, an empty list is
  `available` with `nothing_linked`. An unknown id is 404.
- **Availability.** `PlayerPage.availability` reads the player's team: every
  open spell's, else the team of the latest stored line-up that names the
  player (`basis: 'lineup'`, and the page says so). Nothing ingests squads
  today, so the line-up is what most players have. With several teams, the
  team whose next match comes first is used. Then it reads that team's next
  scheduled match still ahead, and what `fixture_absence` says about the
  player for it (T-103):
  - `not_supplied` with `no_team`, `no_next_match` or `not_asked`. The last
    one means no `fixture_availability_fetch` row exists for that match: the
    feed is asked only in the three days before kick-off, and an empty list
    nobody asked for is not information.
  - Once the feed was asked, `available` with `out` or `doubtful`, the kind
    and the feed's own words, or `not_listed`. It is never "fit", because the
    feed never says that (T-103). The status words are the key players'
    (`KeyPlayerAvailability`).
  - `last_updated_at` is when the feed was last asked. The page shows that
    time and says the answer may have changed once it is more than six hours
    old: T-103 re-asks every three hours, so six hours means at least one
    re-ask was missed (rule 4).

**Alternatives considered.** Reading only open spells: nothing writes them,
so every player page in production would say "no team". Calling a player
with no listing "available" or "fit": the feed does not say so. Answering an
empty news list before any person is linked: this would be a false negative
presented as fact (rule 3). Reusing `/news?team=`-style filters for the
person: T-1003 owns the `player` filter of the news page, and the entity
list needs the `persons_unlinked` state, which a filter does not have.

**Consequences.** `PlayerAvailability`, `PlayerAvailabilityListing`,
`PlayerAvailabilityReason` and `EntityNewsReason` are in the contract, and
`EntityNewsResponse.entity.type` takes `person`. Seventeen catalogue keys were
added (`player.availability.*`, `news.entity.nothingPlayer`,
`news.entity.personsUnlinked`). No migration.

## D-128 — Trending counts saves beside discussion
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** Trending (blueprint 3.1) ranks the stories that were discussed
or saved in the last `TRENDING_WINDOW_HOURS` (48) by two signals, each a count
of distinct members:

- **Discussion**: members who posted or reacted on the public panel of one of
  the story's matches, as before (T-143).
- **Saves** (T-1008): members whose `saved_article` row for the story was
  saved inside the window.

A story's score is `participants * 1 + savers * 1` (`TRENDING_WEIGHTS` in the
contract). Ties go to the newer story. A member who both discussed and saved
counts in both, because they are two different acts. The card carries both
counts (`discussion.participants`, `discussion.savers`), and the page shows
both. The section stays `limited`, now with the reason `discussion_and_saves`,
which says what is counted and that views and shares are not.

**Why equal weights.** There is nothing yet to calibrate them against:
production has no stored stories and no saves (D-126), and no measure of
"interest" exists to fit weights to. One member, one count per act is the
rule a reader can check from the numbers on the card. A different weighting
is a one-line change to the contract constant, together with this entry.

**What is not counted.** Views and shares. Counting who read or shared a
story is product analytics that D-044 and D-102 kept out, and whether to
count them is the maintainer's question N-3. A save is a row the product
already keeps for its own function (T-842). Trending reads only its count per
story, never who saved it: the saved list stays private (T-842).

**Merges.** When clustering moves an emptied story's saves onto the story it
joined (`moveToStory`, T-842), `saved_article`'s key (member, story) keeps one
row per member, with the time of the earlier save. A member who saved both
stories counts once, and a moved save counts in the window of its original
time.

**Budget.** The section is still two statements, the cards and their
entities, whatever the table holds. The saves are one grouped scan of
`saved_article` joined to the cards, inside the same statement. A spec seeds
10,000 saves and holds the section to those two statements and under 1.5 s on
the development database. No index or migration was needed: none was
assigned, and the scan is bounded by the table the spec measures.

**Alternatives considered.** Weighting a save above a panel post (or below
it): a preference with no evidence behind it. Counting every save ever made
rather than the window's: trending would then be "most saved", which never
decays. A separate "most saved" section: blueprint 3.1 names one trending
list built from several signals.

**Consequences.** `TRENDING_WEIGHTS`, `discussion.savers` and the
`discussion_and_saves` reason are in the contract, replacing
`discussion_only`. The plural `news.savers` and `news.reason.discussionAndSaves`
are catalogue keys. No migration.

## D-129 — News coverage per competition, stated rather than implied
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26; the floor is a proposal the maintainer may change)

**Decision.** Blueprint 3.2 asks for full coverage of the popular leagues,
continental competitions and national teams. Which competitions the carried
feeds actually cover is now a stated number (T-1010), not something a reader
infers from a short list:

- **What is counted.** For each competition, the carried sources (a
  `news_source` row with no `dropped_at`) with at least one report linked to
  the competition (`article_entity`, `entity_type = 'competition'`, by UUID)
  whose first publication (the earliest `article_version.published_at`) is
  inside the last `NEWS_COVERAGE_WINDOW_DAYS` (30) days; per source, the
  distinct stories it linked; and the distinct stories together, so a story
  two sources reported counts once. A team link does not count for the
  team's competition: "about this competition" is the competition link's
  claim, and the clustering already makes it (T-142).
- **The floor.** `NEWS_COVERAGE_FLOOR` = 5 stories in the window. Proposal:
  roughly one story a week plus one, the least a competition page's news can
  have before a reader is better told it is thin. A dropped source stops
  counting at once.
- **The competition page.** `GET /competitions/:id/news` carries `coverage`
  (the sources, the count, the window and the floor). Below the floor its
  stories are `limited` with reason `below_floor`; with no carried source in
  the window, `limited` with `no_carried_source`, said before any card, so an
  older story never reads as current coverage (rule 3). At or above the
  floor, `available` as before. Teams and players are unchanged.
- **The console.** `GET /admin/news/coverage` (editors and administrators)
  lists every active competition (`competition.is_active`) with its state,
  count and sources, the gaps first, with the number of carried sources and
  when a feed was last read. The console page `/admin/news-coverage` shows it.

**What it does not do.** It adds no source and proposes no publisher. Which
publishers to carry, under what terms, is the maintainer's (N-8); the report
names the gaps so that decision has the numbers.

**Alternatives considered.** A floor on distinct sources rather than
stories: one prolific publisher can cover a league well, and a count of
stories is what a reader of the module notices. Counting a story through a
linked team's current competition: it would count a transfer story about a
club as league news, and would guess where a club plays a cup. Counting the
fetch time rather than the publication time: a newly carried feed's
back-catalogue would read as this month's coverage.

**Consequences.** `NEWS_COVERAGE_WINDOW_DAYS`, `NEWS_COVERAGE_FLOOR`,
`CompetitionNewsCoverage`, `NewsCoverageReport`, `newsCoverageState` and the
reasons `below_floor` and `no_carried_source` are in the contract. The plurals
`news.entity.belowFloor` and `news.entity.noCarriedSource` are catalogue keys.
Production carries no source today, so every active competition is a gap
until the maintainer answers N-8. No migration.

## D-130 — The glossary is the translators' file per locale; translation memory is a named person's earlier reviewed words, suggested and never filled in

**Date:** 2026-09-29 · **Task:** T-1011, T-1014 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

**Decision.** The shared football glossary is one JSON file per locale in
the catalogue's shape (D-066): `packages/contracts/glossary/en.json` holds
the English terms, each keyed by a stable id -- `term.<slug>` for a football
word, `team.<uuid>`, `competition.<uuid>` or `person.<uuid>` for a name --
with a `locked` flag; `glossary/<locale>.json` carries every key as
`{ source, locked, text, status, note? }`, where `text` is the target term a
person wrote and `status` is `untranslated`, `translated` or `reviewed` as a
person set it. `i18n:glossary` (`apps/web/scripts/i18n-glossary.mjs`) keeps
the files in step and `--check` runs in CI.

**The script never writes a target term.** The plan's rule (Phase 10, "the
translators' words are theirs"): the English side may be generated, and it
is -- every word of a committed English `VOCABULARY` that the catalogue's
`en.json` uses as a whole word, plus entity names from an export -- while
everything in another language is a person's. A new term arrives as
`untranslated` with an empty `text`; `text`, `status` and `note` are kept
exactly as the translator left them; a term the catalogue stopped using is
dropped only when no locale carries words for it, and otherwise the script
refuses and names it. A term with words and no status, or a status its text
does not support, fails the check, and a refresh writes nothing while
anything is wrong, so a problem is never normalised into the file.

**Locked.** A locked term must appear in a translation exactly as the
glossary gives it, wherever its English appears in the source (T-1012
enforces it). A name is always locked; a football word is not until a person
sets `"locked": true` on it in `en.json`, which the script keeps. A locked
term with no target term yet locks nothing -- there is nothing to compare
against, and the check says so rather than passing or failing.

**Names come from an export, and are only ever added.** `--entities <file>`
reads `[{ "type", "id", "name" }]`. The export is whatever someone chose to
export, so a name missing from it is not a name to drop. To export the
competitions and the teams that play in them, against any database:

```sql
\copy (SELECT json_agg(e) FROM (
  SELECT 'competition' AS type, id, name FROM competition
  UNION ALL SELECT 'team', id, name FROM team) e) TO 'names.json'
```

No names are committed with this task: the files hold only the catalogue's
football words until an export is run, and no agent runs one against
production.

**Why in `packages/contracts` and not beside the catalogues.** The plan said
"beside the catalogues". The API's review endpoint enforces the locked terms
(T-1012), and the API image carries `@fmip/contracts` but not `apps/web`; a
copy in each, or a Dockerfile step copying a web folder into the API image,
would be two sources of one list. The package ships the folder
(`files`, and `exports` `./glossary/*.json`) and each side reads it as
`@fmip/contracts/glossary/<locale>.json`. The files are not imported by the
package's index, so no browser bundle carries them.

**Why a committed vocabulary and not "every noun in the catalogue".** A
glossary of "Home", "Settings" and "Sign in" is a second catalogue. The
football words a translator must render the same way every time are a short,
reviewable list; the catalogue decides which of them are live.

**Alternatives considered.** A translation platform's glossary (an account,
§7, and D-066's argument). Keys by English term (rule 1 for names, and a
football word whose English changes would become a new term, orphaning the
translation). Filling a target term from a localised name already in
`entity_alias`: a script writing a word in another language, which this
decision exists to refuse; the review check reads both sources instead.

**Translation memory (T-1014).** For each field of the source, the desk
lists the reviewed translations into the same language of *another*
article whose publisher's version carries **exactly** the same string in
the same field -- no fuzzy match, no normalisation, because a near match is
a different sentence and offering it as memory would be a guess. Each entry
names who wrote it and who reviewed it, and when: memory is a named
person's earlier words, not the product's. Only `reviewed` versions are
memory; a translation a second speaker has not read is not yet anyone's
settled word. When a later version of that translation carries different
words for the field, the entry shows that correction beside itself, with
its author and whether it is reviewed yet, rather than hiding either.

**Suggested, never filled in.** The desk shows memory beside the field
with a "copy" control; the field starts empty (or with this article's own
newest translation) and receives remembered words only when the translator
presses it, after which they are the translator's to edit and save like
their own. The API only reads (`TRANSLATION_MEMORY_LIMIT` entries per field,
newest first); nothing writes a memory entry, because memory is the stored
versions themselves. Rejected: filling the field on load (the plan's rule:
nothing from memory without a person choosing it) and a separate memory
table (a second copy of the versions, stale on the first correction).

## D-131 — The automatic translation checks, and a reviewer's recorded reason to pass one

**Date:** 2026-09-29 · **Task:** T-1012 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

**Decision.** `checkTranslation(source, target, context)` in
`@fmip/contracts` is a pure function over the publisher's newest version and
a person's translation. For each field either carries (headline, summary,
byline) it returns one result per check -- `pass`, `fail` or `not_checked`,
with what it expected, what it found and one sentence:

- **empty**: a field the source has is not left empty, and a field it lacks
  is not added (the rights guard, PL016, refuses more than the source grants
  anyway).
- **numbers**: the same numbers as a multiset, compared as numbers: Latin,
  Arabic-Indic (U+0660) and Persian (U+06F0) digits and the Arabic decimal
  and thousands separators are one set of digits; `1,500` and `1.500` are a
  thousand and a half, `2,5` and `2.5` two and a half, `09` is 9.
- **scorelines**: the same `a-b` pairs (`-`, `–`, `—` or `:`), in order, so a
  score written the other way round fails though every number is there.
- **dates**: numeric dates with a year (`2026-09-29`, `29/09/2026`,
  `29.09.2026`) and a day beside a month's name, the target's names taken
  from `Intl` for its language (long and short, standalone and in a date) with
  the English ones beside them; matched on day and month, and on the year
  when both give one. Dates are taken out of the text before numbers and
  scorelines are read, so a date reformatted is not three numbers of which
  one went missing.
- **names**: every entity the article links (`article_entity`: team,
  competition, person), found in the source by its canonical name, the name
  it is known by or an alias in the source's language, must appear in the
  translation as its localised name (T-303, `localised_name`) or its glossary
  term (T-1011); every locked glossary term likewise. A name nobody has
  written in the target language -- no localised name, no glossary term --
  is `not_checked`, said as such, never a pass.
- **links**: the same URLs.
- **markup**: the same tags and entities.

**A check never rewrites the text.** It returns a verdict and nothing else;
there is no "fix" and no suggestion (D-066: the words are the translator's).

**The review refuses a failing check unless the reviewer records a reason.**
`POST .../translations/:language/review` recomputes the checks on the
version being reviewed. Any `fail` without a matching `overrides` entry
(`{ check, field, reason }`) refuses the review with a 400 that lists every
failure in `checks` and in `fields` keyed `<field>.<check>`. A reason given
for a check that does not fail is refused too: a record of passing something
that never failed is noise. Each override is a `translation_check_override`
row (migration `1764940000000`) against the exact version read, naming the
reviewer, the check, the field and the reason, and an `audit_log` row
(`translation.check_override`, previous the failure and its sentence) in the
same transaction as the review. The row is immutable and goes only with its
article; the schema refuses one on the publisher's own words. A new version
is checked from nothing, because it is different words.

**Where the function lives.** `@fmip/contracts/translation-checks`, a subpath
of its own: the index exports only the types. The web's client bundles load
the contracts index whole (it is CommonJS), and the checks in it pushed two
pages over T-808's first-load budgets.

**`not_checked` does not block.** Blocking on it would make every name
nobody has localised yet a reason to refuse every review; the desk (T-1013)
shows it beside the field so the reviewer reads it.

**Why these checks and no more.** Each is a fact about the text that
survives translation unchanged -- a number, a score, a date, a URL, a tag, a
name as recorded -- and so can be compared without understanding either
language. Anything past that (tone, meaning, a mistranslated verb) is the
second fluent speaker's job, which is what review is.

**Known limits, accepted.** A number written as a word ("two") on one side
and as digits on the other fails `numbers`; a time `20:45` reads as a
scoreline on both sides and so passes; a month name a language spells
several ways (Levantine Arabic's month names beside `Intl`'s) fails `dates`.
Each is what the reason exists for.

**Alternatives considered.** Storing each check's result: a cache of a pure
function of stored rows, which goes stale the day the glossary changes.
Blocking the write instead of the review: the plan puts the gate at review,
and a translator saving work in progress should not be told to finish it
first. A reviewer override without a reason: the whole point is that
somebody can later read why.

## D-132 — Who may invite to a group is the owner's choice of three, applied by the schema; invite links store only a hash

**Date:** 2026-09-29 · **Tasks:** T-1020, T-1021 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

Blueprint 8.2 lets a group's owner decide who may invite, and asks for invite
links. T-241 let the owner and the moderators invite and nobody else.

**Three policies, a closed list: `owner`, `owner_and_moderators`, `members`.**
`user_group.invite_policy` is a check over those three. The default is
`owner_and_moderators` because that is what every group already did: an
existing group keeps today's behaviour, and the migration needs no backfill.
Only the owner changes it (`PUT /groups/:slug/invite-policy`); a moderator
runs a group but does not decide who opens its door.

**The schema applies it, like every other membership rule (D-057).**
`group_may_invite(group, member)` is the one question, and
`group_invite_a_policy_guard` refuses an invitation it does not allow
(`PL006`, hint `invite_policy`). The trigger fires before the existing guard
and the hourly ceiling, so somebody who may not invite at all is told that,
and a refused attempt is not counted. The API lets anybody inside the group
try, and turns the refusal into the policy in words ("Only this group's owner
invites people to it.") with a 403. A stranger is still 403, or 404 for an
invite-only group, before the database is asked.

**A change is audited in the group's history.** The new value and its
`audit_log` row (`user_group.invite_policy`, the owner, the policy before and
after) are one transaction; setting the policy it already has writes nothing.
`GET /groups/:slug/history` reads the audit rows whose target is the group,
newest first, for its owner and moderators. The reason recorded is a fixed
sentence naming the owner's setting: it is the owner's own group, not an
administrator's action, so nobody is asked to justify it.

**Withdrawing follows inviting.** The owner and the moderators withdraw any
invitation; a member a `members` policy lets invite withdraws only one they
sent.

**Invite links (T-1021).** Whoever the policy lets invite makes one, with
an expiry (1 hour to 30 days, a week by default) and a use cap (1 to 500, 25
by default), and a verified e-mail, as a direct invitation needs. The token is
256 random bits, answered once when the link is made; the database keeps only
its SHA-256, so a dump or a backup cannot be followed. The maker revokes their
own link; the owner and the moderators any. Making links has a ceiling
(`group_invite_link`, 20 an hour, a trigger), and the guard on making one
repeats the policy (PL006) and a contact sanction (PL004).

**Following a link is one database function**, `group_invite_link_follow`,
under one row lock, so two people cannot both take the last use. It answers,
in order: revoked, expired, used up, or *orphaned* -- the maker may no longer
invite (they left, were demoted, or the policy changed), because the policy
applies when a link is followed as well as when it was made. A dead link says
which with a 410, **except that an invite-only group behind a dead link is
404**, the same as the group itself: a dead link no longer invites, so it no
longer shows the group. A block between the maker and the follower, or the
maker's contact sanction, is "not available" and never says which; the
follower's `groups` sanction is refused by the membership's own guard.
**A public or invite-only group is joined; a discoverable group gets a join
request**, because that visibility is joined by request (D-057) and a link
does not change who decides; its owner and moderators are told as for any
request. A use is counted only when a membership or a new request was made.
Following needs a session; the preview (`GET /group-invite-links/:token`)
shows the group only for a live link or a findable group. The web page is
`/{locale}/group-invite/{token}`, never indexed and sent with `no-referrer`.
Following has no ceiling of its own: each link is bounded by its cap, whose
making is limited, a token cannot be guessed, and a request filed this way is
counted by the join-request ceiling.

**Alternatives considered.** A boolean "members may invite": loses the
owner-only case the blueprint's "owner-controlled" implies. Deciding the
policy in the service: a second copy of a membership rule, which D-057
refuses. Asking the owner for a reason on every change: rule 10 is about
administrators' high-impact actions; an owner's setting on their own group
is recorded with who and when, which is what the history needs.

## D-133 — A group's language is a tag for markup and a filter, its favourite is one club or competition by id, and its rules are its own, versioned

**Date:** 2026-09-29 · **Tasks:** T-1022, T-1023 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

Blueprint 8.2 asks for a group's preferred language, a favourite club or
competition, and membership rules.

**The language is a BCP 47 tag, for markup and for the directory.**
`user_group.language` has the same shape check as a member's preferred
language, and any tag is allowed, not only the site's own languages: a group
may write in a language the product is not translated into. It is used for
two things only: the `lang` attribute on what the group's members wrote (the
name, the description, each message body -- never the site's words around
them, which stay in the reader's language), and the directory's filter.
**Nothing is machine-translated** (13.2, D-061); the tag says what the words
are, it does not change them. The directory's language select offers the
site's languages, as the news filter does; the API takes any tag.

**A favourite is one club or one competition, by id (rule 1).** Two nullable
foreign keys and a check that at most one is set: a group about a club and a
competition at once is two groups. `ON DELETE SET NULL`, because a catalogue
row merged away should leave the group without a favourite, not remove the
group. The API takes `{ type, id }` and answers `{ type, id, name }`; the name
is only what a reader sees. The directory filters by `team` or `competition`
and names what it filtered by, from the id. **A group with neither says
nothing**: no "none", no empty label. A value in the directory's query that
cannot be a filter is left out rather than refused, the way the scores filters
read theirs. Whoever may change the group's name (the owner and moderators)
may change these, as a group setting.

**A group's rules are the owner's written text, versioned (T-1023).** Only
the owner writes them (a moderator runs the group; what a member accepts is
the owner's). Each change is the next version, numbered by the database;
nothing is edited in place, so the words a member accepted are always the
words they read. Every version is audited in the group's history
(`user_group.rules`). The rules are shown to whoever may see the group --
a stranger to a public or discoverable group, an invitee, the holder of a
live invite link -- because a member reads them **before** joining.

**Joining without accepting the current version is refused, by the schema.**
Every way in carries the version the member ticked to accept: joining a
public group, asking to join a discoverable one, accepting an invitation and
following an invite link. The API refuses a missing or an out-of-date version
with a sentence that says which (409); the database refuses a membership or a
request with none (`PL006`, hint `rules`), whatever the caller. A request
records what its asker accepted, and letting them in records that version.
The owner's own row at creation is exempt, since a group has no rules until
its owner writes them.

**A new version is shown once to existing members; nobody is removed for not
accepting it.** `rules_seen_version` records the newest version a member has
been shown; the page shows a newer one, with the text, until the member says
they have read it (`POST /groups/:slug/rules/seen`). Their membership does not
change either way. **The text is the group's, not the platform's, and says
so**: the page names it as the owner's rules beside the platform rules every
member accepted at registration (D-059), never instead of them.

Criteria that decide entry (a minimum rating, a country, an account age) and
an administrator role between owner and moderator are not built: N-6 is the
maintainer's.

**Alternatives considered.** Restricting the language to the site's locales:
a Persian-speaking group on an English site is exactly the case, and a
closed list would make it lie. Storing a favourite by name: rule 1. Several
favourites: no blueprint case, and a filter over a list is a different
query for a problem nobody has.

## D-134 — A group's owner and moderators remove messages in the group's conversations, with a reason the author is told, audited with the message as it was

**Date:** 2026-09-29 · **Task:** T-1024 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

The schema has allowed a message to be removed as `moderator` since T-220,
but nothing let a group's owner or moderator do it. Blueprint 8.2 gives a
group's owner and moderators the running of it.

**Who: the owner and the group's moderators, in the group's own
conversations.** The group's conversation and each of its match threads; a
direct conversation has nobody who runs it and is refused. The role is read
from `group_member` when the removal is made, so a demoted moderator loses
the power at once. **A group moderator cannot remove the owner's messages**
(403, saying so); the owner can remove anybody's. Removing one's own message
stays the author's own route (T-224). The platform's moderators keep exactly
the powers T-212 gave them: this is the group's moderation, not the
platform's, and it neither widens nor replaces the queue.

**How: a tombstone, a reason, and an audit row.** The message keeps its place
in the conversation with `removed_kind = 'moderator'` -- the same tombstone a
platform moderator leaves, so a reader sees that a moderator took it down, not
which one. The reason (1-500 characters) is required. The tombstone and an
`audit_log` row (`message.remove`, target the message) holding the actor, the
reason and **the message as it was** -- body, shared card, author, sequence,
conversation and group -- are written in one transaction (rule 10). The body
leaves the message row; the audit row is where it can still be read by the
people accountable for reading it.

**The author is told why, and nobody else is.** The reason travels on the
tombstone to the message's author only (`Message.removed.reason`, read from
the audit row); every other reader sees only that a moderator removed it.
There is no notification: a new notification kind is a migration this task
was not given, and the plan assigned T-1024 none. The author meets the reason
where the message was. If a notification is wanted, it needs its own
migration number (a `group_message_removed` kind and its preference); that is
recorded as open rather than taken.

**Alternatives considered.** Reusing the `moderation_decision` notification:
it says a decision was made about the member's account, which a group
moderator's removal is not, and it would blur the group's moderation into the
platform's. Showing the reason to the whole group: it would turn a removal
into a public reprimand. Letting a moderator remove the owner's messages: the
acceptance criterion refuses it, and the owner is who a moderator answers to.

## D-135 — Administrators close, reopen and clear a group as moderation decisions about the group; a closed group is read-only, out of sight, says why, and can be appealed

**Date:** 2026-09-29 · **Task:** T-1025 · **Status:** accepted (revisable under the standing delegation of 2026-09-26)

Blueprint 10.4 lets administrators close groups and remove content. Until
now a group could not be reported through the API (the contract listed
members only) and a decision could only be about a member.

**Who: the moderation team.** `moderator` or `admin`, the same gate as the
rest of the queue (T-212): closing a group is moderation, and the moderator
role exists for it. Every decision needs a reason, checked before anything
else.

**Four decisions about a group, each a `moderation_decision` with subject
`group`:** close (`group_closed`), reopen (`group_reopened`), remove content
(`content_removed`) and judge the reports groundless (`no_action`). Each is
one transaction: the decision, what it changes, the open reports about that
group it answers, and an `audit_log` row naming the actor, the reason and the
**previous state** (whether it was closed and why; for a removal, every
removed message and the description as they were). The audit target is the
group, so the group's owner and moderators see it in the group's history
(T-1020) as well.

**Removing content** is tombstoning named messages of the group's own
conversations (its room and its match threads) with `removed_kind =
'moderator'`, and/or clearing its description. From the web, the moderation
page offers the description; messages are removed by id through the API.
**Whether platform moderators may read a private group's conversation to
find what to remove is not decided here** -- that is a privacy question the
blueprint does not settle, so no page shows a group's messages to a
moderator who is not in it.

**A closed group is read-only to its members, and the schema says so.**
`refuse_write_in_closed_group()` refuses every insert into a group's
surfaces -- a member, an invitation, a request, an invite link, a rules
version, a poll or a vote, a thread, a message, a reaction, a pin (`PL021`).
Updates and deletes are left to the ways out: leaving, an account's deletion
handing ownership on, a tombstone. The API also refuses the owner's and
moderators' settings changes, deleting the group (the closure and its appeal
stand on it) and the group moderators' own removals: what is taken out of a
closed group is the administrators' to take. **Members can still read it and
leave it**; nobody is removed.

**Out of the directory and search, and it says why.** A closed group is left
out of `GET /groups` and the community search. Its page -- still open to its
members, and to anyone who could see it before -- shows the reason the
moderator gave. Reopening takes a reason too, and restores everything as it
was.

**The owner can appeal.** T-211's appeal notes, which belonged to a sanction,
may now belong to a decision instead (exactly one of the two). The owner of a
closed group writes notes on the decision that closed it
(`/groups/:slug/closure/appeal`); the moderation page shows them. The owner
is not notified of the closure by a notification: a new kind would need its
own migration and the page already says it; recorded as open.

**Alternatives considered.** A sanction on the owner instead of a closure:
it restricts a person, and the harm is the group. Deleting a closed group:
destroys the record an appeal needs. Hiding a closed group from its own
members: the criterion says they can read their own history.


## D-136 — A panel post links to one incident, player, prediction or statistic of its own match
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26)

**Decision.** T-1030 lets a contributor attach **at most one** link to a panel
post (blueprint 10.2): an incident of the match, a player in either line-up,
their own prediction on the match, or a team statistic of the match. It is
rendered as a card beside the post.

- **Where it lives.** Columns on `panel_post` (migration `1765000000000`):
  `link_kind` and one target column per kind, with a CHECK that a row carries
  either no link or exactly one kind's columns. Written with the post in the
  same INSERT; never changed afterwards (`refuse_panel_link_rewrite`, `PL007`,
  the tombstone included).
- **The schema refuses another match.** `panel_post_with_link_guard` (named to
  run last of the BEFORE INSERT guards, so a member who may not post at all
  hears that first) checks the target belongs to the post's fixture and raises
  `PL020` with the kind in the HINT; the API answers 400 with a sentence per
  kind. A statistic the feed has not supplied is refused too: a card for a
  number nobody has would invent one (rule 3).
- **Changed or removed by the feed.** An incident is linked by id **without a
  foreign key**, and the trigger stores what it said (`link_snapshot`). On read
  the card is `as_linked`, `changed` (shown as the feed has it now, with a note
  saying it changed) or `removed` (nothing of the old incident is shown). A
  statistic keeps its value at posting beside its value now; a player the feed
  later dropped from both line-ups is said to be so.
- **A prediction is the author's own, and only as visible as they make it.**
  The link is the `prediction_version` in force when the post was written,
  chosen by the trigger from the author's own call on this match (the client
  names no id). The public panel is the same bytes for everybody, so it shows
  the call only when the author's `prediction_history_visibility` shows it to a
  guest; otherwise the card is `withheld` and names the setting. A viewer the
  setting admits (the author, a friend under `friends`) receives the call on
  `PanelPermission.linked_predictions`, asked of the profile boundary exactly as
  D-063 asks it. A later revision does not rewrite the card; it says the call
  was changed after posting. Rule 6: the card is labelled as the member's own
  call, never the model's or the community's.
- **A removed post shows no card**, as it shows no body.

**Rejected.** *A link table*: "at most one" would be a unique index plus a
promise, and a post could exist for a moment without its link. *A foreign key
to `incident`*: RESTRICT would block the feed, SET NULL would blank the link
through an UPDATE the rewrite guard refuses and lose the fact that something
was linked. *Showing a withheld prediction to friends on the public document*:
it would make the public read viewer-specific. *Player statistics as a fifth
kind*: the task names a statistic of the match; a player card already leads to
the player's numbers.

## D-137 — A contributor below the threshold for a sustained period is flagged to administrators, never paused
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26). **The period is a proposal (N-7): the maintainer's to confirm or change.**

**Decision.** T-1031 implements blueprint 9.4's "a contributor below the
threshold for a sustained period" as a flag for a person, never an automatic
pause.

- **Below what.** The contributor rating threshold of D-059
  (`ELIGIBILITY_V1.minRating`, 70), read from its one home. Not a tier.
- **For how long: 30 consecutive days, as a proposal.** The number is one
  named constant, `CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS = 30` in
  `apps/api/src/modules/reputation/internal/contributor-flag.ts`, and the
  environment variable `CONTRIBUTOR_FLAG_PERIOD_DAYS` overrides it (a whole
  number from 1 to 365; empty or malformed falls back to 30). **Choosing the
  period is policy, like the thresholds themselves (D-059): the maintainer
  confirms 30 or sets another number, and changing it needs no code change.**
  Each flag records the period it was raised under.
- **How "below for the period" is decided, from stored ratings only (rule
  8).** The stretch is the unbroken run of stored ratings (`rating_snapshot`)
  below the threshold that ends with the newest one; it began at the first of
  them. A member with no rating is not below. It is counted from the later of
  its start and the grant, since before the grant the member was not a
  contributor. Only live, unpaused grants are checked.
- **One flag per stretch, told once.** A daily check (04:20 UTC, in the API
  with `INGESTION_SCHEDULE=on`) raises one `contributor_flag` per stretch
  (unique on member and `below_since`). Each new flag tells every
  administrator once, as `contributor_below_threshold`. The notification is
  administrators-only, on by default, and opens the contributors page.
- **Nothing is paused.** The check has no path to a grant event. On the
  console's contributors page (moderator or administrator, the same approvers
  as the rest of the page), a person either pauses with the existing audited
  act (T-250) or dismisses the flag with a required reason. The dismissal is
  written with an `audit_log` row naming the actor, the reason and the
  previous state (rule 10).
- **Closing.** A member back at or above the threshold closes the flag as
  `recovered`. So does a newer stretch replacing the one the flag named, and
  the newer stretch gets its own flag when it is due. A grant a person paused
  or withdrew closes it as `grant_not_live`. A dismissed stretch is not raised
  again; a later stretch is. A flag is closed once and never edited.

**Rejected.** *Pausing automatically*: it is the arithmetic-for-judgement
swap blueprint 10.2 keeps out, and a pause is something the member is told
with a reason a person gave. *A tier as the line*: tiers are display bands;
the contributor threshold is the number contributors were admitted against.
*Counting calendar days of snapshots*: a snapshot is stored only when the
inputs change, so an unchanged low rating has one old snapshot, and the
stretch began with it. *A flag per day while below*: noise; one per stretch
is what an administrator can act on.


## D-138 — The message catalogues stay on the server; a client component is handed messages already resolved for the reader's locale
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26). **Number taken as the next free one after D-137: the Phase 10 plan assigned none to T-1040.**

**Decision.** T-1040 keeps `apps/web/src/i18n/messages.ts`, which imports
all eight catalogues, out of every client bundle.

- **Resolved on the server, handed down.** `resolveMessages(locale, keys)`
  answers each key exactly as `message()` does: the locale's translation, or
  the English with `status: 'untranslated'`. A client component receives that
  result -- as a prop from a server component, or from
  `ClientMessagesProvider`, which the locale layout fills with
  `ERROR_PAGE_KEYS` for the reader's locale -- and renders it with
  `MessageText`, the one place the fallback marking (`lang="en"`, `dir`,
  `data-translation`) lives. `Translated` renders through it too, so the
  marking cannot differ between server and client. The client gets only the
  reader's locale, only the keys it renders, and English only where that
  locale has none.
- **The language picker** is handed `offeredLanguages()` (locale and
  autonym) by the header; it makes the links from the pathname with
  `lib/language-switch.ts`, which imports no catalogue.
- **`global-error.tsx`** replaces the layout, provider and all, so it loads
  the catalogue module with a dynamic `import()` and `use()`: a chunk only a
  failed layout fetches, never first-load.
- **Held by a spec.** `src/i18n/client-catalogues.spec.ts` fails when any
  `'use client'` module reaches `messages.ts` or a catalogue file by static
  import, naming the chain.

The missing-string policy (T-151) is unchanged: nothing is translated by
machine, and an untranslated string is still English and visibly marked.
First-load JavaScript fell by about 72 kB gzip on every route (home 222.4 to
149.8 kB), and the page budgets were lowered to match (docs/08-load-test.md).

**Rejected.** *Shipping the whole viewer's catalogue to the client* through a
provider: the only client components that render catalogue strings are the
error pages and the picker, so it would put some thirty kilobytes of words in
every page's payload for six keys. *Loading the locale's catalogue with a
dynamic import in every client component*: the first render would be English
until it arrived, the silent fallback the policy forbids. *A generated
per-locale subset file*: a second copy of the catalogues to keep in step, for
one rarely rendered page.

---

## D-139 — An input passes its backtest only by beating the current candidate on the same matches, with an interval that excludes zero
**Status:** Accepted · 2026-09-29 (revisable under the standing delegation of 2026-09-26) · **Task:** T-1101 · **Follows:** D-016, D-031, D-082, D-083, D-111

**The problem.** Phase 11 tests up to seven model inputs (rest and
congestion, league stakes, second legs, neutral grounds, a new coach,
head-to-head, home advantage by team). Blueprint 6.3 admits an input only
"where they improve prediction quality". Without a bar stated before any of
them is run, each input would be judged by numbers chosen after seeing its
own, and a small improvement on one window would be indistinguishable from
noise.

**The decision.** One harness, `python -m fmip_model.backtest.inputs --input
<name> --divisions … --from … --to …` (T-1101), and this bar, fixed in code as
`BAR` in `fmip_model/backtest/inputs.py`:

- **Against which versions.** Per division, one walk-forward with the fit
  dates of `backtest.elo_prior` (fit the day before, refit at most weekly, 60
  matches of history first) scores the published version
  (`dixon-coles-elo@0.1.0`, with its Club Elo prior as last cached), the
  current candidate (its own constants and prior), and the candidate *with
  the input* -- the candidate's very fits plus the input's term fitted on the
  same history. The input is judged against the **candidate**; the published
  version is reported for reference only.
- **On which matches.** Only matches all three forecast, and of those only
  the ones where the input can be read (N-5's proposal, adopted): a match
  where the input has no value is forecast by the candidate unchanged and is
  not in the sample. The report states the share of matches that is. The
  input never sees a match on or after the day it forecasts, nor, when its
  term is fitted, a match after the fit date.
- **Separately.** football-data.co.uk divisions and our records' divisions
  (by the source of their loads, D-083) are judged as two groups.
- **By how much.** In a group, with at least **300** matches where the input
  was read (below that: `insufficient`, never a pass):
  1. mean log loss lower than the candidate's, and the 95% paired bootstrap
     interval of the difference (2,000 resamples of the matches, seed 1101)
     entirely below zero;
  2. calibration error (the ten-bin expected calibration error, mean over
     home, draw and away) not worse: fails only if the same resamples put the
     whole interval of its rise above zero -- a few hundred matches make a
     point estimate too noisy to ask it not to move at all;
  3. worse (higher log loss) in no more than **one third** of the divisions
     with at least 50 matches where the input was read.
- **Overall.** `passed` when at least one group passed and none failed; a
  group that is `insufficient` is stated beside the verdict. The report
  (`reports/<candidate>/inputs_<name>_<window>.{md,json}`) carries the bar
  itself, so a later change to it is visible in the evidence.

A passed input is a candidate for T-1150's next version, nothing more: no
input reaches a published forecast except through a promotion with its own
decision entry (D-082). An input that fails is recorded with its numbers in
its own entry and carried by no candidate.

**The interface.** An input is a module `fmip_model/inputs/<name>.py` with
`build(context) -> ModelInput`; `ModelInput.fit(division, history, fit_date,
model) -> Term` and `Term.shift(match, known) -> (home, away) | None` (the
change to log expected goals). `FeatureInput` is the short path for a feature
pair and fitted coefficients (time-weighted Poisson likelihood with the
fitted model's expected goals as offsets, as D-086's line-up term). The
harness's own control, `--input null` (a coinflip with no effect), must fail.

**Rejected.** *Beating the published version*: the candidate is already
better (D-111), so an input could pass on the candidate's merit. *A point
estimate with a margin*: a fixed margin is either too strict for a small
input or too loose for a noisy window; the interval is what says "not noise".
*Every match, input or not*: dilutes the effect by the share where it is not
read, and punishes an input for matches it never touched. *A pooled number
across football-data and our records*: the two differ in size by an order of
magnitude, so the larger would decide alone.
