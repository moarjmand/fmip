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
| `[x]` T-300 | The six Latin-script locales as unfinished: routing, formatting, plurals | T-151 | `/es` renders every page, every untranslated string says it is untranslated, and none of the six is offered as a finished language |
| `[x]` T-301 | Plural and ordinal rules from CLDR, not from English's two forms | T-300 | A language with six plural forms gets six; a missing form is a failing test, not a fallback |
| `[x]` T-302 | The translator's catalogue: export, import, review state, coverage per locale | T-151 | "How much of `tr` is done" is an answer the product gives, not a grep |
| `[x]` T-303 | Localised entity names and aliases against the canonical UUID | T-010, T-152 | A team's Arabic name is a row against its id, never a second team (rule 1) |
| `[x]` T-304 | One canonical article with a controlled version per language | T-141, T-302 | A language version is a version, with its own review state and its own `last_updated_at` |
| `[ ]` T-305 | **The strings themselves**, per language | T-302 | Reviewed by a fluent speaker; never machine output presented as a translation |
| `[x]` T-306 | The language picker: offers the languages the product actually speaks | T-300 | A locale appears the day its catalogue crosses `SHIPPABLE_COMPLETENESS`, and never before |

**Six locales, not seven, and Arabic is the seventh on purpose.** `ar` is
already routed and already right-to-left; what it lacks is its catalogue, which
is T-305's problem and not an architecture problem. Adding the six Latin-script
locales first proves the machinery against languages whose failures are *quiet*
— a wrong plural form, a date in the wrong order — before it is asked to carry
the one whose failures are visible.

**T-304 done on 2026-09-18.** A language version was already a version
(T-141: one immutable row per language and number, its `created_at` its
last-updated time); what it lacked was whose words it carried. Migration
`..._article-translations` adds `origin` -- `publisher` for what the feed
carried, `translation` for what a person wrote -- and, for a translation,
the catalogue's own review state (`translated` by a fluent speaker,
`reviewed` by a second; T-302, D-066) with `written_by` and `reviewed_by`.
The constraints say what a machine translation could not satisfy: a
translation has an author, a reviewed one has a reviewer, and the reviewer
is a different person. **A review is a new version, not an edit** (rule 5):
`POST /admin/articles/:id/translations/:language/review` copies the newest
translation forward as `reviewed`, naming both people, and refuses the
author. A translation into a language the publisher already writes the
article in is refused as a second original, and one that carries a summary
from a headline-only source is refused by `PL016` before it is written
(D-061). Every write is an `audit_log` row (`translation.write`,
`translation.review`, target type `article`). The story page shows each
language with whose words it is -- the publisher's own, translated awaiting
review, or reviewed -- from a total record over the three states, so a
fourth state fails the build until it has a sentence. Who translates is
still the maintainer's (T-305); the machinery is what this task was.

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

**T-306 came out of building T-300, and it is not a nicety.** The acceptance
criterion says *none of the six is offered as a finished language* -- and
nothing in the product offers a language at all, so that criterion is true by
there being no offer. The eight `language.name.*` keys have sat in the catalogue
with nothing rendering them; the guard added in T-300 is what found them. A
picker driven by `isShippable` turns a vacuous pass into a real one: a language
appears the day its catalogue crosses the threshold, and a translator watching
their own work can see exactly when.

**T-302, first half, on 2026-09-18 (D-066).** The catalogue moved out of
TypeScript and into `src/i18n/catalogues/`: `en.json` is the source, and each
of the seven other locales has a file a fluent speaker edits directly, every
key with the English beside it and a `status` -- `untranslated`, `translated`,
`reviewed` -- that a person set. "Export" is `pnpm --filter @fmip/web
i18n:catalogues`, which refreshes every file from the source, keeps every
translation exactly as it was, and refuses to drop a key that still carries
one; "import" is the file itself, read by `messages.ts`. Review state is in
the file and in `coverage(locale)`, which is the product's own answer to how
far a language has got. The spec refuses a stale `source`, a missing key and
a status the text does not support -- checked by breaking each one.

