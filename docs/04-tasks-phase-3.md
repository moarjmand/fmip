# Phase 3 — Community

Phase 1 built a member who predicts. Phase 2 built the football intelligence
worth predicting against. Phase 3 builds the part where members reach each
other.

That is a different kind of phase, and the difference is not size. Every surface
built so far was the site talking to a reader: if it was wrong it was wrong at
everyone equally, and the worst it could do was mislead. From here a surface
carries one member's words to another member, which makes this the first phase
in which **the product can be used to hurt somebody**. A feature here is not
finished when it works. It is finished when the person on the receiving end has
a way out.

Read `01-roadmap.md` for why the phases are shaped this way and `00-decisions.md`
before proposing anything that changes a locked decision. The sequencing rule
from the roadmap applies inside every epic: **schema and contracts, then data,
then the backend module with tests, then the published contract, then the
frontend, then observability.**

---

## What Phase 3 is, in one paragraph

Six of the eight epics are products — the social graph, moderation,
conversations, groups, public match discussion and community analysis — one is a
transport (realtime delivery), and one is the plumbing that makes the rest
noticeable (in-product notifications). None of them is blocked on money or on a
licence, which is the first time that has been true of a whole phase. What they
are blocked on instead is **policy**: what the platform rules say, what earns a
sanction, and whom the founder is willing to approve. Those are written by the
maintainer, and the tasks that need them say so.

**Exit criteria.** Blueprint 19's social list, checked on the public deployment:
friend requests, blocking, group roles, invitations and membership changes work
correctly; direct, group and public messages arrive in real time and retain
ordering; only authorised members post in controlled public match discussions;
exclusive-group and community-analyst access can be granted **and withdrawn** by
authorised administrators; reports and moderation actions create an audit record.

And two of our own, because the blueprint's list would pass on a product nobody
could get away from:

- **Every conversational surface ships with its exits already built.** Block,
  mute, leave and report exist on the day the surface exists, not in the epic
  after it.
- **A fourth signed opinion does not become a fourth way to break rule 6.**
  Community-written analysis (blueprint 10.3) stays separate from the founder's
  analysis, from the model and from the consensus, and the guard proves it.

---

## Epic order and what blocks what

```
E20 the social graph ──> E21 moderation spine ──> E22 conversations ──> E23 realtime
   (friends, blocks)        (report, sanction,        (the message         (WebSocket
                             queue, rate limit)         store)              delivery)
                                                          │
                                                          ├──> E24 groups
                                                          │
                                                          ├──> E25 public match chat
                                                          │          │
                                                          │          └──> E26 community analysis
                                                          │
                                                          └──> E27 notifications
```

**The roadmap lists moderation last. This plan puts it second, and that is a
deliberate correction (D-053).** You cannot ship a messaging surface and add
reporting in the next epic. The first unwanted message arrives the day the
surface opens, and the member it reaches has no block, no report and no recourse
until whenever the moderation epic gets built. Blocking is not an afterthought in
the blueprint either: it is named in 8.1 as part of friendship itself, and
`privacy_setting` has carried a `friends` value since T-041 waiting for a
friendship to exist.

**So E20 and E21 come before a single message can be sent**, and E22 onward each
ship with their exits attached.

---

## E20 — The social graph

Blueprint 8.1. Friendship is the smallest community feature and the one that
already-shipped code is waiting on:
`apps/api/src/modules/profile/internal/visibility.ts` has carried a
`FriendshipOracle` port since T-041 whose only implementation answers *no*, which
means a member who sets their profile to "friends only" today has set it to
"nobody". That is honest — it fails closed — but it is a promise the settings
page makes and the product does not keep.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-200 | Schema and contracts: `friend_request`, `friendship`, `block` | T-040 | A friendship is one row, not two; a block cancels what it must, in the database |
| `[ ]` T-201 | The friends API and the real `FriendshipOracle` | T-200 | Request, cancel, accept, decline, remove, block, unblock; a friends-only profile is visible to a friend |
| `[ ]` T-202 | Friends on the web: requests inbox, friend list, profile controls | T-201 | Pending requests and mutual friends, both under the viewer's privacy |
| `[ ]` T-203 | Comparing records: two members' predictions and ratings side by side | T-202, T-056 | Only what the other member's privacy permits, and the comparison names both |

**A friendship is one row, not two.** Two directed rows can disagree — one
deleted, one not — and then "are A and B friends?" has two answers depending on
which way the query was written. The row is the unordered pair, stored
`(lower_id, higher_id)` under a CHECK that refuses any other order, so there is
exactly one row to ask and no way to write the second.

