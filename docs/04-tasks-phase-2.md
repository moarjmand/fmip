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
| `[x]` T-132 | Surfaces: match centre, homepage, team and competition feeds, the Predictions page | T-131 | Appears in all five, always attributed and signed |
| `[x]` T-133 | The separation guard | T-132 | A test fails if a founder analysis is ever merged into the model or the consensus payload |
| `[x]` T-134 | Community consensus: the crowd distribution and the rating-weighted one | T-053, T-133 | Both distributions, or an explicit coverage state; never one of them twice |
| `[x]` T-135 | The community forecast on the match centre | T-134 | Both distributions and the comparison blueprint 4.2 asks for, with nothing averaged |
| `[x]` T-136 | Listing each product across fixtures: the data the Predictions page needs | T-134 | Each product answers for a set of fixtures from its own endpoint; no payload carries two of them |
| `[x]` T-137 | The Predictions page | T-136 | All four of blueprint 2.1 on one page, each attributed |

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
guard fails on the same import in the panel.

**And then the guard turned up what it was guarding.** Writing T-133 meant
reading rule 6 closely enough to test it, and rule 6 names three products. Two
of them were built. The third — the community consensus — existed in the rule,
in the blueprint (2.1, 4.2 and 6.6), and in the assertions of this very test,
and nowhere in the code: no endpoint, no contract, no table it read. The guard
had been protecting the boundary of a payload nobody had written. **T-134 and
T-135 are that gap**, added to the plan on 2026-09-13 rather than left as a
sentence in a review.

**T-134 verified on 2026-09-13.** `GET /fixtures/:id/consensus` returns the two
distributions blueprint 6.6 asks for, out of the standing version of each
member's prediction — the same version settlement judges, so a member who
resubmits counts once rather than twice. `packages/contracts/src/consensus.ts`
is its own contract and imports neither of the other two products; the guard in
`three-products.spec.ts` now covers all three.

**The two judgements are in D-052**, because neither is in the blueprint and
both decide what the product claims. Only *established* raters weight the second
distribution, so a rating that means "not known yet" never becomes a
coefficient; and nothing is published below five predictors, because a
percentage over three people reads as a finding and because an aggregate that
small is a way to read one member's prediction they may have chosen to hide
(T-056). Where the weighted distribution cannot honestly be built it is `null`
and the module is `limited` — never the crowd distribution returned again under
the other label, which is precisely the disguise 6.6 forbids and would be
invisible from outside. 13 tests, 6 of them against the real schema.

**T-135 verified on 2026-09-13 — the match-centre half of it.** Blueprint 4.2's
"Community forecast" bullet asks for three things: registered-user predictions,
the rating-weighted consensus, and *comparison with the model*. All three are on
the match centre now, and the comparison is where the care went.

**A comparison is a difference, not a blend.** The panel receives the model's
three probabilities as plain numbers the page pulled out — `Triple` in
`lib/triple.ts` is three anonymous values belonging to neither product — and
renders the gap outcome by outcome with both sides named. There is no average
and the guard now fails on a function called one. Two products that disagree are
information; a combined number would destroy that while inventing a figure
nobody computed.

**The arithmetic moved rather than being copied.** Rounding three shares to
total exactly 100 is the same operation for a crowd as for the model, but
`percentages(p: ModelProbabilities)` is typed to one product, and calling it
from the community panel would have put a model type on the community surface.
Duplicating it would have been worse. It lives in `lib/triple.ts` now and
`lib/forecast.ts` delegates.

**The guard was checked by breaking it**, as T-133's was: giving the panel a
`ModelProbabilities` prop fails `three-products.spec.ts` immediately.

**The end-to-end check is at the dangerous point.** Journey 18.1 registers a
member and has them predict; the new assertion goes straight to that match and
proves the page says there is *no consensus yet*. One member is not a community,
and with a sample of one a published distribution would also be that member's
prediction on display (T-056).

**E13 is complete**, and it grew while it was being built: the epic began as four
tasks about the founder's analysis and ends as eight, because writing the rule-6
guard (T-133) meant reading the rule closely enough to test it, and the rule
names three prediction products of which only two existed. T-134 to T-137 are
that gap — the community consensus and the page where all three meet.

**T-137 verified on 2026-09-13, and with it T-132 and T-135.** `/[locale]/predictions`
is the page blueprint 2.1 names, and the fifth founder surface — so T-132, which
had been `[~]` since the founder's analysis shipped for want of this page, is now
honestly `[x]`.

