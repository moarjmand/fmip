# Phase 5 — Intelligence layer

Phase 1 built a member who predicts. Phase 2 built the football intelligence
worth predicting against. Phase 3 built the part where members reach each
other. Phase 4 took the product to people it had not met. Phase 5 is where a
language model is allowed near any of it, and the phase is shaped by one
question: **what may a machine say on this product, and how does a reader
know it was a machine?**

The roadmap named four features and one reason for waiting: match summaries,
natural-language search over football entities, personalised briefings and
moderation assistance, deferred until the canonical data model and the
reputation signal existed. They exist. What the wait bought is the thing this
plan is built on: every one of the four can be **grounded** -- fed nothing but
rows the product already stands behind -- and **labelled** -- shown as machine
text, with the model and the time beside it -- because the record it speaks
from is there to check it against.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**One blocker, and it is the same shape as T-330's.** A language model is a
provider behind a port, chosen at deployment by a credential on a server. The
port, the rules, the schemas, the grounding and every honest-absence path are
buildable with nothing from the maintainer; the key is theirs (`CLAUDE.md`
§7), and until it exists `/health/intelligence` says the model is absent and
every surface in this phase says so in a sentence rather than showing a blank.

**The four rules of this phase, written once (D-070).** A machine's text is
*labelled* as a machine's wherever it appears, with the model that wrote it
and when. It is *grounded*: the prompt carries only facts the product already
serves under a coverage state, and the answer is checked against them before
anybody sees it -- a name or a number the record does not hold is a rejection,
not a summary. It is *versioned*: every generation is a row with its inputs,
model, prompt version and time, never overwritten, exactly as a forecast is
(rule 5). And it is *off the critical path*: a match, its score, its forecast
and a member's prediction never wait for a model, and no model output is ever
blended into the three prediction products (rule 6). Machine translation stays
out (T-151): a language model in this phase writes about football, never in
somebody else's voice.

**Phase 4 is not finished** where it is the maintainer's: translators, the
native app, the delivery provider. None of it blocks this phase, and this
phase blocks none of it.

---

## What Phase 5 is, in one paragraph

Four bands behind one port. **The port** (E40) is the language model as a
provider chosen at deployment, with an honest absence and the rules every
surface obeys. **Match summaries** (E41) turn the match record into a few
paragraphs a reader can check against the timeline beside them. **Search**
(E42) lets a member ask in a sentence and answers with the entities the
sentence names, through the search the product already has. **Briefings**
(E43) write the Following feed's window as a dated page, and one day deliver
it. **Moderation assistance** (E44) suggests a category and a reason to a
moderator who decides, and never decides for them.

---

## Exit criteria

Blueprint 19 has no line for this phase; these are the roadmap's four features
stated as tests, checked on the public deployment:

- A finished match carries a summary a reader can check line by line against
  the timeline and statistics on the same page, labelled as a machine's, with
  the model and the time; a match with no record carries none, and says so.
- A question typed into search finds the team, competition, player or match
  it names, and says how it was read; a question the model cannot read falls
  back to the search that exists, visibly.
- A member's briefing is their own feed's window in prose, and every sentence
  in it points at an item that is in the feed.
- A moderator sees a suggested category and reason beside a report, takes
  their own decision, and the audit row records both.
- With no model configured, every one of the four surfaces says so in a
  sentence, and nothing on the critical path changes.

---

## E40 — The port, and the rules

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-400 | **Decision gate:** a language-model provider and a key on the server | T-074 | The key exists on the server and `/health/intelligence` says `configured`; nothing in chat, nothing in a file the agent writes |
| `[x]` T-401 | The port: `LANGUAGE_MODEL`, an honest absence, `/health/intelligence`, the deployment variables | T-330 | A deployment with no model says so; a provider name this build cannot drive refuses to start |
| `[x]` T-402 | The first adapter: Anthropic's Messages API through the official SDK, scripted in tests | T-401 | A refusal and a truncation are outcomes, never text; the model and prompt version travel with every answer |
| `[x]` T-403 | The rules as a contract: `MachineText` -- labelled, grounded, versioned -- and the decision that binds every surface | T-401 | No surface renders machine text without the label, the model and the time |

