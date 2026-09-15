# Phase 4 — Reach

Phase 1 built a member who predicts. Phase 2 built the football intelligence
worth predicting against. Phase 3 built the part where members reach each other.
Phase 4 is where the product reaches **people it has not met**: in their
language, in their territory, on their phone, and — for the first time — outside
the product entirely, in a mailbox or a lock screen.

That last one is the difference that matters. Every surface up to here waited to
be opened. From here the product *goes to somebody*, which makes this the first
phase where a mistake is not a page somebody can close. A wrong notification is
a wrong notification everywhere it landed, and there is no edit.

Read `01-roadmap.md` for why the phases are shaped this way and `00-decisions.md`
before proposing anything that changes a locked decision. The sequencing rule
from the roadmap applies inside every epic: **schema and contracts, then data,
then the backend module with tests, then the published contract, then the
frontend, then observability.**

---

## Read this before planning work from it

**Three of the four bands are blocked on the maintainer, and not on a small
thing.** Languages need translators. Watch and highlights need licensed
broadcast data. Native mobile needs store accounts and a decision to add a
framework (`CLAUDE.md` §2). Only the fourth — notifications going outward —
needs just a delivery provider, and that arrives with the deployment (T-074).

This plan exists because it was asked for, and it is written to be useful
anyway: every epic separates **what can be built before the blocker clears**
from what cannot, and the separation is not cosmetic. The pattern D-061
established for news is the pattern for all of it — *the schema, the rights
model and the honest-absence behaviour are buildable now; only the data needs
the licence*. A rights model retrofitted once two kinds of source exist is
retrofitted too late.

**Phase 3 is not finished.** E25, E26 and E27 remain. Nothing in Phase 4 should
start before E27, because E27 is what Phase 4's outward delivery delivers.

---

## What Phase 4 is, in one paragraph

Four bands. **Languages** finishes what the architecture already anticipates:
seven more locales, localised entity names against canonical UUIDs, and a
catalogue a translator can actually work in. **Watch and highlights** is a new
data domain that is territory-shaped rather than fixture-shaped, and is the
first place the product says "in your country" — which means it is the first
place it can be wrong about somewhere it has never been. **Native mobile** is
not a new product; it is the same contracts on a second client, and the plan
treats it as a test of whether the contracts were really independent.
**Notification campaigns** takes E27's in-product inbox and lets it leave the
building.

---

## Exit criteria

Blueprint 19, the parts this phase owns, checked on the public deployment:

- All eight language routes work across public pages and signed-in journeys,
  including Arabic right-to-left on real content.
- A match shows its official viewing options for the viewer's **selected**
  territory, or says the territory is not covered — never an empty panel.
- An approved highlight embed appears after a match where one exists, and an
  official link where one does not.
- A notification that leaves the product deep-links to the exact thing that
  caused it, obeys quiet hours, and is never sent twice.
- A member can silence a team, a competition or a whole category without
  silencing everything.

---

## E30 — The seven remaining languages

Blueprint 13. The architecture for this was built in Phase 2 and has been
waiting: `i18n/locales.ts` already separates finished locales from unfinished
ones, `messages.ts` already falls back to English **and says so** (T-151), the
pseudo-locale test already catches physical-property regressions (rule 7), and
search already folds transliterations (T-152).

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-300 | The six Latin-script locales as unfinished: routing, formatting, plurals | T-151 | `/es` renders every page, every untranslated string says it is untranslated, and none of the six is offered as a finished language |
| `[ ]` T-301 | Plural and ordinal rules from CLDR, not from English's two forms | T-300 | A language with six plural forms gets six; a missing form is a failing test, not a fallback |
| `[ ]` T-302 | The translator's catalogue: export, import, review state, coverage per locale | T-151 | "How much of `tr` is done" is an answer the product gives, not a grep |
| `[ ]` T-303 | Localised entity names and aliases against the canonical UUID | T-010, T-152 | A team's Arabic name is a row against its id, never a second team (rule 1) |
| `[ ]` T-304 | One canonical article with a controlled version per language | T-141, T-302 | A language version is a version, with its own review state and its own `last_updated_at` |
| `[ ]` T-305 | **The strings themselves**, per language | T-302 | Reviewed by a fluent speaker; never machine output presented as a translation |

**Six locales, not seven, and Arabic is the seventh on purpose.** `ar` is
already routed and already right-to-left; what it lacks is its catalogue, which
is T-305's problem and not an architecture problem. Adding the six Latin-script
locales first proves the machinery against languages whose failures are *quiet*
— a wrong plural form, a date in the wrong order — before it is asked to carry
the one whose failures are visible.

**T-301 is where this epic actually gets hard.** English has two plural forms.
Arabic has six, Portuguese has two but not the same two, and a catalogue keyed on
`one`/`other` silently loses the rest. The rule: plural categories come from
`Intl.PluralRules` for the locale, and a catalogue entry missing a category that
locale *has* is a failing test — not a fallback, because a fallback here is a
sentence that is wrong in a way only a native speaker sees.