**A block is enforced where no caller can route around it.** Blocking is the
member's own exit, and an exit implemented as a filter in one query is an exit
that leaks the first time somebody writes a second query. So the block ends the
friendship and cancels pending requests by trigger, and a request into a block is
refused by the database with its own SQLSTATE — the same shape as the kick-off
lock (T-051) and for the same reason. What the application layer adds is a
readable error, not the rule.

**A block is not symmetrical and is not announced.** It stops the blocked member
reaching the blocker; it does not tell them, because a notification is a message
and the point was to stop messages. The blocker's own view is honest about it:
their block list is theirs to read and to undo.

**The judgement this epic turns on**, which becomes a decision entry when T-200
lands, is what a block *hides*. Ending the friendship and cancelling requests is
the easy half. Whether a blocked member can still read the blocker's **public**
profile is a real choice: hiding it makes a block into a partial account deletion
and is trivially detectable by signing out, while leaving it visible means a
block is about contact rather than about reading. The plan's position is the
second, and the argument belongs in the log where it can be disagreed with.

**T-200 verified on 2026-09-13.** `..._social-graph.sql` is the first Phase 3
migration, and `packages/contracts/src/social.ts` the contract. Nothing in the
API writes these tables yet — that is T-201 — so `social.schema.spec.ts` writes
what the service will write and checks the half of the rules that belong to the
database.

**A friendship is one row, not two**, and the database is what makes that true:
`low_id < high_id` is a CHECK, so a row in the wrong order cannot exist, and the
same pair arriving from the other member — both of them accepting at once, which
is the realistic race — is refused by the primary key rather than by a lock the
service has to remember to take. Callers write `LEAST($1, $2), GREATEST($1, $2)`
and the invariant stops being anybody's discipline.

**A block cancels what it must, in the database.** A request or a friendship
across a block is refused with SQLSTATE `PL003`, and creating a block ends the
friendship and withdraws the open requests in both directions by trigger. The
second guard is not symmetry: a request that predates the block is already a row,
so accepting it is the realistic way a friendship would otherwise be created
across one. `users_blocked(a, b)` is the single definition of "these two must not
reach each other", written once here so that conversations (T-221), invitations
(T-241) and notifications (T-271) cannot each grow a slightly different version
of it.

**The guard was checked by breaking it**, as T-133's and T-135's were: dropping
the two block triggers fails exactly three of the twelve tests and no others.

**A friend request has no `status` column, and that is the judgement in this
task.** Accepting, declining, cancelling and blocking all delete the row, so the
table means one thing: an open offer. A `status` column would build a permanent
record of one member having turned another down — something neither of them asked
the product to remember, and which would have to be readable by somebody for it
to be worth storing. Repeated re-requesting is what blocking and the rate limits
of T-213 answer.

**And one thing the contract states rather than hides.** `FriendStatus` returns
`unavailable` — not `blocked_by` — when the *other* member has blocked the
viewer. It says a request cannot be sent and not why, because naming it would
turn every profile page into a detector for a block, and stopping the blocked
member from acting is the entire job. It is the one place in this contract where
the product knows more than it says, it is there for the blocked-from member's
safety, and it is written down in the file rather than left to be discovered.

12 tests against the real schema; the migration was cycled down and up.

**What is not here.** No endpoint, no service, and `FriendshipOracle` still
answers no — so a friends-only profile is still visible to its owner alone. That
is T-201.

---

## E21 — The moderation spine

Blueprint 10.4 and 16. The epic that has to exist before a member can write
anything another member will read.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-210 | Schema and contracts: `report`, `moderation_decision`, `sanction`, `appeal_note` | T-070 | A decision is immutable and names its actor; a sanction has a scope and an end |
| `[ ]` T-211 | The reporting API, and sanctions enforced at the write path | T-210 | A restricted member is refused where they would have written, not hidden afterwards |
| `[ ]` T-212 | The moderation queue in the admin area | T-211 | Every action records actor, time, reason and previous value (rule 10) |
| `[ ]` T-213 | Rate limits, and the honest limit of automated filtering | T-211 | A flood is refused by a rule about volume; nothing claims to detect abusive language |

**A sanction is enforced at the write path.** A restriction that merely hides
what a member wrote is not a restriction: the member still believes they are
talking, the queue keeps refilling, and nobody's behaviour changes. A sanctioned
member is told at the moment they try to write that they cannot, and until when.

**Sanctions end.** Every one carries a scope — this conversation, this group,
public posting, all messaging — and an expiry or an explicit permanence, because
a restriction with no end is one somebody has to remember to lift, and nobody
does. Blueprint 9.4 says the same thing from the other direction about
privileges: they can be paused and removed, so they are grants with a lifecycle,
never a boolean on an account.