**The port precedes the provider, as it did for delivery.** `INTELLIGENCE_PROVIDER`
is `off` on every deployment until the maintainer puts a key on the server;
`off` is an honest absence, a name this build cannot drive stops the process
at boot, and a name this build can drive with no key beside it stops it too --
a model that is "configured" and cannot answer is the silent failure the port
exists to prevent.

**Why the first adapter is Anthropic's, and why that is a decision rather
than a default.** The agent building this phase is a Claude model, which is a
reason to be careful, not a reason to choose: the choice is recorded in D-070
with its conflict named, the port is provider-shaped so a second adapter sits
beside the first the way a second viewing source sits beside the desk, and the
provider is whichever name the maintainer puts in the variable. The reason
this adapter exists first is narrower: it is the API the agent can write from
its documentation rather than from memory, with the model identifiers, the
thinking configuration and the refusal handling checked against the reference
rather than recalled.

**What a completion is allowed to be.** A `Completion` is text with the model
that wrote it and how it stopped. `refusal` and `max_tokens` are stop reasons
the port returns, not exceptions it swallows and not text it passes on: a
surface that gets one records a rejected version and shows nothing.

---

## E41 — Match summaries

Blueprint 4.2 has no summary module; the roadmap names it, and it is the one
feature in this phase whose grounding is complete: everything a summary may
say is on the match page beside it.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-410 | The facts: a `MatchFacts` document assembled from the canonical record, each part under its coverage state | T-034, T-066 | The prompt carries only what `GET /fixtures/:id` already serves; a `not_supplied` part is named as absent, never filled |
| `[x]` T-411 | Schema and contracts: `match_summary` as immutable versions, the grounding gate, `MatchSummary` | T-403, T-410 | A version stores its facts, model, prompt version and time; a summary naming a person or a number the facts do not hold is `rejected`, never shown |
| `[x]` T-412 | Generation: at full time and on an editor's request, audited; absent model → `not_supplied` | T-411, T-401 | Regeneration is a new version with a reason in the audit log; nothing is overwritten |
| `[x]` T-413 | The surface: the match centre's summary, labelled, with the model and the time | T-412 | A reader can see it is a machine's and when; a match with none shows the sentence, not a box |

**The grounding gate is the whole feature.** A summary that reads well and is
wrong about who scored is worse than no summary, and no reader can tell from
the prose. So the gate is mechanical: every person named in the text must be a
person in the facts, every score must be the record's, and a sentence that
fails is a rejected version with the failing token in its reason. The gate
is not the model's job and not a reviewer's; it is code, and it is tested with
summaries written to fail it.

