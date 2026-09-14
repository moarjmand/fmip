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
| `[x]` T-201 | The friends API and the real `FriendshipOracle` | T-200 | Request, cancel, accept, decline, remove, block, unblock; a friends-only profile is visible to a friend |
| `[x]` T-202 | Friends on the web: requests inbox, friend list, profile controls | T-201 | Pending requests and mutual friends, both under the viewer's privacy |
| `[x]` T-203 | Comparing records: two members' predictions and ratings side by side | T-202, T-056 | Only what the other member's privacy permits, and the comparison names both |

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

**T-201 verified on 2026-09-13, and it closed a promise Phase 1 had been making.**
`apps/api/src/modules/social/` is the boundary: `social.service.ts` is the whole
public surface, `internal/social-store.ts` is every statement, and the routes all
sit under `/me`, because each of these answers is about the signed-in member's
own relationships and there is no public version of one. Blueprint 7.2 puts a
friends *count* on a profile; who they are is the member's to show.

**A friends-only profile is now visible to a friend.** `privacy_setting` has had
the `friends` value since T-041 and `FriendshipOracle` has had one implementation
that answered no, so a member who chose "friends only" had chosen nobody. It
failed closed, which is the right way to be wrong, but the settings page was
making a promise the product did not keep. `ProfileModule` now binds the port to
`SocialService.areFriends` in one line — and nothing in `canView` changed, which
is what the port was for. The adapter lives on the profile side because
`FriendshipOracle` is that module's internal; the dependency runs profile →
social, and the placeholder implementation is gone rather than left where
somebody could wire it back.

**The gate points one way, deliberately.** Sending a friend request needs a
verified e-mail, for the reason submitting a prediction does (T-050): an
unverified account is free to create, and a request is contact. **Blocking,
unblocking, declining and unfriending need nothing beyond a session.** A product
that made somebody verify an e-mail before they could stop another member
contacting them would have built the gate backwards, and the test asserts exactly
that pair — the same unverified account is refused a request and allowed a block.

**Declining and cancelling are one route.** `DELETE /me/friend-requests/:username`
withdraws whatever is open between the two members, because the two acts differ
only in who started it and leave the same thing behind. Every write is
idempotent: asking twice is one open offer, and a second tap on block is a 204,
not an alarming error about something that already happened.

**A bug of mine, and the leniency that hid it.** A test had a member withdraw a
request between themselves and themselves — the wrong username in a template
string — and it passed, because the endpoint treated "nothing to do" and "you
asked the wrong question" as the same thing and answered 204. Every verb now
refuses the viewer's own username, including the ones where operating on yourself
would simply do nothing, and the suite asserts all six.

21 tests: 12 against the schema from T-200 and 9 over HTTP with real sessions,
including a guest refused on every route, the crossing-request case, the
mutual-friend count, a block ending a friendship while leaving an unrelated
request alone, and a lifted block that does not restore what it ended.

**What is not here.** Nothing on the web: the requests inbox, the friend list and
the profile controls are T-202, and the record comparison blueprint 8.1 asks for
is T-203.

**T-202 verified on 2026-09-13.** `/[locale]/friends` is the page — requests,
friends and blocks — and `components/friend-controls.tsx` is the control set,
rendered on a member's profile and beside every row of that page.

**Pending requests and mutual friends, both under the viewer's privacy.** The
mutual count is computed over *the viewer's own* friends intersected with the
other member's, which is the only form of it that is not a window into somebody
else's list: every name it could be built from is already the viewer's.

**The block list is on the friends page, not buried in settings.** A block a
member cannot find is a block they cannot lift, and the page says the surprising
half out loud — lifting one makes contact possible again and does not restore the
friendship the block ended.

**Every section states its own absence**, which is the T-137 lesson applied where
it matters more. A vanishing "Requests" section is not just untidy: an empty
requests list is a claim about whether another member did something, and a reader
must be able to tell "nobody has asked" from "the page did not ask".

**The judgement that took the longest, and it is about `unavailable`.** When the
other member has blocked the viewer, the profile says *"You cannot send @x a
friend request"* and does not say why. Three options were on the table and two of
them are worse. Showing "Add friend" and letting it fail leads a member into a
dead end for the same inference one click later. Accepting the request and never
delivering it tells the sender something untrue about their own action — the
failure rule 3 exists for — and it is the option most products pick. Saying
plainly that a request cannot be sent, without the reason, is the only one that
lies to nobody. Today a block is the only thing that produces it, so somebody
determined can infer it; that is the residual cost, and it is smaller than either
alternative.

**The exit is never taken away.** The block control is present in every state
including `unavailable`, so one member cannot decide what controls another member
has. `friend-controls.spec.ts` is the first check of D-053's promise that every
surface ships with its exits: it reads `FriendStatus` **out of the contract** and
fails if any state renders without a block or an unblock — so adding a state to
the union and forgetting the component is a failing test rather than a state that
quietly offers nothing. Checked by breaking it: removing one `{block}` fails two
of the six.

**Checked against a running stack**, not only in types. API on 3002, `next dev` on
3100, two members registered: the request appears in the recipient's inbox with
Accept, Decline and Block; the sender's profile view says "Friend request sent";
and — the acceptance criterion — **Ada's friends-only profile is `restricted` to a
guest and opens to Bo the moment the request is accepted**. `/ar/friends` renders
right-to-left with the new `nav.friends` key correctly marked `untranslated`
(T-151). The demo accounts were deleted afterwards.

127 web tests.

**T-203 verified on 2026-09-13, and E20 is complete.** `/[locale]/u/:username/compare`
puts two members' ratings and prediction records side by side;
`lib/compare.ts` is the arithmetic, pure, so the counting rules are argued with
in a test rather than inspected on a page.

**It adds no access.** The history comes from the endpoint the profile already
uses (T-056), so a member whose history is friends-only or private is restricted
here too and the page says which. A comparison that read the predictions a
different way would be a privacy setting with a hole in it — and this is exactly
the sort of feature where that hole gets drilled, because the comparison "needs"
both sides. It does not: it says it cannot see one.

**It compares a window and admits it.** One request per member reaches 50
predictions (`HISTORY_MAX_LIMIT`), so where either has made more the page says
this is the recent record and not the career. Presenting fifty of four hundred as
a head-to-head is rule 3 with a scoreboard on it.