**No automated abuse classifier, and that is a decision rather than an omission
(D-054).** Blueprint 10.4 allows that "automated filters can assist with spam and
abusive language". A rate limit is a rule about volume and works in every
language, so it is built. A classifier for abusive *language* is not: anything
buildable here is an English word list with some regular expressions, it would
ship on a product that speaks eight languages, and it would under-moderate seven
of them while the admin page reported that filtering was on. That is rule 3
wearing a safety label. Reports and human decisions are the mechanism, the rate
limit is the automation, and the admin surface says which of the two caught what.

**The appeal note is a row, not an inbox.** Blueprint 10.4 asks for one, and a
sanction whose appeal lives in somebody's email has no audit history.

**What the maintainer writes, not the agent.** The platform rules themselves —
what conduct earns which sanction, and the text a member accepts at registration
— are editorial and legal judgements (`CLAUDE.md` §7). T-210 builds the machinery
with the categories as configuration; the words are the maintainer's.

---

## E22 — Conversations

Blueprint 8.3, and the heart of the phase. Direct conversations first, because a
group conversation is a conversation with a membership rule on top and building
it the other way round means writing the membership rule twice.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-220 | Schema and contracts: `conversation`, `participant`, `message`, per-conversation sequence | T-210 | Ordering is a property of the store, not of a clock; removal leaves a tombstone |
| `[ ]` T-221 | The conversation API: open, send, page back, read state, mute, leave | T-220 | A blocked or sanctioned member cannot send; every conversation can be left |
| `[ ]` T-222 | Shared football cards: match, article, team, player, prediction | T-221 | A card is a reference resolved at read time, never a copy of a score |
| `[ ]` T-223 | Search within a conversation | T-221 | Finds a member's own messages in a conversation they are still in |
| `[ ]` T-224 | The chat surface on the web, without realtime | T-222 | Usable and correct over plain requests, before a socket exists |

**Order is a sequence, not a timestamp.** Blueprint 19 asks that messages
"arrive in real time and retain ordering", and `created_at` cannot carry that: two
messages in the same millisecond tie, and a clock that steps backwards reorders a
conversation retroactively. Each conversation has its own counter, allocated
under the conversation's row lock, so ordering is decided once by the store. It
is also what makes the realtime epic testable — a client that reconnects asks
"everything after 41", which is a question with one answer.

**The socket delivers; it never defines.** A message is persisted and numbered
before anybody is told about it, so a failed broadcast costs a refresh rather than
a lost message, and a client that never connected sees exactly the same
conversation as one that did. This is why T-224 builds the surface *before* T-230
builds the transport: if the page is only correct when the socket is up, the
socket has become the source of truth by accident.