**Four sections, not one feed.** This is the one page where all three prediction
products appear together, which makes "today's predictions, ranked, each tagged
with where it came from" the obvious design — more compact, better reading, and
exactly what rule 6 forbids. Each product is rendered by a component in its own
product's file, from an endpoint that serves only that product; the guard checks
the page for the three components and against a `PredictionRow` or a `source`
field.

**A section that disappears is not an honest empty state.** The founder feed
renders nothing when it has nothing, which is right on the homepage and wrong
here: the page promises four things, and a vanishing section leaves a reader
unable to tell whether the founder has written nothing or the site forgot to ask.
Caught by rendering the page rather than by a test — the heading was simply
missing from the output. Every section now states its own absence: the model has
no forecast for these matches, no match has five predictions yet, the founder
writes for selected fixtures.

**Checked against a running stack**, not only in types: the API rebuilt on 3002
and `next dev` on 3100, `/en/predictions?date=2025-01-05` rendering all four
sections and `/ar/predictions` rendering right-to-left with the new `nav.predictions`
key correctly marked `untranslated` (T-151). 121 web tests.

**T-136 verified on 2026-09-13.** `GET /forecasts?fixtures=` and
`GET /consensus?fixtures=` answer for a set of fixtures in one query each.

**Two endpoints rather than one, deliberately.** A single "predictions
overview" returning the model's forecast and the community consensus together
would have been shorter to write and shorter to call, and it is exactly the
shortcut rule 6 exists to prevent: one payload holding two products is one
refactor from one payload with a `source` field, and then nobody can tell a
reader which of the three they are looking at. Each product answers for itself
from its own module; composing them is the page's job.

**The bug the test was written for.** `versions` is ordered oldest first, so a
list reaching for `versions[0]` would serve the forecast the model has already
replaced — correct-looking, wrong, and invisible unless something checks. The
same mistake was made and caught in T-135's match-centre wiring, which is why
the spec asserts the second version's id specifically rather than that a
forecast came back.

