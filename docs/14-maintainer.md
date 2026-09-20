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
| The public preview | A Render service and a Neon database. Live at `https://fmip-preview.onrender.com`; the stream carries over the single published port, which is what T-086 was for (D-064) | 2026-09-15 |
| The launch review | Phase 0 and Phase 1 exit criteria signed one at a time against CI and the preview; the real-fixture clause is re-checked on the first real deployment (D-071) | 2026-09-19 |

These were judgements, not tasks: what a platform asks of its members is not
derivable from the code, and an agent that picked them would have been inventing
product.

---

## 1. The Arabic translator (T-150)

**Why yours.** It is the one thing in this product that must be done by a person
who speaks the language. T-151 already settled the workflow and the rule that
makes the wait safe: **an untranslated string is visibly untranslated, never
machine output presented as a translation.** So `/ar` can ship incomplete and
still be honest — which is why this is not blocking anything.

**What it unblocks.** Nothing. It improves `/ar`, which already routes, formats,
sorts and lays out right-to-left correctly (T-152, T-153).

**What the translator gets, since 2026-09-18 (T-302, D-066).** One file:
`apps/web/src/i18n/catalogues/ar.json`. Every key the product shows, the
English beside it, and a `text` to fill in with a `status` to set --
`translated` when they have written it, `reviewed` when a second fluent
speaker has read it. Nothing to install, no account to make; the work comes
back as a pull request, and `/ar` shows it in place the moment it merges. The
same file exists for the other six languages.

## 2. The paid data provider (T-100)

**Why yours.** It is a purchase. `CLAUDE.md` §7: no session spends money.

**What it unblocks.** T-101 (player-level match statistics), T-103 (injuries and
suspensions), and the rest of the depth that a free tier does not carry.

**What the decision rests on.** The bake-off ran seven times and is written up in
`docs/05-data-providers.md`; D-049 records what was decided when this was first
deferred. T-025 — the Phase 1 version of the same gate — is deferred under D-033
and stays deferred until you say otherwise.

## 3. The production deploy (T-074)

**Why yours.** It runs on a machine that does not exist yet, and buying it is a
purchase.

**What it unblocks.** The product having a home. `docs/09-deploy.md` is the
runbook; it was rehearsed end to end on 2026-09-12 and is open only because
nobody has run it on a VPS.

**Before it:** rerun the load test (`docs/08-load-test.md`) against the VPS, not
against a laptop.

## 4. The launch review (T-084)

**Why yours.** It is a judgement — does this meet the exit criteria in
`01-roadmap.md`. Nothing else in the project can make it.

**The install tap is done.** It was the other half of this item: a physical
Android device confirming that Chrome itself offers to install the app, which a
headless browser cannot assert. On 2026-09-17 you opened the preview on Android
and Chrome's menu showed **Install app** — the browser's own offer, not the
always-present "Add to Home screen". It could not have shown it a day earlier:
the images shipped without `public/`, so the service worker and every icon were
404 on every deployment, and no local check could see it (`04-tasks-phase-1.md`,
T-082). That was found by asking the deployment rather than the build.

**Outcome:** signed on 2026-09-19 (D-071), conditional on the real-fixture
re-check after T-074.

## 5. Two members on the preview -- withdrawn on 2026-09-17

This asked you to register two accounts on the preview and fish their
verification links out of the service log, so the rest of Phase 3's exit
criteria could be walked. It is gone, and nothing replaced it for you.

Those criteria are now `apps/web/tests/e2e/journeys/social.spec.ts`: two
members, registered through the real form and verified from the real message,
against the real API, database and seed, on every pull request. The preview
walk would have been one observation, on one day, by one person, and it could
not have been repeated without that person. This is one on every commit -- and
it checks the criterion the preview could never have checked at all, because
messages arriving in real time needs a Redis the preview does not have.

If you ever want members on the preview for your own use, the procedure was:
register at `/en/register`, find the line beginning `[mail] to=` in the Render
logs, and open the `verify-email` link in it. Nothing in the project waits on
it any more.

## 6. Standing: approving contributors and analysts

**Why yours.** `13-policy.md` §3: a grant is a row that names its approver and
their reason. "The system approved it" is not an approver, which is the whole
point of recording one.

Eligibility is computed and never grants (T-250). What you see is a list of
members who **could** be approved; approving is a separate act, by a person,
with a reason that is stored.

## 7. Phase 4: what the agent built and what waits for you

Written on 2026-09-18, when every Phase 4 task that needs nothing from you
was done (`04-tasks-phase-4.md`). What is left is yours, and each item below
is buildable the day you decide it.

**Translations (T-305).** The machinery exists: `POST /admin/articles/:id/
translations` writes a fluent speaker's version of a headline (and summary,
where the source grants one) as a new immutable version, and `POST .../
translations/:language/review` has a second speaker approve it (T-304). Both
need the `editor` role, granted with a reason in `user_role`. The interface
strings are the same job in another file: `apps/web/src/i18n/catalogues/
<locale>.json`, one entry per key with the English beside it (D-066). Nothing
here is machine-translated, and nothing will be (T-151).