**Three exclusions from the tally, each of which would otherwise blame somebody
for nothing they did.** An unsettled match is not a wrong prediction, and
counting it would penalise the member who predicts earlier. A void settlement —
an abandoned match — has no result, so nobody was wrong. And a match is counted
only when *both* settlements stand: a tally where one side is judged and the
other is not is not a comparison of two members.

**Checked against a running stack:** two members predicting the same fixture show
"1 match in common, none of them settled yet" with both calls named; the moment
one of them sets their history to private, the same page says so instead. The
demo accounts were removed afterwards — around `prediction_version_immutable` and
`rating_snapshot_immutable`, which a cascade from `user_account` otherwise runs
straight into, and both re-enabled after.

7 unit tests on the counting; 134 web tests.

**E20 is complete.** The social graph exists, the `friends` visibility means what
the settings page has been saying since T-041, and every surface it added carries
the member's way out.

---

## E21 — The moderation spine

Blueprint 10.4 and 16. The epic that has to exist before a member can write
anything another member will read.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-210 | Schema and contracts: `report`, `moderation_decision`, `sanction`, `appeal_note` | T-070 | A decision is immutable and names its actor; a sanction has a scope and an end |
| `[x]` T-211 | The reporting API, and sanctions enforced at the write path | T-210 | A restricted member is refused where they would have written, not hidden afterwards |
| `[x]` T-212 | The moderation queue in the admin area | T-211 | Every action records actor, time, reason and previous value (rule 10) |
| `[x]` T-213 | Rate limits, and the honest limit of automated filtering | T-211 | A flood is refused by a rule about volume; nothing claims to detect abusive language |

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

**T-210 verified on 2026-09-13.** `..._moderation.sql` is `report`,
`moderation_decision`, `sanction` and `appeal_note`;
`packages/contracts/src/moderation.ts` is the contract. Nothing in the API writes
them yet — that is T-211 — so `moderation.schema.spec.ts` writes what the service
will write and checks what the database guarantees.

**A decision is immutable and names its actor.** `refuse_change()`, the same
trigger the audit log and every forecast version use (rule 5, rule 10). A
moderation record that can be edited afterwards is not a record, and the first
time that matters is the first time somebody disputes it. A blank reason is
refused too.

**Every sanction ends, or says out loud that it does not.** `permanent` is a
column with a CHECK against `ends_at`, not a null nobody noticed: a moderator
choosing "permanent" and a moderator forgetting to set an end must not produce
the same row. Lifting one early is whole or absent — actor, time and reason
together, or none of them.

**And it is enforced where the member would have written.** `member_sanctioned`
is the single definition of "currently restricted from this", and a trigger on
`friend_request` refuses a request from a member under an active `contact`
sanction with SQLSTATE `PL004`. A restriction that merely hid what a member wrote
would leave them believing they were being heard, the queue refilling, and
nobody's behaviour changed. Checked by breaking it: dropping that one trigger
fails exactly that test.

**Nothing is listed that nothing can enforce, and that is the judgement in this
task.** `report.subject_type` allows one value, `member`; `sanction.scope` allows
one, `contact` — friend requests being the only thing one member can currently
aim at another. A scope a moderator can choose and no code applies is rule 3
pointed at an operator instead of a reader: the moderation team would believe a
restriction was in force. Each later epic widens its own CHECK in the same
migration that builds the surface it protects — messages in T-220, groups in
T-240, public posting in T-251, analysis in T-260.

**One open report per reporter per subject**, by a partial unique index. Filing
the same complaint fifty times is not fifty complaints, and a queue full of them
is a queue nobody reads; once it has been answered, a fresh complaint is a fresh
one.

**And the link between a report and a decision points from the report.** The
first draft of this table had `moderation_decision.report_id`, which says a
decision answers one report. Building the queue on it (T-212) showed it the
wrong way round: three members reporting one person is three reports and **one
judgement**, and a moderator who read all three and issued one sanction should
not have to write the decision out three times. So `report.decision_id` points
at the decision, several reports may name the same one, and it replaces the
`resolved_at` the first draft had beside it — "open" is a fact about whether an
answer exists, and two columns for one fact is one column too many. Corrected
before the migration merged rather than left for a second one to undo.

**The cleanup is session-scoped, which is not a detail.** Deleting immutable
rows needs the trigger out of the way, and `ALTER TABLE ... DISABLE TRIGGER` does
that **globally** — while it is off, any suite running in parallel that asserts
the same table is immutable passes without testing anything. So the cleanup takes
one dedicated connection and sets `session_replication_role = 'replica'`, which
is scoped to that session. Sixteen older specs still use the global form.

10 tests against the real schema; the migration was cycled down and up.

**T-211 verified on 2026-09-13.** `apps/api/src/modules/moderation/` is the
boundary: the member's half of it. A moderator's queue is T-212 and sits behind
the admin gate; what is here is what a member can do — report somebody
(`POST /reports`), read what has been done to them (`GET /me/standing`), and
appeal it.

**A restricted member is refused where they would have written.** A friend
request from a member under an active `contact` sanction is refused by the
database (PL004, T-210) and the API turns that into a 403 that names the
restriction and points at the member's own standing, which carries the end date
and the appeal. Not hidden afterwards, not silently dropped: a member who
believes they are being heard does not change their behaviour, and the queue
keeps refilling.

**The explanation is read after the refusal, never before it.** `SocialService`
catches PL004 and only then asks the moderation boundary which sanction it was.
Checking first and writing second would be a second copy of the rule in
TypeScript and a check a sanction expiring in between could make wrong.

**The gate points one way, and this is the half that matters most.** Filing a
report needs a session and nothing else — not a verified e-mail, and
emphatically not an unsanctioned account. A member restricted for something
unrelated must still be able to report the person harassing them; a product that
got this backwards would silence exactly the people who most need to be heard.
The suite asserts it directly: the sanctioned member's friend request is refused
and their report is accepted in the same test file.

**Two answers are deliberately the "wrong" ones.** A second identical report is
a 204, not a 409 — the member has reported them, which is what they wanted, and
a second identical complaint is not a second complaint (the partial unique index
of T-210 decides, not a lookup-then-insert two taps could both pass). And
appealing somebody else's sanction is a **404, not a 403**: a 403 would confirm
that the id exists and belongs to a member the caller is not.

A report naming a subject kind that does not exist yet — `message`, say — is a
400. Storing it would put a row in the queue pointing at a table nothing can
open.