**E41 built on 2026-09-19, the day the port was.** The facts (T-410) are the
match centre's own payload -- header, score, timeline, statistics, line-ups,
form, head-to-head -- plus the forecast's latest probabilities and the
crowd's shares as labelled percentages, each part under its coverage state
with absences named, assembled by `match-facts.ts` and stored whole with
every version. The schema (T-411) is `match_summary`: immutable versions
with the facts, the prompt version, the model, the tokens, who asked and
when; `published` rows are what a reader sees and `rejected` rows are kept
for the record. The grounding gate is `grounding.ts`: every number in the
text must be a number in the facts and every capitalised name outside a
sentence start must be a name in them, a heuristic that refuses a true
sentence naming a fact the record lacks -- the right way round -- and is
tested with summaries written to fail it. Generation (T-412) is
`SummariesService`: the standing instruction is stable so the provider can
cache it, the prompt is the facts document and nothing else, a refusal, a
truncation or a failed gate is a rejected version with its reason, a failed
call leaves no version, and full time's mechanism is a ten-minute catch-up
that only runs when a model exists; an editor's request is `POST
/admin/fixtures/:id/summary` with a reason in the audit log. The surface
(T-413) is the match centre's last module for a finished match: the
paragraphs under a label that says a machine wrote them from the record and
that they are not the founder's, the model's or the community's view, with
the model, the version, the time and the parts it was written from; a
finished match with none shows the sentence that says why, and an editor
sees the regeneration form. `summaries.http.spec.ts` walks all of it with a
scripted model, including a plausible name the record lacks being turned
down and the schema refusing to rewrite a version.

**What the facts are and are not.** The header, the timeline, the statistics,
the line-ups, the form and the head-to-head, each with its coverage, plus the
forecast's latest version and the consensus **as numbers with their labels**
-- never asked to be reconciled, never blended (rule 6). Nothing from news,
nothing from the panel: a summary is of the match, not of what people said
about it.

---

## E42 — Natural-language search

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-420 | The reading: a sentence → a structured intent (entity kind, names, competition, season, date range) as `Covered<Intent>` | T-403, T-038 | The intent is the model's structured output, checked against the schema; an unreadable sentence is `not_supplied` with the reason |
| `[ ]` T-421 | The answer: the intent run through the search that exists, and the interpretation shown | T-420, T-152 | Results are the search's own rows by id (rule 1); the page says how it read the question |
| `[ ]` T-422 | Fallback: with no model, the sentence is keywords, and the page says so | T-421 | Nothing about search changes for a deployment without a model except one sentence |

**The model reads; it never answers.** A question about a team is answered
by the team's row, found by the search T-038 built and T-152 taught to fold
transliterations. The model's output is a structured intent and nothing else,
which is what makes it checkable and what keeps a hallucinated club out of the
results: a name the search cannot find is a name the answer does not contain.

---

## E43 — Personalised briefings

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-430 | The briefing as a document: the feed's window (T-333) grouped by day, each item by id | T-333 | A briefing with no model is the feed as a dated page, and is honest as it is |
| `[ ]` T-431 | The prose: a `MachineText` over the document, every sentence pointing at an item in it | T-403, T-430 | A sentence that points at nothing is a rejected version; the page shows the list under the prose |
| `[ ]` T-432 | Delivery: the briefing as a notification when T-330 has a channel | T-431, T-330 | Never sent twice for the same window; quiet hours kept (T-331) |

---

## E44 — Moderation assistance

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-440 | Schema and contracts: `moderation_suggestion` per report -- category, reason, model, prompt version, time -- immutable | T-403, E23 | A suggestion is a row beside the report, never a decision |
| `[ ]` T-441 | The suggestion: requested when a report is filed, absent when there is no model; the queue shows it or its absence | T-440 | The moderator's decision is their own and the audit row records what was suggested and what was done |
| `[ ]` T-442 | What the assistant may see: the reported text and the rules, never the member's history | T-441 | The prompt is the report and `13-policy.md`'s rules; nothing about who the member is |

**Assistance is a suggestion a person can ignore.** Blueprint 10.4 and
`13-policy.md` put every sanction behind a human with a reason. A model that
took an action would be a fifth product nobody agreed to; a model that
suggests one, beside the report, with the rule it thinks applies, saves the
moderator a minute and leaves the decision where the policy put it.

---

## What Phase 5 deliberately does not build

- **Machine translation**, of anything, in any direction (T-151, D-066).
- **A chat with the model.** No surface takes free text and returns free text;
  every prompt is composed by the product from rows, and every answer is
  either structured or gated.
- **A model on the critical path.** Scores, the match centre, forecasts,
  predictions and settlement never call the port, and the port never holds a
  request that one of them waits on.
- **A fourth prediction product.** The model is never asked who will win.
- **Autonomous moderation.** A suggestion, never a sanction.

---

## What blocks what

| Tasks | Blocked on | Who |
|---|---|---|
| T-400 | a key on the server, after T-074 | **maintainer** |
| T-401..T-403 | nothing | agent |
| T-410..T-413 | built 2026-09-19; generation waits for T-400 at runtime | agent |
| T-420..T-422 | nothing | agent |
| T-430, T-431 | nothing | agent |
| T-432 | T-330's channel | after the provider |
| T-440..T-442 | nothing | agent |

**Fourteen of the fifteen tasks are buildable with nothing from the
maintainer**, because the model is a runtime dependency behind a port and
every surface has an honest state without it. The one that is not is the key.

---

## The honest risk in this phase

It is not that the model will be wrong; it will be, and the gates exist for
that. It is that a gate will let through a sentence that is *plausible and
unfounded* -- a summary that says a side "dominated" a match the statistics
module marked `not_supplied`, a briefing that reads more into a fixture than
the feed's signals carry. The defences are the ones already chosen: the prompt
carries coverage states and not just data, so the model is told what is
unknown; the gate rejects names and numbers the record lacks; the label tells
the reader what wrote it; and the version keeps the inputs, so a wrong sentence
can be traced to what it was given rather than argued about.