**T-303 is rule 1 in a place it is easy to break.** The tempting shape is a
`team_name_ar` column, then `team_name_es`, and eight columns later a translator
asks for a language nobody planned. The shape is a row per (entity, locale),
against the canonical UUID, with the same `entity_alias` table search already
uses (T-038, T-152) — so a localised name is findable by the thing that already
finds names.

**What is buildable now:** everything but T-305. The catalogues ship empty and
every missing string says so, which is exactly what T-151 decided and why that
task came before the first locale.

---

## E31 — Watch and highlights

Blueprint 11. The first data domain in this product that is **territory-shaped**:
the same fixture has different answers in different countries, and an answer
from the wrong country is worse than no answer.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-310 | **Decision gate:** where viewing and highlight data comes from, and under what licence | — | New entry in `00-decisions.md` |
| `[ ]` T-311 | Schema and contracts: `broadcaster`, `viewing_option`, `highlight`, rights per source | T-011 | Availability is stored per territory; a source carries what may be shown |
| `[ ]` T-312 | Territory: chosen by the member, stored, never silently inferred | T-041 | A viewer with no territory is asked, not guessed at |
| `[ ]` T-313 | Ingestion and coverage per territory | T-310, T-311 | A territory with no data says `not_supplied`; it never says "not available" |
| `[ ]` T-314 | Surfaces: the Watch page, the match centre panel, the team fixture list, the Following feed | T-313 | One module, four places, one answer |
| `[ ]` T-315 | Highlights: an approved embed where there is one, the official page where there is not | T-313 | Never an embed the rights do not allow, and never a dead player |

**"Not supplied" and "not available" are different sentences and the difference
is the whole epic.** *We have no data for Turkey* and *this match cannot be
watched in Turkey* look identical in an empty panel and are opposite facts. Rule
3 already forbids the first being rendered as the second; here it has to be
enforced per territory, which means coverage is stored per territory too.

**Territory is chosen, never inferred.** Blueprint 11 says "the user's selected
territory". An IP guess is wrong for anyone travelling, anyone on a VPN and
anyone whose country the geo-database has mislabelled — and it is wrong
*silently*, telling them a match is unavailable in a country they are not in.
The member picks; the product remembers; a member who has not picked is asked
rather than assumed about.

**The rights model is D-061's, and it is why T-311 is buildable before T-310
clears.** A source says what may be shown — a link only, a thumbnail, a full
embed — and the surface asks rather than assumes. That constraint is cheap to
build while there is one kind of source and expensive to retrofit when there are
two, which is the same argument that put it in T-141.

**What is buildable now:** T-311 and T-312 entirely, which is the schema, the
contracts, the rights model, the territory setting and every honest-absence
path. What needs the licence is the data.

---

## E32 — Native mobile via Expo

The roadmap's words are "reusing the same API and shared types", and that is the
claim this epic tests rather than assumes.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-320 | **Decision gate:** a native app at all, the framework, and the store accounts | — | New entry in `00-decisions.md`; `CLAUDE.md` §2 is explicit that a framework needs one |
| `[x]` T-321 | `@fmip/contracts` proven platform-independent | — | A test fails if the contracts package imports anything web-only or Node-only |
| `[ ]` T-322 | The app shell: routing, session, locale, writing direction | T-320, T-321 | A right-to-left locale lays out correctly on a device, not only in a browser |
| `[ ]` T-323 | Scores, match centre, predictions against the same endpoints | T-322 | No endpoint exists only for the app |
| `[ ]` T-324 | Push delivery on the device | T-322, T-330 | A push is the same notification the inbox already has, not a second one |

**T-321 is the one worth doing first and can be done today.** The claim that a
second client is cheap rests entirely on the contracts being free of web
assumptions, and nobody has checked. It is a guard, it costs an hour, and if it
fails it fails now rather than after a framework decision.

**T-321 verified on 2026-09-15, and it passed.** `platform-independent.spec.ts`:
the shipped modules import only from themselves, the package declares no runtime
or peer dependencies at all, no source names a browser or Node global, the build
compiles against `ES2023` with no `DOM` and no `types` entry, and the tests --
which do legitimately use `node:fs` -- are excluded from what ships. **Broken on
purpose before being believed**: a `node:fs` import and a
`typeof window === 'undefined'` guard added to one contract file failed two of
the six cases, and were removed.

**The `dist/` output is deliberately not checked.** It would be the strongest
evidence and it does not exist on a clean checkout before `build` runs; a guard
that skips itself when its subject is missing reports success for doing nothing,
which is the `REDIS_URL` lesson. These read the source, which is always there.

So the framework decision (T-320) can be made without this question hanging over
it, which was the point of doing the cheap half first.