**A test that passed for the wrong reason, found by adding a second suite.**
This is where the session-scoped cleanup note in T-210 came from. Adding a second
moderation suite put two cleanups in parallel, and one of them switched off
`moderation_decision_immutable` globally while the other was asserting it — the
immutability tests passed without testing anything. Both suites now take a
dedicated connection and `SET session_replication_role = 'replica'`. Sixteen
older specs still use the global form; that is its own change rather than a
detour here.

19 tests: the 10 against the schema and 9 over HTTP with real sessions.

**T-212 verified on 2026-09-13.** `moderation-admin.controller.ts` is
`/admin/moderation/*`, open to the **`moderator` or `admin`** role — the role
list has had `moderator` in it since T-040 for exactly this, and blueprint 7.3
gives a moderator the reports queue without the rest of the administration area.

**Its own controller rather than a corner of the admin one.** The admin boundary
owns coverage, accounts and the audit log; moderation owns reports, decisions and
sanctions, and putting its SQL in `admin-store.ts` would leave two modules
writing the same tables. The `/admin` prefix says who may call it, not which
boundary owns it.

**The queue groups by subject**, which is the shape T-210's corrected foreign key
made possible. Two members reporting the same person arrive as one row carrying
both reports, ordered by who has waited longest, with the count of sanctions
already in force so nobody decides blind. A moderator shown them separately
either decides twice or decides once and leaves one behind in a queue nobody
looks at again.

**The outcome and the restriction have to agree.** An outcome of `sanctioned`
with no restriction is a record of something that did not happen; a restriction
under any other outcome is one nobody decided. Both are 400s, and so is a
decision with a blank reason — rule 10 needs a reason that can be reviewed.

**Every action records actor, time, reason and what changed, in the same
transaction as the change (D-046).** The decision, the reports it answers, the
sanction it applies and the `audit_log` row are one transaction; so are the lift
and its row. The tests do not stop at the status code — they read `audit_log`
afterwards, because a decision visible in the product and absent from the log is
the gap rule 10 exists to close.

**A lift is a row with a reason too**, and lifting a sanction that is already
lifted, expired, or never existed is the same 404: all three mean there is
nothing of that id still in force.

**One cleanup bug worth the note.** The suites' cleanup first tried to unlink
reports by setting `decision_id` to null before deleting the decisions. That
makes two reports from one reporter about one subject open at the same time,
which the one-open-report index refuses — so the cleanup failed and took a whole
suite with it, in CI, with an error about a unique constraint that had nothing to
do with what was being tested. Reports are now deleted before the decisions they
name.

31 tests across the three moderation suites.

**T-213 verified on 2026-09-13, and E21 is complete.** `..._rate-limit.sql` is
`rate_limit` (the ceilings, as rows) and `rate_window` (one row per member per
action per hour), with a trigger that refuses the request past the ceiling —
SQLSTATE `PL005`, turned into a **429** rather than a 400, because the request
was well formed and the answer is "wait" rather than "fix it". `ApiError` gains
`rate_limited` for that: a kind earns its place when the client has to do
something different, and here it does.

**In the database rather than in Redis.** Redis is in the stack and a counter
with a TTL is the textbook tool. But Redis is only reached here when
`INGESTION_SCHEDULE=on`, and **a safety rule that stops working when an optional
dependency is missing is not a safety rule.** The same argument as the block and
the sanction: enforced where no caller and no deployment can route around it.

**Reaching people is limited; reporting them is not.** There is no clock-based
limit on reporting, deliberately. The one-open-report-per-subject index (T-210)
already limits it, and it limits by *target* rather than by time, which is the
right shape: a member genuinely harassed by twenty accounts must be able to
report twenty accounts. A ceiling there would be the exit gated, which is the one
thing this phase does not do.

**The trigger names decide which refusal speaks.** Postgres fires BEFORE triggers
in alphabetical order, so the new one is `friend_request_volume_guard` —
`block` < `sanction` < `volume`. A member who is both restricted and over the
ceiling is told about the **restriction**, because that is the one with an appeal
behind it. There is a test for exactly that, and it would pass silently under any
other name, which is why the name carries a comment.

**Two costs stated rather than hidden.** The window is fixed, not sliding:
somebody who spends their allowance at the end of one hour and again at the start
of the next gets twice the ceiling across that boundary — a sliding window needs
every event kept, and twice a ceiling for one minute is still a ceiling. And the
ceiling is a row, so blueprint 16's "configurable thresholds" is an UPDATE rather
than a migration; a test changes it and watches the behaviour change.

**And what is deliberately absent.** No classifier. D-054 carries the argument:
anything buildable here is an English keyword list shipping on a product that
speaks eight languages, under-moderating seven of them while the administration
page reports that filtering is on. A limit on volume works in every language;
that is the whole of the automation, and the tests read nothing anybody wrote.

Checked by breaking it: dropping the one trigger fails exactly the two tests
about counting and refusing. 4 tests; 50 across moderation and social together.

**E21 is complete.** No message can be sent in this product yet, and when the
first one can be, the report, the sanction, the queue, the audit trail and the
ceiling are already there (D-053).

---

## E22 — Conversations

Blueprint 8.3, and the heart of the phase. Direct conversations first, because a
group conversation is a conversation with a membership rule on top and building
it the other way round means writing the membership rule twice.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-220 | Schema and contracts: `conversation`, `participant`, `message`, per-conversation sequence | T-210 | Ordering is a property of the store, not of a clock; removal leaves a tombstone |
| `[x]` T-221 | The conversation API: open, send, page back, read state, mute, leave | T-220 | A blocked or sanctioned member cannot send; every conversation can be left |
| `[x]` T-222 | Shared football cards: match, article, team, player, prediction | T-221 | A card is a reference resolved at read time, never a copy of a score |
| `[x]` T-223 | Search within a conversation | T-221 | Finds a member's own messages in a conversation they are still in |
| `[x]` T-224 | The chat surface on the web, without realtime | T-222 | Usable and correct over plain requests, before a socket exists |
| `[x]` T-225 | Reactions, mentions and pinned messages | T-221 | Each one is a row of its own; a mention never reaches somebody who blocked the mentioner |
| `[x]` T-226 | Reactions, mentions and pins on the chat page | T-225, T-224 | Reacting works without JavaScript; a pin is reachable from anywhere in the conversation |

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

