# What only the maintainer can do

**Why this file exists.** An agent session can write, test, review and merge, but
there are things it must not do: create an account, spend money, hold a secret,
touch a physical device, or make a judgement the blueprint does not already
contain (`CLAUDE.md` §7). Those things are listed here, in the order in which
they unblock work, so that the list is a document rather than something
reconstructed from memory at the start of each session.

Each entry says what it is, **why it is yours and not an agent's**, what it
unblocks, and how to know it worked.

---

## Done

| | | When |
|---|---|---|
| The six policy defaults | Thresholds, the conduct ladder, how a grant ends, the two rules versions (`13-policy.md` §1–§5, D-059) | 2026-09-15 |
| The two member-facing texts | The platform rules and the contributor rules — the words a member accepts (`13-policy.md` §4, §5) | 2026-09-15 |
| The news licence question | Free publisher feeds, rights carried per source rather than assumed (D-061) | 2026-09-15 |

These were judgements, not tasks: what a platform asks of its members is not
derivable from the code, and an agent that picked them would have been inventing
product.

---

## 1. The Koyeb preview (T-086) — open

**Why yours.** It needs an account, and it needs two secret values. No session
creates an account, and no session handles a secret.

**What it unblocks.** A stable public HTTPS address that carries the live scores
stream — which the T-085 tunnel could not — so the live path can be exercised in
public before there is a server.

Full runbook: `docs/11-koyeb.md`. In short:

```bash
koyeb login
koyeb secrets create fmip-database-url     # prompts; the Postgres connection string
koyeb secrets create fmip-session-secret   # prompts; 32+ random bytes
bash deploy/koyeb/deploy.sh create
bash deploy/koyeb/deploy.sh status
```

Then tell the app its own address, once it has one — otherwise canonical links,
the sitemap, the manifest and the links in e-mails all still say `localhost`:

```bash
koyeb services update fmip/preview \
  --env SITE_URL=https://<address> --env WEB_BASE_URL=https://<address>
```

**How to know it worked.** `/en` answers over HTTPS; `/health/chat` reports the
bus `absent` (correct here — no Redis); forecasts read `model_unreachable`
(correct here — `MODEL_SERVICE_URL=off`). Those three are the preview being
honest about what it is missing, not failures.

**Two things to check in the database, because neither is guessable and both
fail later:** Postgres **14 or newer**, and the plan must allow
`CREATE EXTENSION` (the search migration creates `pg_trgm` and `unaccent`,
T-038). If it does not, say so and the migration gets a preview-safe path.

## 2. The Arabic translator (T-150)

**Why yours.** It is the one thing in this product that must be done by a person
who speaks the language. T-151 already settled the workflow and the rule that
makes the wait safe: **an untranslated string is visibly untranslated, never
machine output presented as a translation.** So `/ar` can ship incomplete and
still be honest — which is why this is not blocking anything.

**What it unblocks.** Nothing. It improves `/ar`, which already routes, formats,
sorts and lays out right-to-left correctly (T-152, T-153).

## 3. The paid data provider (T-100)

**Why yours.** It is a purchase. `CLAUDE.md` §7: no session spends money.

**What it unblocks.** T-101 (player-level match statistics), T-103 (injuries and
suspensions), and the rest of the depth that a free tier does not carry.

**What the decision rests on.** The bake-off ran seven times and is written up in
`docs/05-data-providers.md`; D-049 records what was decided when this was first
deferred. T-025 — the Phase 1 version of the same gate — is deferred under D-033
and stays deferred until you say otherwise.

## 4. The production deploy (T-074)

**Why yours.** It runs on a machine that does not exist yet, and buying it is a
purchase.

**What it unblocks.** The product having a home. `docs/09-deploy.md` is the
runbook; it was rehearsed end to end on 2026-09-12 and is open only because
nobody has run it on a VPS.

**Before it:** rerun the load test (`docs/08-load-test.md`) against the VPS, not
against a laptop.

## 5. The launch review, and the install tap (T-084)

**Why yours.** One is a judgement — does this meet the exit criteria in
`01-roadmap.md` — and the other needs a physical Android device to confirm the
PWA installs from the browser's own prompt. A headless browser can assert the
manifest is valid; it cannot assert that Chrome offered to install it.

**Outcome:** signed off in `00-decisions.md`.

## 6. Standing: approving contributors and analysts

**Why yours.** `13-policy.md` §3: a grant is a row that names its approver and
their reason. "The system approved it" is not an approver, which is the whole
point of recording one.

Eligibility is computed and never grants (T-250). What you see is a list of
members who **could** be approved; approving is a separate act, by a person,
with a reason that is stored.