**What each endpoint refuses.** A malformed id is a 400 rather than a silent
omission — dropping it would give a caller with one typo a shorter list and no
way to see which match fell out. A fixture that does not exist is left out of
the consensus list (answering for an unknown id teaches a caller that every id
is valid), while a fixture the model has no answer for comes back with `latest`
null (omitting it would make "the model has nothing" indistinguishable from "no
such match"). Both cap at 50 fixtures: past that it is a different question
being asked the wrong way, and an uncapped list is one query from scanning every
prediction ever made. 21 consensus tests, 11 forecast tests.

**T-135 stays `[~]`.** The match centre has it; the Predictions page blueprint
2.1 names still does not exist, and it is now **T-136** with its own row rather
than a parenthesis on someone else's task. The page needs something this PR does
not build: the model forecast and the consensus are per-fixture endpoints, so a
page listing several matches would fetch them one at a time. Doing it honestly
means list endpoints first — **T-136**, with the page itself now **T-137**.
Pretending otherwise is how a page ends up making N requests or quietly showing
less than it claims.

---

## E14 — News and story clustering

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-140 | **Decision gate:** where news comes from, and under what licence | — | New entry in `00-decisions.md` |
| `[x]` T-141 | Article schema: canonical story, per-language version, entity links | T-140 | An article links to its match, teams, players and competition by UUID |
| `[x]` T-142 | Ingestion and deduplication into story clusters | T-141 | Duplicate reports of one event become one cluster with a promoted original |
| `[x]` T-143 | Sections: latest, trending, debate, following | T-142 | Trending is computed from qualified signals, not raw views |
| `[ ]` T-144 | Article page and filters | T-143 | Carries every field blueprint 3.3 requires, including corrections |

**T-140 first, and it is a real decision, not a formality.** News is other
people's copyright. A feed is licensed, or syndicated with rules, or it is
scraping — and `CLAUDE.md` §7 says anything involving licensing stops and asks.
No article ingestion is written before that entry exists.

**Settled on 2026-09-15 (D-061).** Free publisher feeds, and only what a feed
carries for that purpose: headline, the publisher's own summary, byline, time,
and a link to the original -- never the body, never paywalled content, never
re-hosted images. Every item names its publisher and links to them; a publisher
who asks to be dropped is dropped.

**So the news section is a front page that sends readers away**, and T-144 is
built against that rather than against an article page with nothing to put in it.

**Rights live on the source and surfaces obey them**, which is the maintainer's
second instruction -- the ability to take a licensed source later, built in now.
A `news_source` says what may be shown, the renderer asks instead of assuming,
and a licensed wire feed arrives as an adapter and a rights row. T-141 carries
that field from its first migration, because a rights model retrofitted after
there are two kinds of source is retrofitted too late.

**T-141 shipped on 2026-09-18, and the rights field is a trigger, not a
column somebody remembers.** Six tables. `news_source` carries `rights` --
`headline`, `summary` or `full_text` -- and `article_version_within_rights()`
refuses, at the write and with its own SQLSTATE (`PL016`), a version that
carries more than its source grants: a summary on a headline-only source, a
body on anything but a full-text one. Today every source is a free feed; the
day a licensed wire arrives it is a rights row and an adapter, and no renderer
has to be taught anything, because none of them decides.

`article` is the identity -- source, story, the feed's own id, the original's
URL -- and `article_version` is what is shown, one per language, immutable,
with a change being a new version so "what did it say before" always has an
answer. `article_entity` is (article, type, id) and nothing else: the spec
reads `information_schema.columns` and asserts there is no name column to
put a team's name in. `story` exists from the first row so T-142 clusters into
something rather than grouping after the fact; `article_correction` is the
dated, immutable note blueprint 3.3's page shows. A source that goes away
takes its own articles, versions and links and nothing else -- asserted by
deleting one and counting what the other still has.

**And immutability had to be narrower than `refuse_change()` here, on
purpose.** A forecast version is never deleted; an article version goes with
its article, because a publisher who asks to be dropped takes their words
with them (D-061), and a version that could not be deleted would keep those
words on a site they asked to leave. `refuse_change_unless_article_gone()`
refuses every update and every delete except the one that arrives because
the article is already gone -- during a cascade the parent row is deleted
first, which is exactly the test. Marking a source dropped (`dropped_at`,
with a reason the constraint insists on) removes its articles by trigger; the
source row stays as the answer to "why is X not here". Found by the spec:
the first cascade test failed on `refuse_change()`, which was the trigger
telling the truth about a rule that was the wrong rule for news.

T-142 through T-144 are unblocked; the schema they need is the one above.

**T-142, first piece, on 2026-09-18: the feed reader.** `packages/ingestion/
src/news/feed.ts` reads RSS 2.0 and Atom by hand -- a handful of elements
inside `<item>` or `<entry>` -- over the same `Transport` seam every adapter
uses, so the job never reaches for `fetch` and a test never reaches for the
network. What it takes from a feed is exactly what D-061 permits, and the
rights model is in the type rather than in a check: `NormalisedNewsItem` has
no body field, so there is no code path that could store one; the RSS sample
in the spec carries a full `content:encoded` and the result is asserted not to
contain it. Nothing is guessed (rule 3): a missing summary, byline, time or
language is `null`, never the fetch time or the site's language; an entry
with no headline or no link is skipped and counted. A JSON answer, an HTML
error page or an empty body is `malformed`, not an empty feed; a feed with no
items is a feed with no items. No dependency was added: a feed is small
enough to read by hand, and a parser would have hidden the one thing that
matters -- what is taken.

**T-142, second piece: the job.** `apps/api/src/modules/news/` reads every
active source on an hourly schedule (the same `INGESTION_SCHEDULE=on` gate
as the football jobs, its own queue). Every attempt is a `news_fetch` row --
one open run per source by a partial unique index -- so a feed that stops
answering is a fact in a table rather than a silence. `robots.txt` is fetched
first and honoured: the group written for `fmip-news` wins over `*`, the
longest rule wins inside a group, and a missing file allows everything, which
is what the standard says. A refusal -- robots, a 404, a body that is not a
feed -- is a `partial` run naming the reason, never a thrown error. The
source's rights are applied **before** the write, so a headline-only source
never has its summary stored and the database's PL016 is the guard that does
not fire in normal operation. A version is written only when the feed's words
changed: running twice over the same feed writes nothing the second time, and
a changed headline is version 2 with version 1 still there. Reading real feeds
also corrected T-141: a publisher who gives no time gives no time, so
`published_at` is nullable now, and the fetch time stays where it means what
it says.

**T-142, third piece, and done: where a report belongs.** After every
version written, `NewsClusteringService.place()` links the entities the
headline names and, for a report seen for the first time, looks for the story
it duplicates. Linking is a whole-word match of the entity's own name or a
recorded alias, folded by `search_key` (rule 1: by id, never by guess), and a
name shorter than five letters after folding links nothing -- "Roma" and
"Ajax" are words a headline can carry without meaning the club, and the alias
table is where a longer form belongs. A person is never linked: surnames are
too common to link on without a guess. The match follows from the teams: when
exactly one fixture between the linked teams kicks off within two days of the
article's time, the article is about it, and two candidates link none.

**Clustering is narrower than it could be, on purpose.** Two reports become
one `story` only when they link exactly the same teams, come from different
publishers, fall within two days of each other, and still read alike once the
names are taken out. That last step was the finding: with the names left in,
"Testville 2-1 Otherton: late winner" and "Otherton sack manager after
Testville defeat" scored 0.52 on trigram similarity, above any threshold that
would also catch a reworded duplicate, because the two long names *are* most
of both headlines. With every name and alias of the linked entities removed,
duplicates score 0.55-0.68, independent write-ups of one match 0.24-0.31 and
different events 0.09 at most; the threshold is 0.4, so the independent
write-ups stay apart. A duplicate left apart costs a reader one repeated
headline; a story wrongly merged hides a report behind another publisher's
original, and of the two mistakes the first is the one to make. The original
(`story.promoted_article_id`) is the earliest published report, then the
earliest fetched, and a story of one report is its own original, so the
column always answers; the story a joined report was born with is deleted in
the same transaction. The http spec grows the two clubs, an alias and the
match between them for the run, and asserts the links, the promotion, the
merge and the event that stays apart.

**Known limits, for T-143 to meet rather than guess around:** an article
whose headline names no team is never clustered; a headline corrected to name
a team gains the link but keeps its story; a source dropped under D-061 takes
its articles and can leave a story whose `promoted_article_id` points at
nothing, so a reader must treat that column as a pointer, not a fact.

**T-143, first piece, on 2026-09-18: the API.** `GET /news?section=latest|
trending|debate|following` with `country`, `competition`, `team` and
`language` filters (blueprint 3.2) and `before` to page latest and following.
Every section starts from the same card -- a story as its promoted original,
from a publisher that still grants it, carrying only what the source's rights
allow and a link back -- and differs in what it joins and how it orders. The
filters apply to the whole cluster: a story about a team is a story any of
whose reports links the team, so a filter never hides a story because the
original named the club differently.

**Trending is computed from qualified signals, not raw views, and says so.**
The blueprint names views, saves, shares and discussion; the platform
measures discussion, so trending ranks stories by how many *distinct* members
posted or reacted on the public panel of the story's matches inside 48 hours
-- once per member, so one person cannot trend a story alone -- and the
section's coverage is `limited` with the reason `discussion_only`. Views,
saves and shares are not pretended (rule 3); when they are measured, the
coverage becomes `available` and the reason goes.

**Debate is what editors selected.** `story_debate` is a row with an actor
and a note the reader sees, cleared by another actor with a reason, one open
selection per story -- not a flag on `story`, because a flag has no history
and no author. "Or supported by genuine discussion signals" is not built:
those signals are what trending already ranks by, and a second section
computed from the same numbers would be the same list under another name.
When nobody has selected anything the section says `nothing_selected`.

**The editor's half is in the same PR:** `POST /admin/stories/:id/debate`
with the note readers see, `POST .../debate/clear` with a reason, and `GET
/admin/debates?state=` to see both -- the `editor` role, which existed in
`UserRole` and was granted nowhere before this, or `admin`. Each decision is
an `audit_log` row (`debate.select`, `debate.clear`, target type `story`)
written in the same transaction (rule 10), with the previous selection's note
beside the new one so a re-selection after a clear remembers what was there.
Selecting an already-selected story is refused rather than re-noted: changing
the words on the page is a clear and a select, two decisions with two
reasons. Not a `DELETE`, and the method is the argument: a cleared selection
stays as the record of what was on the page and who took it off.

**Following is answerable only for a member.** For a guest the section is
`not_supplied` with `needs_session` -- not an empty list, not a 401: the page
is still a page with one section that says what it needs. The follows come
from the profile boundary's public service, never from `followed_entity`
directly. `last_updated_at` is when the feeds were last read (rule 4).

**Not in the filters yet:** player (no article links a person, by T-142's
own rule), story type (no such concept exists) and date beyond `before`.
Each is a line here rather than a parameter that would return everything.

**T-143, second piece, and done: the page.** `/news` is one page with four
views (`?section=`), the filters as a plain GET form -- country, competition
and team from the catalogue lists, language from the site's own locales --
and `Older` as a link carrying `before`. Every reason the API can give is a
sentence in the catalogue (`REASON_KEY` is `Record<NewsSectionReason, …>`, so
a new reason fails the build until it has one), rendered where the list would
be; a guest's following section says it needs a session and links to sign in.
The page states when the feeds were last read and, past three hours -- three
missed hourly reads -- says the list may be behind (rule 4). A card is the
publisher's headline as a link to the original, their name as a link to their
site, the byline and the publisher's time or "time not given" (never the
fetch time in its place), the summary when the source grants one, the linked
entities as chips to their own pages, and how many other publishers reported
it. The card is `lang`-tagged with the version's language, so a French
headline on an Arabic page is read as French.