**T-225 was added on 2026-09-14, while T-220 was being built.** Blueprint 8.3
lists "replies, reactions, mentions and pinned messages" and this epic's plan had
a place for exactly one of them: `reply_to_id` is a column, and the other three
had nowhere to live. Rather than let them become a sentence in a review, they are
a row. The same thing happened to E13 in Phase 2, which began as four tasks and
ended as eight.

**T-220 verified on 2026-09-14.** `..._conversations.sql` is `conversation`,
`conversation_participant` and `message`;
`packages/contracts/src/conversations.ts` is the contract. Nothing in the API
writes them yet — that is T-221 — so `conversations.schema.spec.ts` writes what
the service will write and checks the half that belongs to the database, which
here is most of the interesting half.

**Ordering is a property of the store, and the test says so four ways.** Messages
are numbered from one within their conversation; two conversations count
separately (a global counter would leak how much the whole product is being used,
and would make "everything after 41" a question about the platform rather than
about this conversation); **a sequence a caller supplies is overwritten**, because
a number a client can choose is a number two clients will choose; and a refused
message does not spend one. That last is why the allocation trigger is named
`message_write_sequence` — Postgres fires BEFORE triggers alphabetically, so
`access` < `block` < `sanction` < `volume` < `write_sequence`, and every refusal
happens before a number is taken.

**This is the surface D-053 put the whole moderation epic in front of, and
nothing new was needed for it.** A block, a sanction and a ceiling already
existed; this migration wires the same three into a new write path and widens
their lists to cover it — `sanction.scope` gains `messaging`,
`report.subject_type` and `moderation_decision.subject_type` gain `message`, and
`rate_limit` gains a row — which is exactly what T-210 promised each later epic
would do rather than declaring the scopes up front. A message across a block
meets the same `PL003` a friend request meets, and a sanctioned member the same
`PL004`.

**A message is never rewritten, and that is a reading of the blueprint rather
than a shortcut.** Blueprint 8.3 lists replies, reactions, mentions and pins and
does **not** list editing — so there is no version table and no edit path. The
only permitted UPDATE is the tombstone; `PL007` refuses everything else,
including a DELETE, including a second removal (which would let a moderator
overwrite who took it down). The row stays with its number, so the conversation
around it still reads and the moderation record stays verifiable.

**A member who leaves keeps the history.** `left_at` stops them writing (`PL006`)
and the participant row stays, so what they were part of is still theirs to read.

**Read state is a column and a judgement.** `last_read_seq` is what an unread
count is built from; the contract only *shows* the other member's position in a
**direct** conversation, because in a two-hundred-person group a read receipt is
a surveillance feature nobody reads and everybody is subject to.

**One direct conversation per pair**, stored as the ordered pair the same way a
friendship is (T-200): two rows would be two histories for one pair. And
`conversation.kind` allows only `direct` until T-240 builds groups — a kind
nothing can create is a kind nothing should offer.

Checked by breaking it: dropping the access, block and rewrite triggers fails six
of the fourteen tests and no others. 14 tests against the real schema; the
migration was cycled down and up.

**What is not here.** No endpoint: opening a conversation, sending, paging back,
read state, mute and leave are T-221, and the football cards are T-222.

**T-221 verified on 2026-09-14.** `apps/api/src/modules/conversations/` is the
boundary: `conversations.service.ts` the public surface,
`internal/conversations-store.ts` every statement, and
`conversations.controller.ts` the routes — all under `/me`, because a
conversation is only ever answered *to a participant* and a route shaped like
`/conversations/:id` would invite a public reading of one.

**The judgement this task turns on: who may open a direct conversation.**
Blueprint 8.1 lists "start a direct conversation" among the things **friends**
can do, and taking that literally removes the whole direct-message spam surface —
there is no way to put words in front of somebody who has not agreed to hear
from you. The alternative, letting anyone message anyone and relying on blocking
afterwards, puts the burden on the person being messaged and only after the
first message has already arrived.

**But an existing conversation stays writable after a friendship ends**, and
that is the other half of the same judgement. Removing a friend and blocking
somebody are different acts — the friends page says so in as many words — and
making the first silently stop messages would collapse them into one while
leaving a conversation that looks open and is not. A member who wants the
messages to stop blocks, and the database refuses the next one.

**Correct before it is fast.** Nothing here needs a socket: opening, sending,
paging back, read state, mute and leave all work over ordinary requests. That is
what T-224 builds a page on, and it is why the transport of T-230 can be added to
something already right instead of becoming the source of truth by accident.

**`before` is a sequence, not an offset**, so a message arriving mid-scroll
cannot shift the page under somebody's thumb — the reason the ordering was a
sequence in the first place, arriving where a reader would feel it.

**Three answers are deliberately the same.** A conversation the viewer is not in
is **404, not 403**: a 403 would confirm that the id names a real conversation.
Removing a message that is not yours, already removed, or not there at all is one
404, because three answers would say which. And a reply pointing at another
conversation is a 400 rather than a silent null, because accepting it would be a
way to learn that a message id exists somewhere else.

**Every refusal that matters is still the database's.** The service catches
`PL003`, `PL004`, `PL005` and `PL006` and turns them into sentences; it never
checks first. The test proves the three that matter on this surface: a sanctioned
member is refused and told where to appeal, a block refuses **both** members, and
a member who has left can still read every word and write none.

11 tests over HTTP; 75 across conversations, moderation and social together.

**What is not here.** Search within a conversation (T-223), the web surface
(T-224) and reactions, mentions and pins (T-225).

**T-222 verified on 2026-09-14.** A message may now carry one football card, and
**a card is a reference rather than a copy.** The message stores a kind and a
UUID — no team name, no score, no kick-off time (rule 1) — and the card is
resolved when the conversation is read, carrying its own `last_updated_at`
(rule 4).

**That is the whole task, and blueprint 8.3 says why:** "Match cards shared in
chat remain live. The score and status update without replacing the original
discussion context." A score copied into a message at send time would be a stale
number displayed as a current one **permanently**, in a place nobody would ever
think to go and fix. The test is written at exactly that point: a fixture is
shared with no score, the score changes underneath it, and the same message — the
same sequence number, the same words, in the same place — comes back carrying
2–1.

**A card with no words is a message; nothing at all is not.** Sharing a match
without a comment is a real thing to do, so the body became optional when a card
is present and the CHECK now asks for one or the other.

**A removed message keeps no card.** A tombstone that held on to the reference
would leave a fragment of what was said surviving the decision to take it down,
and the rewrite guard was taught the two new columns — otherwise they would have
been the one part of a message anybody could change afterwards.