**No endpoint exists only for the app.** The moment one does, there are two
products with two behaviours and the second one drifts. If the app needs
something the web does not have, that is a sign the web is missing it too.

**A push is not a second notification.** It is a delivery of the one E27 already
recorded — same row, same deep link, same read state. A notification that exists
only as a push is one nobody can find again.

**What is buildable now:** T-321. Everything else waits on a decision that costs
money and adds a framework, which `CLAUDE.md` §7 and §2 both reserve.

---

## E33 — Notifications that leave the building

E27 builds the inbox. This is where it reaches somebody who is not looking.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-330 | Delivery behind one port: email and push, with a provider chosen at deployment | T-270, T-074 | A deployment with no provider says so and delivers nothing, rather than appearing to |
| `[ ]` T-331 | Per-team, per-competition and per-category controls | T-270 | A member can silence one team without silencing football |
| `[ ]` T-332 | Campaigns: an audience is a saved query, a send is a row | T-330 | Nobody receives the same campaign twice, and every send says who it reached |
| `[ ]` T-333 | The Following feed, ranked | T-042, T-141 | Ranking is from qualified signals, never raw volume, and says what it is showing |

**One port, providers behind it, and a deployment that has none says so.** This
is the `LogMailer` shape the product already uses (T-043): a missing provider
must be a stated absence in `/health`, never a silent drop. A notification
system that looks healthy and delivers nothing is the worst failure in this
phase, because nobody complains — the people who would complain never got the
message.

**Nobody receives the same campaign twice**, and the way to guarantee it is a
row per (campaign, member), written before the send and unique. Deduplicating
afterwards from logs is how one retry becomes two e-mails.

**T-331 is not a nicety.** Blueprint 12.2 says per-team and per-competition
controls are *required*, and the reason is the phase's own risk: the only
alternative to a member silencing one team is a member silencing everything, and
that is the last thing they will ever do in this product.

**Ranking is from qualified signals** — the same rule T-143 has for trending.
Raw views rank whatever was already seen; the feed would then show a member
what other people looked at rather than what they follow.

**What is buildable now:** T-331 entirely, and the port and the honest-absence
half of T-330 (which is how the product behaves with no provider). What needs
the maintainer is the provider itself, and campaigns need a provider to mean
anything.

---

## What Phase 4 deliberately does not build

Written down so it is a decision and not an omission, the same way D-054 did it
for Phase 3:

- **SMS.** A per-message cost, a per-country regulatory surface, and nothing it
  carries that a push does not.
- **Machine translation of anything a person wrote.** T-151 refused it once and
  the refusal holds: publisher headlines (D-061), community analysis, and chat
  stay in the language they were written in, with the interface around them
  translated.
- **Monetisation.** Not in the blueprint's launch scope, and it would change
  what every other decision in this document optimises for.
- **A second editorial CMS.** The article schema (T-141) and the review workflow
  (T-261) already exist; a CMS would be a third place a published thing can live.
- **Inferring a member's territory, language or interests from behaviour.** Each
  of the three is asked for explicitly in this product, and each guess is wrong
  silently.

---

## What blocks what

| Tasks | Blocked on | Who |
|---|---|---|
| T-300..T-304 | nothing | agent |
| T-305 | a fluent speaker per language | **maintainer** |
| T-310 | a licensing decision | **maintainer** |
| T-311, T-312 | nothing | agent |
| T-313..T-315 | T-310 | after the decision |
| T-320 | a framework decision, store accounts, money | **maintainer** |
| T-321 | nothing | agent |
| T-322..T-324 | T-320 | after the decision |
| T-330 (the port and the absence) | nothing | agent |
| T-330 (a provider) | T-074 | **maintainer** |
| T-331 | nothing | agent |
| T-332 | T-330 | after the provider |
| T-333 | T-141 | agent |

**Eight of the eighteen tasks are buildable with nothing from the maintainer**:
T-300, T-301, T-302, T-303, T-304, T-311, T-312, T-321, T-331, and half of
T-330. That is more than it looked like from the roadmap's four lines, and it is
the case for planning this phase early rather than the case for starting it
early — **E25, E26 and E27 come first**, and E27 in particular, because it is
what E33 delivers.

---

## The honest risk in this phase

It is not size. It is that **three of the four bands can be built, tested,
merged and still be wrong in a way no test here can catch** — a plural form that
reads as broken to a Turkish speaker, a viewing listing that is right for the
United Kingdom and wrong for Ireland, a push that arrives at three in the
morning in a time zone the quiet-hours test did not have.

Every one of those is a correctness failure in somebody else's context, and the
only defences are the ones already chosen: ask rather than infer (territory,
language, interests), state absence rather than render it (coverage per
territory, untranslated strings that say so), and let a person check the thing a
test cannot (T-305's review, and a real device for T-322).