**Second half, the same day: the surface.** `/admin` has a Languages table --
one row per real locale, the translators' numbers through `coverage()`, the
percent rounded down (94.9% beside "Not yet offered" must not read as 95%),
and "Offered" from `isShippable`, the same test T-306's picker will use. It
names the eight `language.name.*` keys literally, which took them off
`messages.spec.ts`'s waiting list: that list is now empty, and it could only
ever get shorter. T-302 is `[x]`.

**What this unblocks for the maintainer.** `14-maintainer.md` §1 waited on
this: a translator now has a file to work in, with nothing to install and no
account to create, and their work arrives as a pull request.

**T-306 done on 2026-09-18, and it renders nothing.** That is the point rather
than an apology. `pickerEntries` is `[]` while fewer than two languages are
`isShippable` -- which is today, with English alone -- because a menu with one
entry is furniture, and the spec asserts the empty state as firmly as the
populated one, with the predicate injected so the populated state is shown
without pretending a catalogue is finished. The day `es.json` crosses 95% the
picker appears in the header with `English` and `Español`, each in its own
words from its own catalogue, linking to the same page, with no deployment
decision in between: the threshold is the decision (T-151). It is a client
component because it links to the *same page* and a server component cannot
read the pathname (Next documents that as intentional); the proxy only
redirects, so there is no hydration mismatch to guard.

**And T-300's vacuous criterion is now a real one.** "None of the six is offered
as a finished language" was true by there being no offer. There is an offer
now, driven by the same `isShippable` that `/admin` reports, and it offers none
of the six.
**T-301, the machinery, on 2026-09-18 (D-067).** Seven plural keys in
`en.json` -- six cardinal, one ordinal -- each an object of forms keyed by
CLDR category. `plural(locale, key, count)` picks the category from
`Intl.PluralRules` for the locale, fills `{count}` in the locale's digits, and
falls back to the English forms *by English rules* when nobody has translated
the entry. `Translated` takes a `count`. The rule the task exists for is
enforced twice: the refresh script and the spec both refuse a translated
plural whose forms are not **exactly** the categories its language has --
Arabic's six, Spanish's three, Turkish's two -- and nothing fills a missing
one in. Checked by breaking it: two of Arabic's six forms were refused by
name, and all six were accepted and selected -- `zero`, `one`, `two`, `few`,
`many`, `other` for 0, 1, 2, 3, 11, 100 -- by Arabic's rules. One thing for
whoever finishes Arabic: on this ICU the bare `ar` tag writes Latin digits and
`ar-EG` writes Arabic-Indic; which one the product wants is a decision about
the tag in `intlLocale`, not about the forms.

**And the six pages, the same day.** Friends in common, members of a group
(twice), messages matching a search, followers, and the two group-comparison
lines render through `Translated` with a `count`; the team page's "3rd of 20"
comes from `team.position` by the locale's ordinal rules, and the hand-rolled
`ordinal()` is gone with its teens special case. No `=== 1 ? '' : 's'` is
left in the web app, and the waiting list in `messages.spec.ts` is empty
again. T-301 is `[x]`.

**T-303, the schema, on 2026-09-18.** A localised name is an `entity_alias`
row with `kind = 'name'` and the language it belongs to -- the table search
already reads, so a reader who types the Arabic name finds the team by the
thing that already finds names, and nothing about search changed. Three
guarantees live in the database and not in a caller: a name has a language
(one without is the canonical name, which lives on the entity); one name per
language per entity, by a partial unique index that names itself in the
refusal; and `localised_name(type, id, language)` answers the row or **NULL**
-- never the English -- so a missing name looks missing. The schema spec
writes two names against one team and checks the team is still one team.

**The reading, the same day: the API.** `GET /teams/:id`, `/competitions/:id`
and `/players/:id` take `?locale=` and answer `localised_name` **beside**
`name`, never in its place -- the canonical name is the entity's, and a page
that shows the localised one still knows what it is a name for. A language
nobody wrote is `null`, not the English copied in; an odd spelling of the tag
is a preference nobody could honour, so it is `null` with 200, not a 400. The
API was locale-blind until this; the query is the first thing in it that knows
the reader's language. The pages, last: they pass the locale they already
had and show the localised name as the heading, with the canonical name in a
line beneath it -- shown, not hidden, because a page that showed only the
localised name would have lost the entity it is a name for. Where nobody has
written one, the canonical name stands alone and nothing is shown twice. The
journeys suite reads Real Madrid on `/ar` (Arabic heading, canonical beneath)
and on `/tr` (canonical alone) -- one id, two languages, nothing invented.
T-303 is `[x]`. Lists (`/teams`, `/competitions`, search results) still show
the canonical name only; a localised list is a follow-up, not a gap this task
claimed.

