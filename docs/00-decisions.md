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
