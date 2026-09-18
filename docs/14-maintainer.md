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

**Outcome:** signed off in `00-decisions.md`.

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

**The viewing licence (T-310).** The schema and the rights model are built
(T-311): a `viewing_source` says whether it grants a link, a thumbnail or an
embed, and a listing or a highlight cannot carry more. What it needs is a
source, which is a licence, which is money and terms -- `CLAUDE.md` §7. Until
then every Watch surface says `not_supplied`, per territory, and never "not
available". A member's territory is already theirs to choose (T-312).

**A native app (T-320).** A framework and two store accounts, each a
decision and a cost. The contracts are proven platform-independent (T-321),
so the day you decide, the app is a second client of the same endpoints.

**Notification delivery (T-330, the provider).** The port exists and
`/health/delivery` says both channels are absent, which is true and will stay
true until you choose an e-mail or push provider -- after the deploy (T-074),
because a provider is a credential on a server. The agent adds the provider
behind the port; you supply the account. Campaigns (T-332) mean nothing
without one.