**What is buildable now:** everything but T-305. The catalogues ship empty and
every missing string says so, which is exactly what T-151 decided and why that
task came before the first locale.

**T-300 stays `[~]`, and the reason is in its own title.** Routing is done and
verified; **formatting is not started**. Every date in the product is a
hardcoded `en-GB`, so `/es` renders Spanish-marked English over British dates.
Plurals are T-301 by design, but formatting is this task's, and marking it `[x]`
would be the progress-report version of the thing rule 3 is about.

**Formatting started on 2026-09-17, and the first cut is the one that matters.**
`src/i18n/format.ts` is the module; `formatDateTime`, `formatTime`, `formatDate`
and `formatNumber` take the locale, and `intlLocale` maps `en` and the
pseudo-locale to `en-GB`. Three things about it are worth more than the code:

- **English is byte-for-byte what it was.** Every call site said `'en-GB'`, so
  that is what `en` still becomes, and `format.spec.ts` pins the exact strings.
  The other seven locales are the only change.
- **The pseudo-locale had to be mapped, not passed through.** `x-rtl` is a
  private-use tag and `Intl.DateTimeFormat('x-rtl')` throws a `RangeError`;
  the first page on `/x-rtl` to show a date through this module would have
  crashed in render. Found by asking Node before writing the mapping, and the
  spec asserts the throw so the reason survives the code.
- **The two machine formats stay out.** `lib/scores.ts` validates a time zone
  on `en-US` and builds the day-tab key on `en-CA`, whose date order is ISO.
  Neither is read by a person, and localising them would make the scores URLs
  depend on the reader's language. `format.spec.ts` reads the source and fails
  if either changes, and fails if this module ever grows a date-key helper --
  in its code, not its comments, because a guard that trips on the explanation
  teaches people to delete explanations.

**Formatting finished on 2026-09-18, in four changes, and T-300 is `[x]`.**
Every `Intl` call in the web app that a person reads now goes through
`src/i18n/format` with the reader's locale: the three page-level sites, then
`scores` (kick-offs, status, the day strip -- eleven files, because five panels
borrow the kick-off as a generic clock), then `live` and `prediction-history`,
then `competition`, `player` and the venue capacity. What is left outside the
module is exactly three calls and each is a machine format: the register page
lists `Intl.supportedValuesOf('timeZone')`, and `scores.ts` validates a zone on
`en-US` and keys the day tabs on `en-CA`. The guard in `format.spec.ts` names
the last two; the first returns identifiers, not text.

Each change pinned English byte-for-byte and asserted one other language, and
each split a clock from a date on purpose: a kick-off or a live stamp is the
same digits in Spanish, a fixture date or a spell is not. The words around
them -- "present", "updated", "Yesterday" -- are still English on `/es`, and
that is T-151's catalogue doing what it was built to do, marked and visible,
not a formatting gap.

Plurals are T-301 by design. The "none of the six is offered as a finished
language" criterion is true by there being no offer, which T-306 exists to
make real; that was recorded when T-300 was `[~]` and is no less true now.

It is separated rather than deferred, and there is a trap in it worth the
separation: `scores.ts` reaches for `en-CA` to **build a date key** and `en-US`
to **validate a timezone**, neither of which displays anything. Making every
`Intl.DateTimeFormat` locale-aware would break the day tabs on the scores page.

**What is verified, 2026-09-16.** All eight of blueprint 13's languages route:
`/es`, `/fr`, `/de`, `/pt`, `/tr`, `/it` each render every page with the right
`lang` and `dir`, and every string they have no translation for is English
carrying `lang="en"` and `data-translation="untranslated"`. `/en` carries none
of those marks, which is the half of the test that makes the other half mean
something.

**The six before Arabic, deliberately.** Their failures are quiet -- a wrong
plural form, a date in the wrong order. Arabic's are visible from across a room.
The machinery should meet the quiet ones first.