**Four kinds, and `article` is not one of them.** Blueprint 8.3 lists "a match,
article, team, player or prediction"; news does not exist until E14, so `article`
joins the CHECK in the migration that builds it. The same rule as every other
list in this phase.

**A member shares their own prediction and nobody else's.** A prediction history
may be private (T-056) and a card must not be the way around it, so the card is
refused unless the prediction belongs to the sender. It is always attributed when
it resolves.

**And an entity that no longer resolves is `gone`, not absent.** The message
still says somebody shared something; the product does not invent what.

**No foreign key on `card_id`, on purpose.** It names one of four tables by
`card_kind`, exactly as `audit_log.target_id` and `report.subject_id` do, so the
API checks the row exists on write — and a conversation full of cards does not
make deleting a fixture impossible.

The resolution is one query per kind rather than one per card, read straight from
the shared schema. That is the same call `consensus-store.ts` made in T-134: no
TypeScript crosses a boundary, and asking three public services would be the same
answer assembled by hand, one round trip per card.

17 tests over HTTP; 81 across conversations, moderation and social.

**T-223 verified on 2026-09-14.** `GET /me/conversations/:id/search?q=` finds
messages inside one conversation, newest first, each carrying its `seq` so
opening a hit is `?before=<seq + 1>` on the page endpoint — the same sequence the
whole surface is built on.

**The decision here is what it searches with.** Postgres's full-text search
stems words, and stemming needs a language: `to_tsvector('english', ...)` would
turn a product that speaks eight languages into one that searches well in one of
them and badly in seven, silently, with no page saying so. That is the shape of
the abuse classifier D-054 declines to build, in a smaller and friendlier
disguise.

So it uses what the product already normalises with — `search_key`, which folds
accents and case (T-038) and Arabic-script letter variants, digits and harakat
(T-152) — over a trigram index. Substring matching behaves identically in every
script it has been taught and claims nothing about meaning.

**A removed message is never a result.** A tombstone has no body to find, and the
index is partial for the same reason.

**Searching works after leaving.** The acceptance criterion says "a conversation
they are still in", and the honest reading is broader: leaving a conversation is
not losing what was said in it, and the read path already allows it.

A term shorter than two characters returns nothing rather than running — one
letter matches most of a conversation, which is a result nobody wanted and a scan
nobody needed.

4 tests; 35 across the two conversation suites.

**T-224 verified on 2026-09-14.** `/[locale]/messages` is the conversation list
and `/[locale]/messages/:id` one conversation: the messages, the composer,
search, paging back, mute and leave. `components/conversation.tsx` renders a
message and a card; `conversation-controls.tsx` is the small client half.

**The point of this task is what it does not have.** There is no socket, and
E22 was ordered so there would not be one yet. The page is a **server
component** and the composer is a **form over a server action**, so the whole
surface works without JavaScript and without a connection; sending re-renders
from the store, which is exactly what a reconnecting client will do when T-230
adds the transport. A page that were only right while a socket was open would
have made the socket the source of truth by accident, and `conversation.spec.ts`
asserts both halves so that T-230 has to be a deliberate addition rather than a
quiet replacement.

**A shared card is rendered as it is now**, not as it was sent: the fixture card
carries its `last_updated_at` (rule 4) and its score goes through `<Score>`, so a
right-to-left paragraph cannot lay `2 – 1` out backwards — the T-153 bug, which
would otherwise have come straight back on a brand-new surface.

**The guard found a real defect before the page was ever rendered.** The card
component's four kinds ended with `prediction` as the fall-through `return`,
which meant a fifth kind added to the contract would have been **silently
rendered as somebody's prediction** — a card mislabelled as a prediction product,
on a rule-6 product. Every kind is now an explicit branch, the last statement
says plainly that the page cannot show it yet, and the spec reads `CARD_KINDS`
out of the contract so the next kind fails the test rather than the reader.

**The exits are on the surface, on the day of the surface** (D-053): mute and
leave are here, and blocking and reporting are one link away on the member's
profile rather than re-implemented — one member with two block buttons that
could disagree is worse than one.

**"Read" means "opened", and the product does not claim more.** The read
position moves when the page renders. A script watching the viewport would let
the product claim that somebody read a particular message, which is a thing no
page actually knows.

**A removed message is a tombstone that says who removed it**, and every section
states its own absence rather than vanishing — the T-137 lesson, applied again.

9 guard tests; 143 across the web app.

**T-225 verified on 2026-09-14 — the API half.** `..._reactions-mentions-pins.sql`
adds `message_reaction`, `message_mention` and `conversation_pin`, and the
endpoints are `PUT`/`DELETE .../reactions/:reaction` and `POST`/`DELETE
.../pin`. Rendering them on the chat page is **T-226**, added here rather than
squeezed in: this task already spans six files and `CLAUDE.md` §3 says to split
at that point rather than past it.

**Each one is a row of its own**, which is the acceptance criterion and also the
only shape that works: a message takes exactly one UPDATE — the tombstone
(T-220, `PL007`) — and all three of these change after it was sent. A `pinned_at`
column would have meant relaxing that rule for the second time in one epic.

**A closed set of six reactions.** An open `emoji text` field is a small
free-text box attached to somebody else's words, and a small free-text box is
where abuse goes once the big one is moderated. Agree, disagree, laugh, surprise,
sad, celebrate is what a football conversation actually does.

**A mention is resolved once, on write, against the people already in the
room.** Two judgements in one sentence. Resolving `@name` again at read time
would change who a two-year-old message mentioned every time somebody renamed
themselves. And mentioning somebody who is **not** in the conversation would put
a notification in front of a stranger — the direct-message spam surface arriving
through a side door, after T-221 closed the front one.

**A mention never reaches somebody who blocked the mentioner**, by trigger
(`PL003`). Today it cannot be triggered at all: in a direct conversation the
block already refuses the message. It is here for the groups of T-240, where two
members who have blocked each other can share a room and one of them must not be
able to put the other's name in front of them. A refused mention is **dropped
rather than failing the message** — the words were already said and already
stored, and taking the whole message down because one name in it could not be
delivered is a worse answer than delivering the rest.

**A removed message leaves no applauded outline.** The tombstone already dropped
the body and the card (T-220, T-222); it now drops the reactions and the pin too,
by trigger. A highlighted, applauded outline of something that was taken down is
most of what was taken down. Checked by breaking it: dropping that one trigger
fails exactly that test.