**The viewing licence (T-310), decided on 2026-09-18 by delegation (D-069).**
You asked the agent to choose; under the rule that nothing is bought, it
chose the editorial desk: editors declare coverage per season and territory
and enter listings and official highlight pages by hand, link-only, every
row audited (T-313). What waits for you is editors' time -- grant `editor`
to whoever enters listings -- and a licence only if you ever want thumbnails
or embeds, which would be a second source beside the desk, not a replacement.

**A native app (T-320).** A framework and two store accounts, each a
decision and a cost. The contracts are proven platform-independent (T-321),
so the day you decide, the app is a second client of the same endpoints.

**Notification delivery (T-330).** Built end to end on 2026-09-20 without a
vendor: every kind leaves as the inbox's own sentence and route, e-mail is
SMTP (D-073, any service's credentials) and push is Web Push with your own
keys (D-074, no account). `/health/delivery` says both channels are absent
until the server has `SMTP_URL` + `DELIVERY_EMAIL_FROM` and a VAPID key pair
-- after the deploy (T-074), because credentials live on a server. §8 has
the exact lines. Campaigns (T-332) are built too (D-075): an audience
is a saved filter over what a member can see about themselves, and a send
goes through the inbox, so a member's preference decides.

## 8. The exact steps, per item

Written on 2026-09-18 after PR #200, when the agent's share of every open task
was merged and the maintainer asked for each remaining step spelled out. For
every item: what only you can do, in order, and what the agent builds the
moment it is done. Nothing below asks the agent to guess at a decision, a
purchase or a licence (`CLAUDE.md` §7).

**T-305, the strings.**
1. Find one fluent speaker for each of `es`, `fr`, `de`, `it`, `pt`, `tr`,
   `ar`; a second reader per language if you want `reviewed` rather than
   `translated`.
2. Send each one `apps/web/src/i18n/catalogues/<locale>.json`. Every entry has
   the English in `source`; they fill `text` and set `status`. A plural entry
   takes one form per category their language has, no more and no fewer
   (D-067). Nothing to install and no account to make.
3. Their work comes back as a pull request. CI's Verify runs
   `pnpm --filter @fmip/web i18n:catalogues --check` and `messages.spec.ts`,
   which refuse a stale `source`, a missing key, a status the text does not
   support and a plural missing a form.
4. `/admin` shows each language's percentage; the picker offers a language the
   day it crosses `SHIPPABLE_COMPLETENESS` (T-306), with no deploy decision
   in between.
5. Drafts were offered and declined on 2026-09-19: the translators are
   yours, and you asked not to be reminded. Nothing is drafted, and nothing
   about T-305 is raised again unless you raise it.

**T-310, the viewing licence: decided (D-069).** The editorial desk, chosen
by the agent at your request on 2026-09-18. Nothing to decide now: grant
`editor` to whoever enters listings -- the desk is at the bottom of any
match page for them (declare coverage first, then list) -- and revisit only
for a licence with more rights.

**T-320, the native app.** Parked on 2026-09-19 at your request, to be
raised later. When it is, four things, all yours: whether at all; the
framework (the roadmap names Expo, and `CLAUDE.md` §2 wants a decision entry
before it is added); the two store accounts, Apple Developer Program and
Google Play Console, opened in your name and paid for; and one device per
platform, because T-322's right-to-left acceptance is checked on a device and
not in a browser. Then the agent builds T-322 and T-323; T-324 waits for
T-330's provider.

**T-074, the deploy.** You asked on 2026-09-19 for all of it to be done
by the agent, by any route. The route has a wall in it: the machine is a
purchase and its access is a credential, and neither is the agent's to make
-- the standing rule, not a preference. What the agent does instead is
below this list: rehearse the production stack on this laptop after every
change that touches it, and keep the runbook and the compose file current,
so the day the machine exists the steps are only the ones here. In order: buy the VPS (`09-deploy.md`, "What you need
before starting"); put the domain's DNS on Cloudflare; generate an SSH key on
your own machine; follow `09-deploy.md` §1 to §5; rerun `08-load-test.md`
against the server rather than a laptop; record the outcome in
`00-decisions.md`. The agent never holds the SSH key or the server's secrets,
which is why this cannot move without you.

**T-330, the provider.** Parked on 2026-09-19 at your request ("later").
After T-074, because a provider is a credential on a server. **E-mail is
built (D-073, 2026-09-20)** and takes any service's SMTP credentials: open
an account with a transactional e-mail service (Brevo, Mailjet, Postmark,
Amazon SES, or any relay), verify your domain there as it asks (a few DNS
records in Cloudflare), copy its SMTP host, port, user and password into the
server's `.env` as `SMTP_URL=smtps://USER:PASSWORD@HOST:465` (or
`smtp://HOST:587`), set `DELIVERY_EMAIL_FROM="FMIP <no-reply@your-domain>"`
and `DELIVERY_EMAIL_PROVIDER=smtp`, restart the API: `/health/delivery`
says `smtp`, and from that moment every notification and the verification
and reset mails go out. Nothing else to tell the agent. **Push is built too (D-074,
2026-09-20)**, as Web Push with your own keys, no account anywhere. On the
server, once:

```bash
cd /opt/fmip && docker compose run --rm --no-deps api npx web-push generate-vapid-keys
```

put the two keys it prints into `.env` as `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`, set `VAPID_SUBJECT=mailto:you@your-domain` and
`DELIVERY_PUSH_PROVIDER=webpush`, restart the API. Members then turn push
on per device from Settings → Notifications → "On this device";
`/health/delivery` says `webpush`.

**T-332, campaigns.** Built on 2026-09-20 (D-075): audiences, campaigns and
the send through the inbox, administrators only, at `/admin/campaigns`.
Nothing from you.

**T-084, the launch review.** Signed on 2026-09-19 (D-071), one criterion at
a time in chat; what remains is the re-check with real fixtures on the
server after T-074. The original steps, kept for that re-check:
read the exit criteria in `01-roadmap.md` and
in each `04-tasks-phase-*.md` against the public preview or the VPS, and
sign off in `00-decisions.md`. The agent can walk the public pages and
report what it sees, and did for the news pages on 2026-09-18 locally; the
preview itself refused the agent's browser that day, so the public
walk-through is yours or waits for a session whose browser is allowed there.

**The local database.** The development Postgres on this machine carries
rows from runs that did not finish -- on 2026-09-18: 28 teams named
`Test Home`, `Test Away` and `News Schema Team`, 33 fixtures on them, 27
`@example.test` accounts and 31 of their messages. Every API spec that
inserts a team was run alone that day and left nothing behind; what remains
is from interrupted runs. The rows are held by immutable tables (settlement,
forecast, evaluation, message tombstones), so the honest fix is a fresh
volume rather than a hand-written delete, and removing a volume is a step
the agent's sandbox refuses, rightly:

```bash
docker compose stop postgres && docker compose rm -f postgres
docker volume rm fmip_postgres-data
docker compose up -d --wait postgres
set -a; . ./.env; set +a
pnpm --filter @fmip/db build && pnpm --filter @fmip/db migrate:up && pnpm --filter @fmip/db seed
```

CI is unaffected: every run there starts from an empty database.

## 9. Phase 5: the intelligence layer waits on one key

Written on 2026-09-19, when the phase was planned (`04-tasks-phase-5.md`)
and its port built (D-070). Fourteen of its fifteen tasks need nothing from
you, because a language model is a provider behind a port with an honest
absence, exactly like delivery. The one that does is **T-400**: a key on the
server.

**What you do, after the deploy (T-074).** Open an account with the provider
you choose -- the first adapter drives Anthropic's Messages API, and a second
provider is an adapter beside it -- and put the key in the server's `.env`
as `ANTHROPIC_API_KEY`, with `INTELLIGENCE_PROVIDER=anthropic`. Nothing in
chat, nothing in a file the agent writes. `INTELLIGENCE_MODEL` names the
model (the reference's current default when empty) and `INTELLIGENCE_EFFORT`
is `low`, `medium` or `high`. Restart the API; `/health/intelligence` says
`configured`, and every Phase 5 surface starts answering. It costs per
generation at the provider's token prices, and nothing until the key exists.

**Testing before the deploy, for free (D-072, 2026-09-19).** You asked to try
Mistral's free tier first and to keep every model open later. Both are
built. On your own machine: in Mistral Studio, activate Free mode and create
an API key; in **your local** `.env` set `INTELLIGENCE_PROVIDER=mistral` and
`MISTRAL_API_KEY=` (the key; never in chat) and `INTELLIGENCE_MODEL=
ministral-14b-latest` -- on 2026-09-19 the free plan answered only the
Ministral models (3b, 8b, 14b); Small, Medium and Magistral came back 429
with a request limit of zero and Large 403, and the log names that as
"not in this workspace's plan". Start the API and open a finished match,
the search box with a question, and Following's briefing button. The same
two lines on the server later. Any other model: `INTELLIGENCE_PROVIDER=
openai_compatible` with `INTELLIGENCE_BASE_URL`, `INTELLIGENCE_API_KEY` and
`INTELLIGENCE_MODEL`, which covers a local runtime as well as a vendor.

**What the agent builds without it.** Every schema, contract, grounding gate,
surface and honest-absence sentence in the plan. With the key absent, each
surface says so in a sentence; nothing on the critical path is touched either
way.