**What the work actually found.** Nine of the catalogue's twenty-one keys had no
call site: `nav.search`, whose surface existed but was hardcoded, and the eight
language names, whose surface does not exist yet (T-306). A dead key is not
free -- `completeness()` divides by the number of keys, so each one made every
locale look further behind than it was, and the first translator to reach it
would have spent time on a string that goes nowhere. `common.notTranslated` was
removed outright: the fallback is marked structurally, with `lang` and a data
attribute, and no page ever rendered the words.

**And one key could not be marked the usual way.** `Translated` wraps a fallback
in `<span lang="en">`, and the header's search `placeholder` holds a string, not
an element -- often the only instruction that input carries. `attribute()` moves
the marking onto the element that holds the attribute, which is the same
argument one level out.

**One entry was removed from Arabic for being a translation nobody made.** The
catalogue carried `language.name.en: 'English'` as though it were an autonym. It
is not -- the Arabic for English is `الإنجليزية` -- so the Latin word was being
served under `status: 'translated'`. Falling back and being marked untranslated
is the honest state.

---

## E31 — Watch and highlights

Blueprint 11. The first data domain in this product that is **territory-shaped**:
the same fixture has different answers in different countries, and an answer
from the wrong country is worse than no answer.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-310 | **Decision gate:** where viewing and highlight data comes from, and under what licence | — | New entry in `00-decisions.md` |
| `[x]` T-311 | Schema and contracts: `broadcaster`, `viewing_option`, `highlight`, rights per source | T-011 | Availability is stored per territory; a source carries what may be shown |
| `[x]` T-312 | Territory: chosen by the member, stored, never silently inferred | T-041 | A viewer with no territory is asked, not guessed at |
| `[x]` T-313 | Ingestion and coverage per territory | T-310, T-311 | A territory with no data says `not_supplied`; it never says "not available" |
| `[x]` T-314 | Surfaces: the Watch page, the match centre panel, the team fixture list, the Following feed | T-313 | One module, four places, one answer |
| `[x]` T-315 | Highlights: an approved embed where there is one, the official page where there is not | T-313 | Never an embed the rights do not allow, and never a dead player |

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

**T-311 done on 2026-09-18, before the licence, as planned.** Migration
`..._viewing.sql` is the news schema's shape applied to viewing, because it
is the same problem: `viewing_source` says what it grants -- `link`,
`thumbnail` or `embed` -- and a `highlight` cannot carry more (`PL017`: an
embed from a link-only source, a thumbnail from a link-only source). A
`viewing_option` is one listing -- this match, in this territory, on this
`broadcaster` (a canonical row, named by id), with this access and this
official destination -- unique per service per territory, because the
correct option differs between countries. A `highlight` is per territory for
the same reason, one per match per territory, its `url` always the official
page so a dead player still has somewhere to send the viewer; the shape
itself insists an embed has a player and nothing else does.
**`viewing_coverage` is what makes "not available" sayable.** It is per
season, per territory and per module, and a supplied state must name its
source; a match in a territory with no coverage row is `not_supplied`, and
only a source that covers the territory can make an empty listing mean
"nothing to watch here". A dropped source takes its listings and highlights
and turns the coverage it stood behind into `not_supplied` with the reason
-- kept, not deleted, because "why is there nothing for Turkey" needs an
answer. The contract (`src/viewing.ts`) is `MatchViewing`: the viewer's
territory as T-312's state, and `options` and `highlights` as `Covered`
lists, so the four surfaces T-314 builds cannot render an empty panel that
reads either way. `viewing.schema.spec.ts` asserts each rule against the real
database, including that the drop is refused without a reason. No ingestion
and no surface yet: those are T-313 and T-314, after the T-310 decision.