**A pin is sent back whatever page is being read.** A pin nobody can find once
the conversation has scrolled past it is not a pin, so `ConversationPage.pinned`
is always there, independent of the window the reader is in.

**The test found a real gap.** `PL007` — something attempted on a removed
message — had no mapping in the service, so reacting to a tombstone was a **500**
rather than "that message has been removed". It is a 409 now. The test was
written from the rule rather than from the behaviour, which is why it caught it.

5 tests; 40 across the two conversation suites, 90 with social and moderation.

**T-226 verified on 2026-09-14, and E22 is complete.** The chat page now shows
the three: reaction buttons under every message, who was mentioned, and a
**Pinned** section at the top.

**Reacting works with no JavaScript**, which is the acceptance criterion and also
the point. Each reaction is its own form over a server action, and the ones
nobody has used yet sit behind a `<details>` — the one disclosure widget the
browser gives for free. A popover would have needed a script and would have made
this the first control on a surface whose whole purpose is being correct before
the socket of T-230 exists.

**Who was mentioned is said beside the message, not woven into it.**
Highlighting `@name` inside the body would mean parsing text the API already
parsed once, and the two could disagree about who was named — especially after
somebody renames themselves, which is the exact thing storing the mention was
meant to survive.

**The pinned section is there whatever page is being read**, because that is what
the contract sends and what a pin is for.

**Checked live, not only in types.** API on 3002, `next dev` on 3100, two members
with a mention, a reaction, a pin and a shared fixture: the page renders "Agree 1",
"Mentioned @demo_bo", "Pinned in this conversation", the `React` disclosure with
the five unused reactions, and the live card reading "Liverpool v Manchester
United 2 – 2 · finished · Updated …". And on `/ar` the same card's score is
inside `dir="ltr"` — the T-153 bug does **not** come back on a brand-new surface,
confirmed by looking rather than by trusting the guard. The demo accounts were
removed afterwards.

13 guard tests; 147 across the web app.

**E22 is complete.** A conversation can be opened, read, written to, searched,
reacted to, pinned, muted and left, and every one of those works over ordinary
requests. T-230 now has something correct to add a transport to.

---

## E23 — Realtime delivery

D-010 reserved WebSockets for exactly this. E22 made the conversation correct
without one; this epic makes it immediate.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-230 | The gateway: session-cookie auth, subscribe to conversations you are in | T-221 | A socket can only ever carry conversations its member participates in |
| `[x]` T-231 | Fan-out across instances | T-230 | A message written on one instance reaches a socket held by another |
| `[x]` T-235 | Gap recovery by sequence | T-231 | A reconnecting client asks for everything after N and misses nothing |
| `[x]` T-232 | Live match cards: the card updates, the conversation does not move | T-222, T-032 | A score change updates a shared card without a new message |
| `[x]` T-233 | Observability: connections, delivery latency, `GET /health/chat` | T-231 | A silent socket layer is visible from the admin area, not from a complaint |
| `[x]` T-236 | The live paths on the operator's page | T-233, T-071 | An operator sees the score stream and the chat layer without a terminal, and is told when they could not be asked |
| `[x]` T-234 | The socket at one origin: the edge route | T-231 | The browser can reach the socket on the web origin, with no CORS and no second host |
| `[x]` T-237 | The chat page listens | T-234 | A message appears without a refresh, and the page falls back to the requests that already work |

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