**The editor's controls are on the same page, not an admin page of their
own.** An editor finds a story by reading, so "select for debate" belongs
beside the story: an `ActionForm` per card with the note readers will see, or
a clear with a reason. The session carries no roles, so the page asks the
editor's own list (`GET /admin/debates`) once and draws the controls only when
it answered -- the API is the authority either way, this only decides what is
drawn. A new reason for latest, `nothing_yet`, came from writing the journey:
an unfiltered empty list is not "no story matches these filters".

`tests/e2e/journeys/news.spec.ts` walks the seed, which carries no publisher
feed -- the state worth checking: every section says what it holds and why,
a guest's following asks for a session, a filter that matches nothing says
so and clears.


---

## E15 — Arabic

The first real use of the right-to-left work done in Phase 0 (rule 7), and the
first test of whether the translation architecture of blueprint 13 is real.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[~]` T-150 | The `ar` locale: routing, formatting, plurals, football glossary | T-007 | `/ar` renders every Phase 1 page |
| `[x]` T-151 | Translation workflow: source of truth, review state, missing-string policy | T-150 | An untranslated string is visibly untranslated, never machine output presented as a translation |
| `[x]` T-152 | Search across transliterations and aliases | T-038, T-150 | Arabic and Latin spellings of the same player both find them |
| `[x]` T-153 | Right-to-left audit on real content | T-150 | Scores, timelines, icons and numerals behave; the pseudo-locale test is no longer the only proof |

**What an agent cannot do here.** Translate. Producing Arabic strings by machine
and shipping them as the product's Arabic is exactly the kind of invented content
rule 3 forbids, and a football glossary is a judgement a fluent speaker makes.
The architecture, the workflow, the fallback behaviour and the right-to-left
correctness are all buildable now; the strings are the maintainer's to source.

**T-151 verified on 2026-09-13, and T-150 started.** The order in the plan was
the wrong way round: adding a locale before the missing-string policy exists
means either shipping blanks or shipping English pretending to be Arabic. So the
policy came first, and the locale followed it.

**An untranslated string is visibly untranslated.** `i18n/messages.ts` is the
catalogue and the lookup; `message()` returns the text *and* where it came from
— `source`, `translated`, or `untranslated`. The `<Translated>` component
renders the English fallback wrapped in `lang="en"`, which is not decoration:
it is what HTML already provides for, so a screen reader switches pronunciation
instead of reading English with Arabic phonetics, a browser's translation offer
knows what it is looking at, and anyone inspecting the page can see that nobody
has translated it yet. The site header is converted as the worked example.

**Never machine output presented as a translation.** The Arabic catalogue
contains two entries, and both are the kind of thing that is not translation: a
language's own name. Everything else waits for a fluent speaker — producing
Arabic by machine and shipping it as the product's Arabic would be inventing
content, and a football glossary is a judgement blueprint 13.1 gives to a person.

**The source of truth** is the English catalogue: a key that is not in it does
not exist, and asking for one is a type error rather than a blank on a page.

**`ar` routes and renders right-to-left**, so a translator can see their work in
place. It is deliberately **not indexable** and not offered as a language the
product speaks until its catalogue reaches 95%: a page that looks translated and
is not is the language version of faking coverage, and offering it to a search
engine would be that lie told at scale. `UNFINISHED_LOCALES` is what carries
that, separate from the pseudo-locale, because the two need different answers
about indexing and about when they are done.

**T-150 stays `[~]`,** and honestly so. `/ar` renders every page, but it renders
them in marked English: the acceptance criterion is met in routing and direction
and not in language. What remains is the rest of the strings moving into the
catalogue — a mechanical conversion, one surface at a time — and then the Arabic
itself, which is the maintainer's to source. 24 i18n tests.

**T-152 verified on 2026-09-13.** T-038 already searched aliases, and
`entity_alias` already held right-to-left spellings — the seed has Persian
transliterations for six teams. So the question was not whether the mechanism
existed but whether it worked, and measuring it found a gap.

**The gap, measured.** The seeded Persian alias for Manchester United is
`منچستر یونایتد`. Typed with the Arabic letter forms — `منچستر يونايتد`, which
differ only in characters that look nearly identical on screen — it scored
**0.467** against that alias, against a 0.45 threshold. That is a near-miss, and
a near-miss is worse than a clean failure: it works for one name and not the
next, and nobody can tell why.

**The fix** is what `unaccent` already does for Latin, applied to Arabic script:
`search_key` now folds the yeh, kaf, alef, heh and waw variants, the Arabic-Indic
and Persian digits, and drops tatweel and the harakat — marks that are optional
in writing and almost never typed into a search box. `..._arabic-search-key.sql`
replaces the function and rebuilds the six indexes built on it, because
replacing the function makes every stored entry wrong. Rebuilding the unique
index can fail, and that failure is information: two aliases of one entity that
differ only in letter forms are the same alias twice.

**What is deliberately not claimed.** Folding is not transliteration. `ليفربول`
still does not find `Liverpool`; that needs an alias, which is what
`entity_alias` is for. A rule that guessed across scripts would produce matches
nobody could justify, and the test asserts that an unrelated Arabic word finds
nothing.

One test caught itself being wrong: the first version of the negative case
included the run suffix, so it matched on a shared token rather than on the
Arabic, and passed for the wrong reason. 4 tests on the script handling, 13 in
the search module.

**T-153 verified on 2026-09-13, and it found a real bug.** The pseudo-locale
check proved one accent bar on a page with no data. That was the right first
canary and it was not enough: the things that break under right-to-left are the
things with real content in them.

`tests/e2e/journeys/rtl-content.spec.ts` runs against **`/ar`** with the API,
the database and the seed behind it, and asserts *geometry* — where things
actually landed — rather than screenshots, which fail on a font hint and teach
everyone to ignore them.

**What it found.** On the match centre, the score rendered **backwards**. `2 – 1`
is two numbers with a neutral character between them; inside a right-to-left
paragraph the bidirectional algorithm resolves that neutral to the paragraph's
direction, splits the run and lays the two halves out right to left. The first
digit measured 48 pixels to the *right* of the last. It is invisible in review,
it passes every unit test, and it would have told every Arabic reader the wrong
result.

**The fix is one component, not an attribute to remember.** `components/score.tsx`
renders a score inside `dir="ltr"`, and `ltrIsolate()` does the same with Unicode
isolates for the places a score is built as a string inside a larger label. A
score is a number pair and reads left to right in every script, for the same
reason a date or a phone number does. Every score on the product now goes
through one of the two: the match centre header, half-time, aggregate and
penalties, the head-to-head lines, the scores list and its aggregate, the team
and player pages, the forecast panel's scorelines and result, the prediction
history, and both founder-analysis surfaces.

**Also asserted:** `/ar` is an Arabic right-to-left document and is not indexed
while it is untranslated; the match header mirrors, so the home side moves to the
right; the status stays inside its header; and the scores page does not overflow
horizontally, which is how a stray physical margin usually shows up.

The score test was checked against the unfixed code and fails there — the bug is
what it was written from, not a guess. 5 journey tests; the 6 pseudo-locale tests
still pass.

**One verification limit, stated plainly.** The production web build does not
complete on this machine (a pre-existing failure on `main`, unrelated to this
work — `/_global-error` fails to prerender), so the audit was run against the
development server rather than the production build the CI job uses. The geometry
it measures is layout, not the CSS-pipeline difference that motivated the
production-build note in `playwright.config.ts`; CI runs the same spec against
the production build.

---

## What can start today, and what cannot

| Work | Blocked on | Who |
|---|---|---|
| T-110, T-111, T-113, T-114 | nothing | agent |
| T-120, T-121, T-122 | nothing | agent |
| T-130..T-137 | nothing | agent |
| T-150, T-151, T-152, T-153 | the Arabic strings themselves | agent, then **maintainer** |
| T-100 | a purchase | **maintainer** |
| T-101, T-102, T-103, T-112 | T-100 | after the purchase |
| ~~T-140~~ | ~~a licensing decision~~ | **decided 2026-09-15, D-061** |
| T-141..T-144 | ~~T-140~~ | unblocked |

Two-thirds of Phase 2 needs nobody's permission. That is deliberate: the epics
were ordered so that the money and the licence sit in front of the smallest
possible amount of work.