**T-312 done on 2026-09-18.** A territory is an ISO 3166-1 country, not a
row of `country`: rights are sold by state, and England, Scotland and Wales
are three football countries in one territory (GB), while a viewer in
Guernsey is in none of them. `territory` (migration `..._viewing-territory`)
carries the full ISO list, seeded, so a member anywhere can choose;
`user_account.viewing_territory` is nullable and starts null for everybody,
and **`country_id` is never read in its place** -- the spec registers a
member in England and asserts the territory is `not_chosen`. The contract is
a state, not a nullable string: `ViewingTerritory` is `chosen` with the
territory or `not_chosen`, so a surface that meets it has to write the
sentence for the second case rather than fall through to a default. `PUT
/me/territory` takes a code in any case or `null` to clear; a code that is
not a territory is refused by the foreign key and served as 400, never mapped
to a neighbour. `GET /territories` is public and lists what may be chosen,
by name in the database's collation -- a page re-sorts for its locale, and
may name the codes with `Intl.DisplayNames` so the list is in the reader's
language for free. The settings page has the chooser; the surfaces that ask
(T-314) get `viewing_territory` from `OwnProfile` and from `GET /me/territory`.
A guest has nowhere to store a choice; the Watch surfaces will ask them each
time rather than guess, which is T-314's to render.

**T-310 decided on 2026-09-18 (D-069), by delegation.** The maintainer asked
the agent to choose among the three roads in `14-maintainer.md` §8 under the
rule that nothing is bought and no account is opened. That leaves the
editorial desk: link-only, per territory, every row an editor's and audited.
A licence, if one ever comes, is a second source beside it, not a replacement.

**T-313 done the same day: the desk.** Migration `..._viewing-editorial` fixes
the desk's `viewing_source` by id (`manual`, `link`, no homepage because it
lives here). `GET /fixtures/:id/viewing` and `GET /viewing?fixture=…` answer
`MatchViewing` for the viewer's stored territory, or `?territory=` for a guest
or a member looking elsewhere on purpose -- an unknown code refused, never
mapped to a neighbour, and none at all answered as `not_chosen`. The editor's
endpoints under `/admin` declare coverage per season, territory and module
(`not_supplied` is a declaration too, dated and sourceless), keep the
broadcaster list, and enter, replace and remove listings and official
highlight pages. Coverage comes first, because a listing in a territory
nobody declared is a fact nobody stood behind; every write is an audit row
(rule 10) and every removal carries a reason. `viewing.http.spec.ts` walks a
guest, a member in Iran, an editor, and the schema's own refusal of a player
under the desk. T-314 and T-315, the surfaces, are next.

**T-314 and T-315 on 2026-09-19.** One component,
`viewing-panel.tsx`, with four sentences and never a fifth: no territory and
the surface asks -- a member is sent to settings, a guest gets a chooser
whose pick goes into the address and follows them by link, and nothing is
read off an IP; a territory nobody declared says "no viewing information yet
for X"; a territory the desk covers with nothing listed says "no official
service listed", which is then a fact; and listings show the service, its
kind, the access, the kick-off in the viewer's zone and the official
destination. The match centre carries the panel; `/watch` is the scores
page's day with the same chooser and one line per match from one batch
request; the team fixture list and the Following feed carry the line under
each fixture, from one batch each; and a match the viewing service could
not answer for says so. The
highlight (T-315) renders after the match: a player only for a row whose
source grants an embed and which has one -- checked in the surface as well
as the schema -- and the official page for everybody, so there is never a
dead player and never one the rights do not allow. The journey walks a
member in the United Kingdom and a guest choosing Iran through the match
page, `/watch` and the team page, and asserts the words "not available"
appear nowhere. **The desk has a surface too:** an editor sees the
editorial desk under the panel on any match page -- coverage for the
season, a broadcaster, a listing, the highlight page, and removal with a
reason -- through server actions that call T-313's endpoints, so entering a
listing needs no tool but the page.

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
| `[~]` T-330 | Delivery behind one port: email and push, with a provider chosen at deployment | T-270, T-074 | A deployment with no provider says so and delivers nothing, rather than appearing to |
| `[x]` T-331 | Per-team, per-competition and per-category controls | T-270 | A member can silence one team without silencing football |
| `[ ]` T-332 | Campaigns: an audience is a saved query, a send is a row | T-330 | Nobody receives the same campaign twice, and every send says who it reached |
| `[x]` T-333 | The Following feed, ranked | T-042, T-141 | Ranking is from qualified signals, never raw volume, and says what it is showing |

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