**T-231 was two acceptance criteria in one row, and is now two rows.** Fan-out
and gap recovery are different mechanisms — one is a channel between instances,
the other is a query and a frame — and together they were eight files, past the
point `CLAUDE.md` 3 says to split at. T-231 keeps the sentence it is about ("a
message written on one instance reaches a socket held by another") and **T-235**
takes the other one unchanged. The order is not arbitrary: recovery has to
interlock with subscription registration, and that interlock is only meaningful
once there is live delivery to race against.

**T-230 added T-234, which the plan was missing.** D-027 routes every browser
request through the web origin and no Next.js route handler can answer an
`upgrade`, so *how the browser reaches the socket* is a real piece of work — an
edge route in front of both apps — and it was not a row in this table. It is one
now, after T-231, because connecting a browser to a transport nothing publishes
into yet would only prove the handshake twice.

**T-230 verified on 2026-09-14.** `apps/api/src/modules/conversations/chat.gateway.ts`
answers an `upgrade` on `/me/conversations/socket`: one `ws` server with
`noServer: true`, attached to the Node server Fastify already listens on
(D-055). The protocol is in `packages/contracts/src/chat-socket.ts`.

**The socket delivers; it never decides.** The only two frames a client may send
are `subscribe` and `unsubscribe`. Everything a member can change stays on the
HTTP surface of T-221, where each write already passes the database guards. A
socket that could also write would be a second place to get PL003 to PL007 right,
and the second place is the one that is wrong.

**Authorisation happens twice, and the second time asks a different question.**
Subscribing checks participation; so does every delivery, because a socket is
long-lived and membership is not. Building the delivery check is where a real
defect surfaced: `participation()` still returns a row after a member leaves —
deliberately, so that history stays readable (T-223) — so the first version
happily kept delivering to somebody who had left, and the test caught it. Live
delivery and readable history are two questions, and the gateway now asks both.
That is also why a member who has left is refused with `not_a_participant`
rather than `not_found`: they can still read the conversation over HTTP, so
"there is no such conversation" would be a lie they could disprove.

**The `Origin` header is a security control here, not a setting.** A WebSocket
handshake is not subject to CORS: any page on any site can open one to us and
the browser will attach the session cookie to it. The allow-list is the whole
defence, so the test for it runs with a **valid** session — refusing an
unauthenticated stranger would prove nothing about cross-site hijacking.

**A session that ends closes the socket.** The heartbeat that notices a dead
connection also re-authenticates it, so logging out hangs up the delivery channel
instead of leaving it open until the tab closes.

**Nothing publishes into it yet, and that is the point.** Fan-out is T-231 and
goes through Redis from its first commit. An in-process fan-out would work here,
work in a one-instance preview, and then silently deliver half the messages the
day there are two instances — so this task ships the leg a fan-out needs and
stops, rather than shipping a working version of the wrong thing.

14 tests, on a real listening server with real sessions: an upgrade is the one
thing `app.inject` cannot stand in for. 54 across the three conversation suites.

**What is not here.** The browser cannot reach it (T-234), nothing publishes into
it (T-231), and the Koyeb preview has no edge that would route it (D-051).

**T-231 verified on 2026-09-14.** `internal/chat-bus.ts` is a Redis pub/sub
channel with the two connections Redis requires (a client in subscribe mode may
issue nothing else). `ConversationsService.send` publishes after the message is
stored; every instance's gateway takes from the channel and delivers to the
sockets that asked for that conversation.

**The test runs two whole API instances.** One Postgres, one Redis, two Nest
applications listening on two ports — because a single-instance test would pass
with an in-process fan-out and prove nothing, and in-process fan-out failing
silently at two instances is the exact accident this task exists to prevent. A
message posted through instance alpha arrives on a socket held by instance beta.

**One channel, not one per conversation.** Every instance hears every broadcast
and drops what no local socket asked for. Per-conversation channels would save
that filtering and cost a Redis subscription table that has to stay in step with
the socket registry through every subscribe, leave, disconnect and crash — two
sources of truth for who is listening, which is the shape of bug this epic is
built to avoid (D-056).

**A broken bus never breaks a send.** The message is stored and answered for
before anything is published; a publish that throws is logged and dropped. What a
client loses is immediacy, and T-235 is how it gets the rest back.

**With no `REDIS_URL` there is an absent bus that says so.** It logs once, and
reports `healthy: false` for T-233 to publish. The alternative — a fan-out that
quietly delivers nothing — is the failure mode this epic keeps naming.

**It also fixed something that was already broken.** BullMQ 6 takes its Redis
client as an *optional* peer dependency, and nothing had installed one: a probe
against the running Redis failed with "BullMQ could not load the optional
'ioredis' package". The ingestion scheduler (T-026) would have thrown on boot the
first time `INGESTION_SCHEDULE=on` was set. Adding `ioredis` for the chat bus
gives BullMQ the client it was missing; a regression test for the scheduler is
its own task.

5 tests (4 across two instances, 1 on the absent bus); 59 across the four
conversation suites. CI gains a Redis service, for the same reason it has a
Postgres one: without it the only test that can catch this is skipped.

**What is not here.** Gap recovery (T-235), the browser (T-234), and live
delivery of anything but a new message: a removal, a reaction and a pin still
need a re-read, because none of them has a sequence number and gap recovery is
what makes a live update safe to rely on.

**T-235 verified on 2026-09-14.** `subscribe` carries an optional `after_seq`
and the answer is a `catch_up` frame: at most one page of messages, oldest
first, with `more` when the gap was longer than that.

**The order is the guarantee.** The subscription is registered **before** the
history is read, never after. Live first and history second means a message
written in the moment between them arrives *twice*; history first and live
second means it arrives *never*. A duplicate the client drops by sequence is
cheap; a missing message is invisible, which is the failure the acceptance
criterion is written against. There is a test for exactly that window: a message
is posted at the same instant as the `subscribe` frame, and the assertion is on
the **union** of what came back — not on which channel carried it, because
either is correct.

**An empty answer is still an answer.** A client that missed nothing gets
`catch_up` with no messages, because no frame and an empty frame look identical
to something that is waiting, and only one of them means "you are up to date".

**Bounded at one page, and it says so.** A client whose gap is longer than fifty
messages has been away long enough that reading the conversation is the right
answer, not replaying it down a socket. `more: true` is how it learns to go and
read instead of waiting for the rest.

**Leaving ends the claim on what comes next, not the history.** `since()` refuses
a member who has left even though they can still read and search the
conversation (T-223) — the same second question the delivery check has to ask,
asked here rather than trusted from the caller.

**It caught something T-231 had got wrong.** The race test failed in CI while
passing locally, and the reason was in the log above the failure: *"REDIS_URL is
not set; chat is not delivered live"*. Turborepo passes tasks only the
environment variables named in `globalEnv`, and `REDIS_URL` was not one of them.
So `pnpm test` — which is what CI runs — had been hiding it: **T-231's
two-instance fan-out test was skipped in CI, not passed**, and the Redis service
added for it was never used. Running `pnpm --filter @fmip/api test` locally
bypasses Turbo, which is exactly why it looked green. `REDIS_URL` is in
`globalEnv` now, and the fan-out suite runs where it was meant to.

The lesson is not about Redis. A suite that skips reports success, and the only
thing between "this is covered" and "this is skipped" is a line in a summary
nobody reads twice.

6 tests; 19 in the gateway suite, 65 across the four conversation suites.

**T-236 is the operator's end of this epic. E23 is otherwise complete.**

**T-234 verified on 2026-09-14.** `deploy/Caddyfile` routes the exact path
`/me/conversations/socket` to `api`; everything else still goes to `web`. Two
`handle` blocks, so they are mutually exclusive and the socket can never also be
handed to the web app. Validated with the real Caddy (`caddy validate` in
`caddy:2-alpine`): the config adapts, and the only complaint is a TLS
certificate that exists on the server and not on this laptop.

**An exact path, not a prefix.** This is the only upgrade the API answers, and a
prefix would quietly hand the API any path added underneath it later.

**One origin is the point, not a detail.** D-027 says the browser talks to the
web app and never to the API. A socket cannot honour that literally — App Router
route handlers answer requests, not upgrades, so there is no way for Next.js to
proxy one. Routing it at the edge keeps what D-027 is *for*: the browser sees a
single origin, the session cookie is sent, and no CORS is configured anywhere.
A second public host for the API would have meant CORS, a second cookie domain,
and the origin allow-list of D-055 doing real work in production rather than
standing as a guard.

**The task was two things and is now two rows.** "The edge route, and the page
that connects" put a deployment decision and a client component in one
acceptance criterion. The page is **T-237**, and it is the larger half: the E22
surfaces are deliberately script-free, so a socket has to arrive as an
enhancement that adds nothing the page depends on.

**The free preview does not get this, and says so** (`docs/11-koyeb.md`). It has
no Redis, so the bus is `absent`; and it has no edge, because one published port
is held by Next.js. Conversations work there in full — every one of them works
over ordinary requests — and what is missing is immediacy. Which is also why the
instance sleeping after an hour, and dropping every socket with it, costs that
preview nothing.

**T-237 verified on 2026-09-14, in a browser.** `live-conversation.tsx` opens
the socket, subscribes with the page's `latest_seq`, and when something happens
asks the page to render itself again.

**It renders no message.** That is the whole design. The server already resolves
the cards, the reactions, the mentions and the pins and lays a message out once;
a client that rendered arriving messages itself would be a second way a message
can look, and the two would disagree the first time either changed. Nothing here
holds a copy of the conversation, so there is no client-side state to fall out of
step with the store — which is the same reason E22 was built before E23 at all.

**It adds and takes nothing away.** With no JavaScript, a closed socket, or a
deployment with no Redis, the page is exactly what it was. And it says which:
"New messages appear here as they are sent" or "Not live right now. Reload to
see anything new." A socket that quietly stopped delivering while the page
looked live would be rule 4 broken on a surface with no timestamp to break.

**A hidden tab waits.** Opening the page is what marks it read (T-224), so
refreshing a tab nobody is looking at would have the product claim a message was
read by an empty room. The refresh is held until the tab is visible again.

**Checked by watching it.** API on 3002, `next dev` on 3100, two demo members
and a real browser:

- a message sent by the other member appeared with nothing touched
- the API was stopped: the line became *"Not live right now"* and the three
  messages already on the page stayed exactly where they were
- a message was sent while the socket was down; the API came back, the socket
  reconnected, `after_seq` brought back what had been missed (T-235), and it
  appeared — the gap closed without a reload
- the same on `/ar`, `dir="rtl"`, socket live

Demo accounts were deleted afterwards; the local database is back to zero.

4 guards; 151 across the web app. The guards are about the promise rather than
the markup: the live component contains no message rendering, the page is still
a server component that renders the conversation itself, the offline state is
stated, and the subscription carries a sequence.

**T-236 verified on 2026-09-14. E23 is complete.** `health-panel.tsx` puts the
score stream and the chat layer on the administration page, beside the ingestion
block that has been there since T-070.

**Unreachable is stated, never rendered as zero.** "No connections" and "we
could not ask" are different facts, and the second shown as the first is rule 3
on an operational surface -- a module that looks populated and is not. Each of
the two has its own stated absence.

**Every chat number says whose it is.** Sockets live on the instance that
accepted them, and this page asked one of them. A count presented without that
would be read as the fleet's, and nobody measured that one.

**"Nothing delivered yet" is not zero milliseconds**, which would be the most
flattering possible lie about a channel that has carried nothing at all.

**The guard caught a fall-through, again.** `busWords` handled `connected` and
`absent` explicitly and let `down` fall out of the last line -- so a fourth
state would have been reported as "down". The guard reads the states from the
contract, which is what made that a failing test rather than a plausible
sentence. The same shape of defect as the card kinds in T-226, caught the same
way.

5 guards; 156 across the web app.

**T-233 verified on 2026-09-14.** `GET /health/chat` answers with this
instance's socket layer in numbers: bus state, open connections, held
subscriptions, events delivered, subscriptions dropped at delivery, handshakes
refused by reason, and delivery latency as p50/p95 over the last hundred
events.

**Every number belongs to one instance, and it says which.** Sockets live on the
process that accepted them, so a fleet has as many of these answers as it has
instances; `instance` is a short id generated at boot, and two different values
are two processes. A total across the fleet is a question for whatever scrapes
this, not a number an endpoint that can see one process may invent (rule 3).

**Three states for the bus, not two.** `absent` is a deployment with no
`REDIS_URL`; `down` is one that had a connection and lost it. Merging them into
"unhealthy" would put "we never configured it" and "it broke at 02:00" on the
same dashboard line, and they are problems for different people.

**Latency is measured against the publishing instance's clock**, which is honest
about skew rather than hiding it: two instances whose clocks disagree show the
disagreement here. A hundred samples rather than an average since boot, because
an average over a whole uptime hides the ten minutes it was slow, which is the
only part anybody asks about. `null` until something has been delivered --
because no deliveries is not zero latency and must not be reported as it.

**It names nobody.** No username, no conversation id, no message. There is a
test that asserts exactly that: an operational number which identifies who is
talking to whom is not an operational number. That is also why the endpoint is
public and read-only, like `/health/live` beside it.

**The acceptance criterion says "the admin area", and this task ships an
endpoint.** The surface is **T-236**, because a chat panel alone would have been
a third place operational numbers live.

*(Corrected while building T-236: this note first said there was no health
surface in the admin area at all. That was wrong. The administration page has
had an **Ingestion** section since T-070 -- it reads the same numbers from the
administration overview rather than from `/health/ingestion`. What was missing
was the live path and chat, which is what T-236 adds beside it.)*

6 tests; 25 in the gateway suite, 71 across the four conversation suites. One of
them measures a real cross-instance delivery end to end: publish on alpha,
deliver on beta, read the number from beta's `/health/chat`.

**T-232 verified on 2026-09-14.** When a shared fixture moves, the card is sent
again as a `card` event naming the message it hangs on, so a client replaces it
in place. T-222 had already made this true of a *read* — the card is resolved
every time the page is built; this is the other half, for a reader who is
already looking.

**The conversation does not move, and the test says so two ways.** No message is
written (the row count before and after is the same), and nothing else comes
down the socket. A chat that scrolled because a goal was scored would be
reporting the goal as though somebody had said it.

**This one does not go through Redis, and that is the interesting part.** A
fixture change is already announced to *every* instance by Postgres (T-032,
D-034), so each one refreshes its own sockets. Publishing it on the chat bus as
well would deliver every card update once per instance. A message is the
opposite case — written on one instance, needing to reach the others — which is
why the two live paths in this epic are deliberately different.

**A burst collapses into one refresh.** A goal is three writes — score, status,
minute — inside a few milliseconds, and the reader wants one updated card. The
debounce is per fixture rather than global, so two matches kicking off together
do not wait for each other.

**A change nobody is watching costs one `Set` walk and no query.** The gateway
asks only about conversations some socket on this instance is subscribed to,
which is also why this needs no index nobody has.

**One sentence taken from another boundary, through a port.** The gateway
depends on `FIXTURE_CHANGES` — "a fixture moved" — and one line in
`conversations.module.ts` binds it to the fixtures boundary's feed. The same
shape as `FRIENDSHIP_ORACLE` in the profile module, and the reason the rest of
this module still knows nothing about fixtures.

**A tombstone has no card to refresh**, and a card that stopped resolving pushes
nothing rather than pushing `gone`: the card a reader already holds is what it
was, and inventing an ending for it is this surface telling a story.

5 tests, in a suite of their own because they need a fixture of their own; 76
across the five conversation suites.

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