**A removed message leaves a tombstone.** Moderation needs removal, and a message
that silently vanishes makes the surrounding conversation unreadable and the
moderation record unverifiable. The row stays, its content goes, and what remains
says that it was removed and whether the author or a moderator did it. Edits work
the same way as everywhere else in this repository: a new version, never a
rewrite (rule 5's spirit).

**A shared card is a reference, never a copy.** Blueprint 8.3: "Match cards
shared in chat remain live. The score and status update without replacing the
original discussion context." So the message stores `{kind, uuid}` and nothing
else — never a name, never a score (rule 1) — and the card is resolved when the
conversation is read, carrying its own `last_updated_at` like every other live
surface (rule 4). A denormalised score in a message would be a stale number
displayed as a current one, permanently.

**Read state is for direct conversations.** In a two-person conversation it is
information. In a two-hundred-person group it is a surveillance feature that
nobody reads and everybody is subject to, so the participant row carries the
last sequence a member has seen — which is what "unread count" needs — and the
product only *shows* another member's read position one-to-one.

**No user-uploaded images or files in Phase 3 (D-054).** Blueprint 8.3 marks it
optional in the same sentence it names it. Accepting uploads means storage,
scanning, a binary moderation queue, and a legal exposure that is different in
kind from text. Declining it is a scope decision made once, in the open, rather
than an unbuilt corner somebody assumes is coming.

---

## E23 — Realtime delivery

D-010 reserved WebSockets for exactly this. E22 made the conversation correct
without one; this epic makes it immediate.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-230 | The gateway: session-cookie auth, subscribe to conversations you are in | T-221 | A socket can only ever carry conversations its member participates in |
| `[ ]` T-231 | Fan-out across instances, and gap recovery by sequence | T-230 | A reconnecting client asks for everything after N and misses nothing |
| `[ ]` T-232 | Live match cards: the card updates, the conversation does not move | T-222, T-032 | A score change updates a shared card without a new message |
| `[ ]` T-233 | Observability: connections, delivery latency, `GET /health/chat` | T-231 | A silent socket layer is visible from the admin area, not from a complaint |

**Authorisation happens at subscribe time and again at send time.** A socket is a
long-lived connection and membership is not: a member removed from a group
mid-conversation must stop receiving it, so the subscription is re-checked
against the store rather than trusted from the handshake.

**Fan-out goes through Redis from the first commit.** In-process fan-out works
until there are two instances and then silently delivers half the messages —
the failure is invisible in development and total in production. Redis is already
in the stack (D-006-era decisions and the live path), and the SSE change feed is
the precedent for keeping the transport separate from the data.

**An operational note that belongs here rather than in a surprise.** The free
Koyeb preview (`docs/11-koyeb.md`, D-051) sleeps its instance after an hour
without traffic, which drops every socket. That is fine for a preview and must
not become the reference environment for judging whether chat works.

---

## E24 — Groups

Blueprint 8.2, plus the exclusive groups of 10.1 — which are the same table with
a different visibility and an invitation rule, not a second feature.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-240 | Schema and contracts: `group`, `member` with roles, `invite`, `join_request` | T-220 | Visibility, roles and the one-owner rule live in the schema |
| `[ ]` T-241 | The group API and the group conversation | T-240, T-221 | Membership changes take effect on the conversation immediately |
| `[ ]` T-242 | Group surfaces: directory, page, membership controls | T-241 | A private group is not discoverable; an invite-only one is not joinable |
| `[ ]` T-243 | The group leaderboard and prediction comparison | T-241, T-055 | The same rating rules as the global board, scoped — never a second formula |
| `[ ]` T-244 | Match threads inside a group | T-241 | A thread is a conversation about a fixture, and says which |

**Three visibilities, and the middle one is the point.** Public,
discoverable-private and invite-only are not a spectrum of the same thing:
discoverable-private means the group can be *found* but not *read*, which is what
makes joining possible without making membership public. A schema with a boolean
would collapse the middle and the product would lose the case the blueprint asked
for.

**The group leaderboard uses the global rules, scoped.** Blueprint 9.3 lists
group-based boards alongside global ones, and the temptation is a second ranking
that flatters small groups. The minimum-prediction floor of D-037 applies
unchanged: a member with three settled predictions does not top a group board
either.

**Exclusive groups are not a separate mechanism (10.1).** They are invite-only
groups whose invitations are issued under a privilege the founder grants. Making
them their own table would duplicate every membership rule and guarantee the two
copies drift.

---

## E25 — Public match discussion

Blueprint 10.2. Reading is open to everyone; posting is a granted privilege. This
is the first surface where something a member writes is shown to the public, and
the gate is the whole feature.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-250 | Eligibility as a derived view; approval as an audited grant | T-054, T-212 | Eligibility is computed and never grants; approval names its approver and reason |
| `[ ]` T-251 | The discussion: open to read, gated to post, linked to the match | T-250, T-221 | A guest reads; an unapproved member cannot post and is told why |
| `[ ]` T-252 | Reactions, and following a contributor | T-251, T-042 | Reacting is open to members; it never becomes posting access |
| `[ ]` T-253 | Featured matches: which fixtures have a panel at all | T-251, T-070 | An operator decides, with an audit row |

**Eligibility is computed; access is granted.** Blueprint 10.2 lists four
requirements and then a fifth: "manual approval by the founder, editor or
administrator". So the system's job is to say who *qualifies* — rating above the
threshold, enough settled predictions, a clean recent conduct record — and a
person's job is to decide. Nothing auto-grants. `internal/eligibility.ts` in the
reputation boundary (T-054) already computes the first half of this and is the
natural place for the rest.

**A grant is a row with a lifecycle.** It names its approver, its reason and its
acceptance of the contributor rules, and it can be paused or withdrawn (9.4),
which means the withdrawal is a row too. A privilege implemented as a flag has no
history and cannot answer "who approved this, and when did it stop".

**Each message shows the contributor's rating tier and approved status** (10.2),
which is not decoration: on a public panel it is the only thing separating an
approved contributor's opinion from anybody else's, and it is what makes the
reputation system visible where it matters.

**What the maintainer supplies:** the thresholds, the contributor rules text, and
the approvals themselves. The agent builds the gate; it does not decide who gets
through it.

---

## E26 — Community-written match analysis

Blueprint 10.3, and the place rule 6 is most likely to break in this phase.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-260 | Schema and contracts: draft, submission, review decision, published version | T-250 | Its own tables and its own contract; nothing shared with the founder's analysis |
| `[ ]` T-261 | The workflow: draft → submit → review → approve, request changes or reject → publish | T-260 | Every transition is audited and every published version is immutable |
| `[ ]` T-262 | The analyst editor and the editorial review queue | T-261 | A reviewer sees the submission, the author's record, and the decision history |
| `[ ]` T-263 | Publication surfaces, and the guard extended to a fourth opinion | T-262, T-133 | A test fails if community analysis is merged with, or relabelled as, any of the three |

**This is a fourth signed opinion, and the guard has to know it.** Rule 6 names
three prediction products. Community analysis is not one of them — it is not the
founder's analysis, not the model, not the consensus — and it contains a
predicted result, a confidence and reasoning, which makes it look exactly like
the founder's analysis in a database diagram. Storing it in `founder_analysis`
with a different author would be the obvious, wrong, one-line version of this
epic, and it would make the founder's own signature meaningless. So it is its own
boundary, and `three-products.spec.ts` becomes a four-way guard.

**T-133 is the precedent for how this gets checked.** That guard was written from
rule 6, and writing it revealed that the third product had never been built. This
one is written from blueprint 10.3 and is checked the same way: by breaking it on
purpose before believing it.

**Published community analysis is immutable and labelled with the author's name
and rating** (10.3). The kick-off wall that `founder_analysis` has (T-130,
SQLSTATE `PL002`) applies here for the same reason — a call revised after the
result is known is not a call — and so does versioning after publication.

---

## E27 — In-product notifications

Blueprint 12.2. Deliberately the *in-product* half: an inbox, deep links,
per-type preferences and quiet hours. Push and email campaigns are Phase 4, and
they need a delivery provider, which is the maintainer's (T-074).

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-270 | Schema and contracts: `notification`, `notification_preference`, quiet hours | T-041 | A preference exists per type; a missing row means the documented default |
| `[ ]` T-271 | Emission from the events that already happen | T-270 | Nothing is emitted twice, and nothing is emitted to somebody who blocked the source |
| `[ ]` T-272 | The inbox, and a deep link that lands on the exact thing | T-271 | Every notification opens the match, profile, group or conversation that caused it |
| `[ ]` T-273 | Quiet hours and frequency limits | T-272 | A quiet-hours notification is delayed or dropped by rule, and says which |

**A notification is a consequence, not a feature.** Every one of them is already
an event somewhere else in the product — a settlement, a rating change, a friend
request, a mention, a review decision — so this epic subscribes rather than
invents, and any event that needs new code to be noticed is a sign the event
itself was not recorded properly.

**Blocks apply to notifications first.** The fastest way to undo a block is a
notification that says a blocked member did something, so the block is checked at
emission, not at display.

**Quiet hours need the member's timezone**, which the account has had since T-040.
A frequency cap that silently drops is dishonest; the inbox shows what was held
back, because rule 3 does not stop applying because the surface is small.

---

## What can start today, and what cannot

| Work | Blocked on | Who |
|---|---|---|
| T-200..T-203 | nothing | agent |
| T-210, T-211, T-213 | nothing (the rules *text* is the maintainer's) | agent |
| T-212 | nothing | agent |
| T-220..T-224 | nothing | agent |
| T-230..T-233 | nothing | agent |
| T-240..T-244 | nothing | agent |
| T-250..T-253 | the thresholds, the contributor rules, and the approvals | agent, then **maintainer** |
| T-260..T-263 | approved analysts to exist | agent, then **maintainer** |
| T-270..T-273 | nothing in-product; push and email are Phase 4 | agent |

**The whole phase is buildable without a purchase or a licence**, which Phase 2
was not. What it cannot produce is policy: the platform rules, the conduct
categories, the contributor thresholds and every individual approval are
judgements the maintainer makes (`CLAUDE.md` §7). The machinery is built so those
are configuration and rows, not code changes.

---

## A note on scale, since it is the honest risk here

Phase 3 is larger than Phase 2 and most of it is stateful. Three things keep it
from becoming a rewrite:

1. **Conversations are correct before they are fast.** E22 ships a working chat
   over ordinary requests; E23 adds a transport to something already right.
2. **Every exit exists on the day of the surface it belongs to.** Block, mute,
   leave and report are not an epic; they are a column of the acceptance table.
3. **Nothing new invents its own identity, rating, audit or coverage rules.** The
   group leaderboard uses D-037's floor, the moderation log uses `audit_log`, a
   shared card uses a UUID, and a module with nothing to show says so in the four
   coverage states. A community phase that re-answered those questions would be
   building a second product beside the first.
