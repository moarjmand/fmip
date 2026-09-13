# Phase 2 — Depth on football intelligence

Phase 1 built the spine: a canonical match, a forecast, a prediction, a rating,
and pages that say what they do not know. Phase 2 makes the football
intelligence deep enough to be worth returning to — the part of the blueprint
that cannot be faked by a scoreboard.

Read `01-roadmap.md` for why the phases are shaped this way and `00-decisions.md`
before proposing anything that changes a locked decision. The sequencing rule
from the roadmap applies inside every epic: **schema and contracts, then data,
then the backend module with tests, then the published contract, then the
frontend, then observability.** Never start the frontend before the contract is
stable.

---

## What Phase 2 is, in one paragraph

Three of the six areas are new products (Power Index, founder's analysis, news),
two are depth on something that already exists (advanced statistics, forecast
version comparison), and one is a language. They are ordered below so that the
things nothing else depends on come last, and so the work that needs no
purchase and no account comes first — because that is the work that can actually
start.

**Exit criteria.** Every acceptance box below is checked on the public
deployment, with real fixtures, and: the Power Index is computed from validated
weights and states its own completeness; a match centre shows what changed
between two forecast versions and why; a founder analysis is published and
displayed without ever being blended with the model or the crowd; the news feed
groups duplicate reports into one story; and `/ar` renders the full product
right-to-left with no untranslated string presented as translated.

---

## Epic order and what blocks what

```
E10 advanced data ────┬──> E11 Power Index ──> E12 forecast comparison
   (needs a purchase) │
                      └──> (the line-up and manager components only)

E13 founder's analysis      independent, needs nothing
E14 news and clustering     needs a feed source decision
E15 Arabic                  needs a translator; the architecture does not
```

Only **E10** is blocked on money. E11 can be built now to the depth the free data
allows and will gain its missing components the day E10 lands — which is the
whole reason its components are computed and stated separately rather than mixed
into one number.

---

## E10 — Advanced data

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-100 | **Decision gate:** review the bake-off and D-049, buy the chosen paid tier | T-024, D-049 | New entry in `00-decisions.md`; keys in `.env` |
| `[ ]` T-101 | Player-level match statistics: schema, normalised model, adapter support | T-100 | A player's minutes, shots, xG and passing are stored per fixture, or the module says `not_supplied` |
| `[ ]` T-102 | Expected goals on the critical path: ingestion, coverage, display | T-101 | Every finished fixture in a covered competition carries team xG, or says why not |
| `[ ]` T-103 | Injury and suspension availability feed | T-100 | A player unavailable for a fixture is stored with a reason and a source time |

**T-100 is the maintainer's.** No agent buys anything (`CLAUDE.md` §7). Until it
happens D-049 holds: football-data.org for the spine, Highlightly for the
detail, replay for tests. Everything else in Phase 2 is written so that it
degrades honestly without it rather than waiting for it.

---

## E11 — The Power Index

The blueprint's centrepiece (6.1) and the reason the forecast is explainable
rather than an oracle. Seven components, published weights, and a public display
that names the leading factors, the data completeness and the time of
calculation.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-110 | Schema and contracts: `power_index` version, components, completeness | T-064 | A stored index is immutable and recomputable from its inputs |
| `[x]` T-111 | Component computation: strength, form, venue, rest | T-110 | Each component is a number in `[0,1]` with its own coverage state |
| `[ ]` T-112 | Line-up quality and managerial stability components | T-110, T-101 | Present when the data is, `not_supplied` when it is not — never zero |
| `[x]` T-113 | Weight validation against history | T-111, T-062 | The published weights beat the blueprint's defaults on a backtest, or the defaults are kept and the test says so |
| `[x]` T-114 | `GET /fixtures/:id/power-index` and the match-centre panel | T-111 | Shows leading factors, completeness and computed-at; missing components are visible |

**The rule that shapes all of it.** A component nothing supplies is
`not_supplied` and its weight is **redistributed across the components that did
arrive**, with the resulting `completeness` (the share of the blueprint's weight
actually covered) published beside the number. Filling a missing component with
a neutral value would be inventing one — rule 3 — and averaging over a smaller
set while saying so is the honest alternative. On the free data of D-049 the
line-up-quality and manager components are absent, so completeness is about 75%,
and the panel says that rather than implying a complete picture.

**Not arbitrary points.** The blueprint is explicit that the index is not built
by adding fixed points. Every component is a position in a distribution — a
percentile against the competition's own teams that season — so "80" means
"stronger than 80% of this league", which is a statement that can be checked,
not a number that can be argued with.

**T-110 verified on 2026-09-13.** The first Phase 2 task, and the sequencing rule
says schema and contracts first. `..._power-index.sql` adds `power_index`: one
row per team per fixture per formula version per moment, carrying the value, the
components with the weights they were given, the completeness, and an inputs
hash. It hangs off `fixture_participant` rather than `team`, because a Power
Index is about a team *in this fixture* — which is what makes the venue and
congestion components mean anything — and because that makes an index for a team
that is not playing impossible to write.

`packages/contracts/src/power-index.ts` publishes the blueprint's seven
components and their weights, and
`apps/api/src/modules/forecast/internal/power-index.ts` is the arithmetic as a
versioned config in one file, the same shape as the Performance Rating formula
(D-035).

**The decision the whole thing turns on.** A component nothing supplied is
`not_supplied` and its weight is **redistributed across the components that did
arrive**, with the resulting completeness published beside the number.
Substituting a neutral 0.5 would be inventing a value (rule 3) and would drag
every index towards the middle by an amount nobody could see; the test asserts
the two differ. An index with no component at all is not a weak index but the
absence of one: `combine` returns null and the database refuses
`completeness = 0`. (This note first estimated 75% completeness on free data;
T-111 measured it and it is 70% — competition context turned out to be
unmeasurable too, for the reason recorded there.)

**A stored index is immutable and recomputable from its inputs:** the database
refuses UPDATE and DELETE (`refuse_change`, rule 5), refuses a value outside
0–100, an empty component list and a second index for the same side, formula and
instant; and the stored components reproduce the stored value with no access to
whatever measured them — the test recomputes it from the row alone. 11 unit tests
on the arithmetic and the leading factors, 4 against the real schema; the
migration was cycled down and up.

**What is not here.** Nothing measures the components yet — that is T-111, and
T-112 for the two the free data cannot reach. Nothing writes the table outside
the test, and no endpoint serves it (T-114).

**T-111 verified on 2026-09-13.** Five of the seven components are measured, and
the measuring is separated from the arithmetic on purpose:
`internal/power-index-measure.ts` is pure and takes a division's match history
and a team's schedule; `internal/power-index-store.ts` is the SQL;
`power-index.service.ts` joins them and stores the row.

**Each component is a number in `[0,1]` with its own coverage state**, and every
one of them is a *position in a distribution* rather than a score, because the
blueprint forbids arbitrary fixed points:

| Component | Measured as | Ranked against |
|---|---|---|
| `underlying_strength` | goal difference per match over the last 38 | the division's teams |
| `recent_form` | last 6 matches' points, each scaled by the opponent's strength percentile | the division's teams |
| `venue` | points per match **at this fixture's venue** — home record for the home side, away record for the away side | the division's teams on the same measure |
| `rest_and_congestion` | days since the previous fixture and matches in the last fortnight, the **binding** constraint of the two | a published curve, not a population |

Rest is the one component with no meaningful population to rank against (every
team in a free midweek is equally rested), so its curve is written out as named
constants — 2 days is the hardest turnaround, 7 a clear week, 4 matches in a
fortnight fully congested — and it takes the *minimum* of rest and congestion
rather than their average, because a clear week behind four matches is not a
rested team and a mean would quietly say it was. It is never `available`: travel
is the third thing the blueprint names here and we hold no venue coordinates,
so it is `limited` with that as the note.

**The two the free data cannot reach are named, not omitted** — line-up quality
and managerial stability (T-112) — and so is a third the estimate had missed:
**competition context**. Modelling it honestly needs the stakes of this stage and
the team's other commitments, and mapping "knockout" to a fixed number would be
exactly the arbitrary points the blueprint rules out. So a working index on this
data is **70% complete**, and says so, rather than 75%.

**Measured against a real season, not a fabricated one.** The development
training store holds the whole 2024/25 Premier League, and the seed already maps
Manchester United and Liverpool to the names it uses. Computing their index for a
fixture the following August gives:

| | Index | Strength | Form | Venue | Rest |
|---|---|---|---|---|---|
| Manchester United (home) | **25.2** | 0.275 | 0.175 | 0.350 | 0.200 |
| Liverpool (away) | **77.7** | 0.975 | 0.475 | 0.975 | 0.200 |

Liverpool won that title and Manchester United finished fifteenth, so the
separation is the least a strength measure has to get right. The more telling
number is Liverpool's form at 0.475 against a strength of 0.975: they spent the
end of that season with the title already won, and the form component is
measuring something the strength component is not — which is the whole reason
the blueprint asks for both.

**When it declines to answer at all:** a competition with no football-data
division, a division we hold no history for, a team with no training alias. Each
returns `not_measurable` with the reason and writes nothing. An index for one
side and a blank for the other is refused too, because a panel showing that
invites a comparison it cannot support.

Recomputation is a new immutable row (`computed_at` is part of the key), and
recomputing at the same instant is the same computation, not a second one — the
insert is a no-op on conflict. 15 unit tests on the measurement rules, 6 against
the real database; typecheck, lint and Prettier pass.

**What is not here.** No endpoint and no panel yet (T-114), and nothing calls
`compute` on a schedule — the version triggers are T-120.

**T-114 verified on 2026-09-13.** `GET /fixtures/:id/power-index` is public,
because the index is a product surface; `POST` computes and needs the admin
role — the same split the forecast uses (T-065). **A `GET` never computes.** An
index is a statement about a moment, and one created as a side effect of
somebody loading a page would be a statement about when they happened to look.

The response carries an index for both sides or none. An index for one team
beside a blank for the other invites the comparison it cannot support, so the
absence is stated for the pair, with a reason.

**Shows leading factors, completeness and computed-at** — the three things
blueprint 6.1 asks the public display to explain — and the panel says them in
words rather than decimals, because a decimal explains nothing:

- *"Driven mostly by underlying team strength and venue effect."*
- *"70% of the index was measurable. Not included: expected or confirmed
  line-up quality, managerial and team stability and competition context."*
- *"Ahead of 62% of this competition"* for each component, rather than `0.62`.

**Missing components are visible**, and visible as missing: each absent
component keeps its row, its weight and its reason, and gets **no bar at all**
rather than a bar of width zero — a zero-width bar reads as "measured, and it is
bad", which is the opposite of the truth. The footer says the number is a
standing in its competition, not a probability, because 0–100 beside three
percentages that are probabilities would otherwise invite exactly that reading.

8 unit tests on the wording, 4 on the endpoint. The endpoint tests build their
own division too, under a different code from T-111's, so the two cannot collide
in a parallel run — and one of them checks the honest 65% a fixture with no
earlier fixture produces, because rest is then unmeasurable as well.

**What is not here.** Nothing calls `POST` on a schedule, so a match has no index
until an operator asks for one; deciding when to compute is T-120.

**T-113 verified on 2026-09-13.** The blueprint says the calculation "should use
historical performance to validate or adjust these weights". `docs/12-power-index.md`
is the method and the record; `internal/power-index-backtest.ts` is the pure
arithmetic and `apps/api/scripts/power-index-backtest.mjs` drives it.

**The method.** Walk a division's season in order; measure both teams from only
the matches played before that day; combine under each candidate weight set;
record the index gap against what happened. Fit an ordered logistic on the first
half of those observations and score the weights by log-loss on the second half,
which the fit never saw. The baseline is the season's own outcome frequencies —
a weight set that does not beat *that* has found nothing.

**The result (E0, 2024/25, 320 matches after a 60-match warm-up).** Every
candidate beats the base rate of 1.0667, so the index does carry information;
the blueprint's weights and an equal split tie at **1.0064** held out, and the
blueprint's are the most accurate on decisive matches (65.4%). **Verdict: keep
the published weights** — the best alternative improves held-out log-loss by
0.0000, far below the 0.01 that would be a finding rather than noise at this
sample size. The acceptance criterion allows exactly this outcome, and it is the
one that happened.

**The bug worth remembering.** The first version of the fit used raw index
differences, which run to tens of points, with one step size for both the slope
and the thresholds. It diverged, and reported a held-out log-loss of 5.4 against
a base rate of 1.07 — a number that reads as "the Power Index carries no
information" and is in fact "the gradient descent walked away". It was caught
because 5.4 is *too bad to be true* next to a 65% accuracy, not because anything
flagged it. Two things now stop it: differences are standardised so every
parameter lives on the same scale, and `fitConverged` disqualifies any candidate
whose fit cannot beat the outcome frequencies **on its own training data**, so a
failed fit produces "no verdict" instead of a finding. The test suite fits data
whose answer is known and asserts the guard against the exact shape of that
failure.

9 unit tests; the script is run by hand because it needs a loaded training store,
and each run rewrites the table in `docs/12-power-index.md` and keeps the whole
result under `apps/api/backtest/`.

---

## E12 — Forecast versions and what changed

Forecasts are already immutable versions with their inputs and model version
(T-064, rule 5). What is missing is the part a reader actually wants: the
difference between two of them, and why.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-120 | Version triggers: early, confirmed line-up (post-match is T-066) | T-026, T-064 | Each kind is produced once per fixture and named |
| `[x]` T-121 | Version diff: probability deltas attributed to input changes | T-120 | A diff names the inputs that moved and by how much |
| `[x]` T-122 | "What changed" on the match centre | T-121 | A reader sees the change in words, not two tables to compare by eye |

**The honest limit of attribution.** A change in a probability cannot always be
traced to one input, and a panel that claims it can is a fiction. T-121 attributes
what a re-run with one input held constant can attribute, and says "several
inputs changed together" when that is the truth.

**T-120 verified on 2026-09-13.** `internal/forecast-triggers.ts` decides which
version is due and is pure, so "each kind is produced once per fixture" is a
property of a function rather than a hope about a cron;
`forecast-triggers.service.ts` finds the fixtures and carries it out.

Two rules do the work. **Once each:** a kind already recorded is never
recomputed, because a version is a statement about the moment it was made and a
second one would either duplicate it or quietly contradict it. **Never after
kick-off:** the blueprint's versions are pre-match by definition, and what
happens afterwards is the evaluation (T-066), not another forecast. A confirmed
line-up takes priority over an early version that has not been written yet,
because it is the most informative thing that happens before kick-off.

**`lineups_predicted` is deliberately never produced automatically.** Nothing we
have supplies *predicted* line-ups — only confirmed ones, and only from the
detail source of D-049 — so triggering that kind would mean labelling a
confirmed line-up as a predicted one. It stays available to an operator over
HTTP, which is the honest place for a judgement nobody's data can make. The plan
above listed four triggers; there are two, and this is why.

**Where it runs.** Its own tick in the scheduler (`forecast-versions`, every
five minutes), not a sixth ingestion job: producing a forecast is not ingestion,
it asks the model about what we already hold, and it must not appear in
`ingest_run`, which records what a provider was asked for. The Power Index is
computed on the same pass, because the index and the forecast are one statement
about one moment and computing them apart would leave a match centre showing an
index from one hour beside a forecast from another.

Every skip carries a reason, so "nothing happened" is explicable rather than
silent. 6 unit tests on the rules; 3 against the real database, which run the
triggers repeatedly and count rows — a second pass over an unchanged fixture
writes nothing, a line-up arriving produces exactly one more version, and a
kick-off that has passed produces none. The model is deliberately unreachable
in that test: an unavailable forecast is still a version, which makes the test a
statement about the triggers rather than about the model service being up.

**T-121 verified on 2026-09-13.** A forecast version now carries `inputs` — what
the model was working from, verbatim, as it reported it — so the difference
between two versions can be *attributed* to something rather than asserted.
`apps/web/src/lib/forecast-diff.ts` lists every input that moved with its before
and after, and turns it into a sentence.

**The honest limit, which is the whole point.** The blueprint's example is "a
team's win probability fell after a key starter was excluded from the confirmed
line-up". **We cannot say that.** The model is fitted on historical results
(D-009) and does not take a line-up as an input at all, so a `lineups_confirmed`
version is a forecast *computed when the line-up was confirmed*, not one
*computed from the line-up* — and the panel says exactly that whenever it shows
one. Saying it plainly is worth more than a plausible sentence nobody can check,
and it becomes the real thing the day line-ups reach the model (T-101, T-112).

Three cases, and the third matters most. One input moved: name it, with its
before and after. Several moved: say so, because only a re-run with one held
constant could separate them and we did not do that. **Nothing moved:** say that
too, rather than inventing a reason (rule 3). 9 unit tests, one of them
asserting that a confirmed-line-up version can never be described as though the
model had read it.

**T-122 verified on 2026-09-13.** The forecast panel's "What changed between
versions" list already gave each version's probability movement in points
(T-065); it now carries the attribution underneath it, so **a reader sees the
change in words**: what moved, and what — if anything — may be blamed for it.

For a confirmed-line-up version that is always accompanied by the caveat that
the model does not read line-ups yet, because the alternative is letting a
reader draw the conclusion the blueprint's example draws and that our model
cannot support. E12 is complete.

---

## E13 — The founder's analysis

Independent of every data question: nothing here needs a provider.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-130 | Schema: analysis, its versions, its publication state | T-040 | An edit after publication is a new version with a visible time |
| `[x]` T-131 | Authoring API and editor, `founder` role, audited | T-130, T-070 | Only the founder writes; every publish and edit is in the audit log |
| `[~]` T-132 | Surfaces: match centre, homepage, team and competition feeds (the predictions page does not exist) | T-131 | Appears in all five, always attributed and signed |
| `[x]` T-133 | The separation guard | T-132 | A test fails if a founder analysis is ever merged into the model or the consensus payload |

**T-133 exists because rule 6 is easy to break by accident.** The three
prediction products — the statistical model, the founder's analysis and the
community consensus — are never blended or relabelled, and the cheapest way to
keep that true a year from now is a test that fails when it stops being true.

**T-130 verified on 2026-09-13.** `..._founder-analysis.sql` adds
`founder_analysis` (one per fixture, with the author, because the blueprint asks
that each entry be "written and signed personally" — the signature is a row, not
a byline someone typed) and the immutable `founder_analysis_version`.

**An edit after publication is a new version with a visible time.** Every stored
version is published: a draft is not something the product shows, and making it
a row would mean an editable row, which is the one thing this table must not
have. The blueprint asks for "publication time and any clearly recorded update
before kick-off", and that is exactly what a version is.

**And nothing after kick-off.** The same wall predictions meet (T-051,
SQLSTATE `PL002` here), for a stronger reason: an analysis edited once the
result is known is not an analysis, and a public record of calls is worth
nothing if it can be revised in hindsight. The database clock decides, not the
API's, so a script or a skewed server meets the same wall.

The database also refuses a predicted score that contradicts the predicted
outcome — two different calls in one row, and a page would have to choose which
to believe — half a score, a confidence outside 1–5, blank reasoning, and an
optional section that is present but empty (a section that looks written and
says nothing, rule 3). 7 tests against the real schema; migration cycled down
and up.

**T-133 is started, not finished.** `packages/contracts/src/three-products.spec.ts`
already guards rule 6 where the shapes live: the three products keep separate
files, none imports another, neither payload may carry the other's types, the
word "prediction" stays out of the founder contract (relabelling is the other
half of rule 6), and the three may not be enumerated as interchangeable kinds.
The guard was checked by breaking it on purpose — three of its four tests fail
the moment a `ForecastVersion` appears in the founder contract. It stays `[~]`
until T-132 exists, because the rendered payloads are the other place the three
could blend.

**T-131 verified on 2026-09-13.** `apps/api/src/modules/founder/` is its own
boundary rather than a corner of the forecast one, and that *is* the point: two
of the three prediction products living in separate boundaries is what makes
blending them a deliberate act rather than an accident (rule 6).

**Only the founder writes.** `GET` is public — it is one of the three things a
reader comes for — and `POST` needs the **`founder`** role, deliberately not
`admin`. An administrator can change coverage and suspend accounts, and none of
that should carry the right to publish under the founder's name; the role list
has had `founder` in it since T-040 for exactly this. A guest gets 401, a member
403.

**Every publish and edit is in the audit log**, written in the *same
transaction* as the version (D-046): an editorial act visible in the product but
absent from the log is the gap the rule exists to close, and two statements
outside a transaction leave it open on any error between them. `founder.publish`
for the first version, `founder.update` for each one after, with the previous
version as `previous`.

The service is thin on purpose. The rules that matter — versions rather than
edits, nothing after kick-off, a score that cannot contradict its outcome — are
in the schema, where no future caller can route around them; what is left here
is turning the database's refusal into a **409**, because the request was well
formed and simply arrived late. Validation names every bad field at once, with
one substantive rule of its own: reasoning of at least 40 characters, because an
analysis is the reasoning and a fragment beside a score is a prediction.

The editor at `/[locale]/founder/[fixtureId]` is a plain server-action form —
the blueprint's list of sections, no client state, works without JavaScript. It
re-implements nothing: the field errors are the API's, and a match that has
started shows the wall instead of a form. Published versions are listed under
it, newest first. 7 validation tests, 6 over HTTP.

**T-132 verified on 2026-09-13; open on one of the five surfaces.** The
blueprint names five places a founder analysis appears. **Four of them exist**
and now carry it:

| Surface | What it shows |
|---|---|
| Match centre | the full analysis, every section, all its versions |
| Homepage | the three nearest, as excerpts |
| Team page | the three nearest involving that team |
| Competition page | the three nearest in that competition |

**The fifth does not exist.** There is no predictions page — the blueprint's
section 6 describes one, but nothing in Phase 1 built it, and predictions live
on the match centre and in a member's history instead. So the task stays `[~]`:
the work is done everywhere it can be done, and claiming five out of five would
be the kind of quiet rounding-up rule 3 is about. A predictions page is a task
nobody has written yet.

**Always attributed and signed.** Every rendering carries the author's name and
the publication time — the panel, the feed entry, and each older version in the
panel's history. The blueprint asks that each entry be written and signed
personally, and on a page showing three prediction products the signature is
also what separates this one from the other two.

One endpoint, `GET /founder-analyses?limit=&team=&competition=`, feeds all three
feeds. Upcoming matches only: a feed of what to read next must not carry a call
whose result is already known. Feed entries are excerpts with a link, because a
feed that reprinted the analysis would make the match centre pointless and would
put a signed opinion in front of readers who did not choose to read it. A bad
filter is ignored rather than rejected — this decorates a page that has its own
subject, and a stray query string must not take down a team page over a
decoration.

**T-133 is finished.** The guard now covers both places the three products could
blend: `packages/contracts/src/three-products.spec.ts` on the shapes, and
`apps/web/src/components/three-products.spec.ts` on the surfaces — each product
rendered by a component that can only render that one, no `source` prop, no
union of the three as a kind, the founder panel labelled as one person's view,
and the match centre rendering them as separate sections. Both guards were
checked by breaking them on purpose: three of the four contract tests fail the
moment a `ForecastVersion` appears in the founder contract, and the surface
guard fails on the same import in the panel. E13 is complete apart from the one
surface that has no page.

---

## E14 — News and story clustering

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-140 | **Decision gate:** where news comes from, and under what licence | — | New entry in `00-decisions.md` |
| `[ ]` T-141 | Article schema: canonical story, per-language version, entity links | T-140 | An article links to its match, teams, players and competition by UUID |
| `[ ]` T-142 | Ingestion and deduplication into story clusters | T-141 | Duplicate reports of one event become one cluster with a promoted original |
| `[ ]` T-143 | Sections: latest, trending, debate, following | T-142 | Trending is computed from qualified signals, not raw views |
| `[ ]` T-144 | Article page and filters | T-143 | Carries every field blueprint 3.3 requires, including corrections |

**T-140 first, and it is a real decision, not a formality.** News is other
people's copyright. A feed is licensed, or syndicated with rules, or it is
scraping — and `CLAUDE.md` §7 says anything involving licensing stops and asks.
No article ingestion is written before that entry exists.

---

## E15 — Arabic

The first real use of the right-to-left work done in Phase 0 (rule 7), and the
first test of whether the translation architecture of blueprint 13 is real.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-150 | The `ar` locale: routing, formatting, plurals, football glossary | T-007 | `/ar` renders every Phase 1 page |
| `[ ]` T-151 | Translation workflow: source of truth, review state, missing-string policy | T-150 | An untranslated string is visibly untranslated, never machine output presented as a translation |
| `[ ]` T-152 | Search across transliterations and aliases | T-038, T-150 | Arabic and Latin spellings of the same player both find them |
| `[ ]` T-153 | Right-to-left audit on real content | T-150 | Scores, timelines, icons and numerals behave; the pseudo-locale test is no longer the only proof |

**What an agent cannot do here.** Translate. Producing Arabic strings by machine
and shipping them as the product's Arabic is exactly the kind of invented content
rule 3 forbids, and a football glossary is a judgement a fluent speaker makes.
The architecture, the workflow, the fallback behaviour and the right-to-left
correctness are all buildable now; the strings are the maintainer's to source.

---

## What can start today, and what cannot

| Work | Blocked on | Who |
|---|---|---|
| T-110, T-111, T-113, T-114 | nothing | agent |
| T-120, T-121, T-122 | nothing | agent |
| T-130, T-131, T-132, T-133 | nothing | agent |
| T-150, T-151, T-152, T-153 | Arabic strings for T-151 | agent, then maintainer |
| T-100 | a purchase | **maintainer** |
| T-101, T-102, T-103, T-112 | T-100 | after the purchase |
| T-140 | a licensing decision | **maintainer** |
| T-141..T-144 | T-140 | after the decision |

Two-thirds of Phase 2 needs nobody's permission. That is deliberate: the epics
were ordered so that the money and the licence sit in front of the smallest
possible amount of work.