**T-333, first piece, on 2026-09-18: the feed itself.** `GET /me/feed`
(`apps/api/src/modules/following-feed/`) is what happened, and what is
about to, around what a member follows: matches of followed teams and
competitions from three days back to seven ahead, stories the news links to
them, the founder's analyses of their matches, and followed contributors'
panel posts (blueprint 12.1 names line-ups and predictions too; a line-up
change is not yet an event the product records, and a member's own
predictions are their history, not a feed). **Ranking is `feed-rank@1`, and
it is the signals added up**: a favourite counts two, a live match three, a
kick-off within a day two, a discussion one or two for its *distinct members*
inside 48 hours (never its post count), a publication within a day one; a
follow is inclusion, not rank. Every item carries its `because` list and its
`rank`, so a reader can add one up and get the other, and the response says
what it is showing -- the window, the kinds, how many of each thing the
member follows, and the ranking rule by name. There is no `views` signal
because nothing records views, and there will not be one: raw views rank
whatever was already seen. A member who follows nothing is told so; a window
with nothing in it says so.

**T-333, second piece, and done: the page.** `/following` is the API's list
in the API's order -- the page adds nothing to the ranking and hides nothing
of it. Its first line says what the list is made from: the window, how many
teams, competitions and contributors are followed, and the rule by name;
every item shows its kind, its moment, the thing it is about as a link by
id, its `because` chips (each signal a sentence from a total record over the
contract's signal kinds, `discussed` as a plural of members) and the rank
they add up to. The journey follows Liverpool as a favourite in 18.4 and
then finds their match in the feed with "you follow Liverpool" and "a
favourite" on it. E33's agent-buildable half is complete; the provider
(T-330) and campaigns (T-332) wait for the maintainer.

**T-330, the port and the honest absence, on 2026-09-18.** `apps/api/src/
modules/delivery/` is one port (`OUTBOUND_DELIVERY`: an e-mail channel and a
push channel, each present with its provider or absent) behind which a
provider is chosen at deployment by `DELIVERY_EMAIL_PROVIDER` and
`DELIVERY_PUSH_PROVIDER`. `off` or unset is the honest absence: `GET
/health/delivery` reports both channels absent and `in_product_only: true`,
the API logs it at boot, and the inbox (`NotificationsResponse.delivery`)
tells the member that notifications appear there only and nothing is on its
way to their mail or their phone. **A provider name this build cannot drive
refuses to start**, naming the variable: a typo that silently fell back to
"absent" would be the failure the port exists to prevent, found weeks later
by nobody having been told anything. `DeliveryService.deliver()` carries a
message on every channel that exists and reports each one -- `absent`, `sent`
or `failed`, never a throw that undoes the event -- and the spec drives it
with a capturing channel and a broken one. What waits for the maintainer is
the provider itself (T-074 first), which arrives as a class behind the port,
its name in `KNOWN_*_PROVIDERS`, and the composition of an e-mail and a push
from a notification at the point `emit()` writes the row.

**T-331 done on 2026-09-18.** A mute is a row (`notification_mute`): a team
or a competition by id -- never by name, rule 1, and a name where an id
belongs is refused rather than cast -- or one of three categories,
`football`, `social` and `account`, into which `NOTIFICATION_CATEGORY_OF`
puts every kind exactly once (the spec asserts the partition, so a new kind
cannot arrive in no category and be impossible to silence with its
neighbours). **A team mute silences what is *about* that team's matches,
not a kind**: `notification_about(subject_type, subject_id)` resolves a
fixture, a prediction or a panel post to its match's teams and competition,
and `notification_muted_for()` is the one question emission asks. A friend
request is about nobody's team and passes; a match of two other clubs
passes; the `prediction_settled` switch stays on and reads as the default --
that is the sentence "silence one team without silencing football" made
into four assertions. A category mute is read where the kind preference is
read (`wants()`), beside it and not instead of it, so the per-kind choice is
untouched. The settings page's "What stays quiet" section lists what is
silenced with the club's name, offers a team, a competition and a category
from the catalogue lists, and unmutes with one button; muting is idempotent
and the second unmute is a 404, because "nothing was silenced under that
name" is an answer and a silent 204 is not.

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
| T-310 | decided by delegation (D-069) | agent |
| T-311, T-312 | nothing | agent |
| T-313..T-315 | D-069 | agent |
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
