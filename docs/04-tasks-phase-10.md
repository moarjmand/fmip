# Phase 10 — News depth and community depth

Phases 1 to 9 built the product the blueprint describes, put it on a live
server, and finished the pages people see first. What is left in the two
areas this phase covers -- news, and the places members talk -- is a set of
promises that were each built partly. A comparison of `product-blueprint.md`
sections 2.3, 3, 5.3, 8, 9.4, 10, 12 and 13 against what is built
(2026-09-29: the roadmap's "Where it stands" paragraphs, `03-project-map.md`,
the decisions to D-122, and the schema where a doubt had to be settled) found
four kinds of gap:

- **News that cannot be sorted by what it is.** A story has no type
  (`story` and `article_version` carry none), so blueprint 3.2's story types
  and the filter by type do not exist. The `/news` filters are country,
  competition, team and language; there is no player or date filter. Nobody
  can mark a story "breaking", so the homepage has no breaking strip (2.3)
  and nobody can be told (12.2). Trending counts only panel discussion
  (`limited`, `discussion_only`), although saves have been recorded since
  T-842 (3.1). The clustering links teams and competitions and **never a
  person** (T-142), although `article_entity` already accepts `person`, so the
  player page has no related news and no current availability (5.3). Which
  competitions the carried feeds actually cover is nowhere stated (3.2).
- **A translator's desk that is an API.** T-304 stores a person's version of
  an article in another language and a second person's review, over
  `POST /admin/articles/:id/translations`. There is no page for it, no
  automatic check that numbers, scorelines, names and links survived, and no
  shared glossary or translation memory (13.1, 13.2). The words stay the
  translators' (T-305): this phase builds tooling only.
- **Groups without their owners' tools.** Blueprint 8.2's invite links, an
  owner's rule on who may invite, membership rules, a preferred language and a
  favourite club or competition are not built. The schema lets a message be
  removed as `moderator`, but nothing in the API lets a group's owner or
  moderator do it. Administrators cannot close a group (10.4):
  `moderation_decision` takes only a member as its subject.
- **The public discussion and the contributor, one step short.** A panel post
  cannot be linked to an incident, a player, a prediction or a statistic
  (10.2). A contributor whose rating stays below the threshold is noticed by
  nobody (9.4): pausing is a manual act (`ContributorService.pause`) with no
  prompt behind it.

**Dropped from the outline because it is built.** Injury and suspension
alerts for followed teams: `match_availability` (T-832, D-100) already tells
a follower, once per match, when the licensed feed lists a player out, with
the reason the feed gives. What is not built is a transfer feed and an
injury list outside a match, which is a question about the feed's terms and
budget (N-2), not a task. Chat's replies, reactions, mentions, pins, search
and shared cards (8.3), following a contributor (10.2), the member comparison
(8.1), group polls (8.2) and saved articles (3.3) are built.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**Numbers are assigned here, so parallel agents do not collide.** Every
decision entry a task needs has its number below (D-123 to D-137). So does
every migration a task needs (timestamps from `1764900000000`, in steps of
`10000000`). An agent takes the number its row names and no other. A task
that finds it needs no decision or no migration leaves its number unused and
says so in its PR. It never passes the number to another task. A task that
finds it needs one it was not given stops and asks, and does not take the
next free number.

| Decision | Task | Subject |
|---|---|---|
| D-123 | T-1001, T-1002 | Story types: blueprint 3.2's vocabulary, from the publisher's own category by an exact committed mapping or from an editor's mark, never from a machine |
| D-124 | T-1003 | News filters by story type, player and date, and what a filter says about the stories it cannot place |
| D-125 | T-1004, T-1005 | "Breaking": an editor's mark with a window, the homepage strip, and who is told |
| D-126 | T-1006 | Linking a person to a story: the rule, its precision on a sample, and what it never does |
| D-127 | T-1007 | A player's related news and current availability |
| D-128 | T-1008 | Trending counts saves beside discussion |
| D-129 | T-1010 | News coverage per competition, stated rather than implied |
| D-130 | T-1011, T-1014 | The glossary is the translators' file per locale; translation memory is a named person's earlier reviewed words, suggested and never filled in |
| D-131 | T-1012 | The automatic translation checks, and a reviewer's recorded reason to pass one |
| D-132 | T-1020, T-1021 | Who may invite to a group, and invite links |
| D-133 | T-1022, T-1023 | A group's language, favourite club or competition, and written rules |
| D-134 | T-1024 | A group's owner and moderators removing content |
| D-135 | T-1025 | Administrators closing a group and removing its content |
| D-136 | T-1030 | A panel post linked to one incident, player, prediction or statistic of its match |
| D-137 | T-1031 | A contributor below the threshold for a sustained period is flagged, never paused |

| Migration | Task | For |
|---|---|---|
| `1764900000000` | T-1001 | `story_label`: a story's type, its origin (`publisher` or `editor`), who and when, superseded rather than edited |
| `1764910000000` | T-1002 | `article_category`: the category strings a publisher's feed carried on an item, as carried |
| `1764920000000` | T-1004 | `story_breaking`: an editor's mark, its note, its end, and its clearing with a reason |
| `1764930000000` | T-1005 | The `breaking_news` notification kind and its preference, off by default |
| `1764940000000` | T-1012 | `translation_check_override`: a reviewer's reason for passing a failing check on one version |
| `1764950000000` | T-1020 | `user_group.invite_policy` |
| `1764960000000` | T-1021 | `group_invite_link`: a token's hash, its creator, expiry, use cap, uses and revocation |
| `1764970000000` | T-1022 | `user_group.language`, `favourite_team_id`, `favourite_competition_id` |
| `1764980000000` | T-1023 | `group_rules_version` and the version each member accepted on joining |
| `1764990000000` | T-1025 | `user_group.closed_at` with its reason, and `moderation_decision` taking a group as subject |
| `1765000000000` | T-1030 | `panel_post` link columns, one link at most, constrained to the post's fixture |
| `1765010000000` | T-1031 | `contributor_flag` and the `contributor_below_threshold` notification kind |

T-1006 needs no migration (`article_entity` already accepts `person`). T-1024
needs none (the schema already allows `removed_kind = 'moderator'`). If
either finds otherwise, it stops and asks.

**Nothing labels a story by machine.** A type comes from the publisher's own
category through an exact, committed mapping, or from an editor. Labelling
publishers' headlines with a language model (D-070) touches the feeds' terms
(D-061) and is N-1, carried from Phase 9's N-8.

**The translators' words are theirs.** No task writes a translation, a
glossary entry's target term or a catalogue string, and no task fills a
field from translation memory without a person choosing it. The glossary's
English source terms may be generated from the catalogue and the entity
names; everything in another language is written by a person (T-305, D-066).

**Nothing here buys, opens an account, or holds a secret.** Every task is
agent-buildable under the standing delegation of 2026-09-26, with a
revisable decision entry. Two carry a number that is the maintainer's
policy, built with a stated proposal the maintainer may change: T-1031's
sustained period (N-7), and T-1010's statement of which publishers to add,
which it reports and does not act on (N-8).

**News stays off the critical path** (rule 9, D-061). A match, its score and
its forecast never depend on anything in E100.

---

## Exit criteria

- A story has a type where its publisher or an editor gave one, and says it
  has none otherwise. News filters by type, player and date.
- An editor can mark a story breaking; the homepage shows it while the mark
  lasts; a member who opted in is told once.
- A player page shows related news and the player's current availability,
  or says which is not supplied.
- Trending counts saves beside discussion and says so.
- A translator and a reviewer work on the web, see every automatic check
  and the glossary, and cannot pass a failing check without a recorded
  reason.
- A group's owner can decide who invites, share an invite link, set rules,
  a language and a favourite, and remove content. Administrators can close a
  group, with a reason and an audit row.
- A panel post can point at one thing in its match. A contributor below the
  threshold for the stated period reaches the administrators, and nothing
  pauses them automatically.

---

## E100 — News depth

*Agent-doable. No machine labelling (N-1). No new provider request.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1000 | This plan | — | `04-tasks-phase-10.md`, the roadmap's Phase 10 section and the Phase 11 outline after it merged |
| `[x]` T-1001 | Story types: the contract's closed vocabulary (blueprint 3.2's eleven), `story_label` with origin `publisher` or `editor`, and `POST /admin/stories/:id/type` for an editor, beside the debate mark. The story card and page carry `type: Covered<StoryType>`. D-123; migration `1764900000000` | T-144, T-907 | A story with no label is `not_supplied`, never a default type. A new label supersedes the old one; nothing is edited. Every editor write is an `audit_log` row with the previous label (rule 10). A fourth origin fails the build |
| `[x]` T-1002 | Types from the publisher's own category. The feed reader keeps each item's category strings as carried (`article_category`). A committed list maps (the source's feed host, the exact string) to a type; the story takes its promoted original's mapped type unless an editor has labelled it. D-123; migration `1764910000000` | T-1001 | An unmapped string gives no type, never a guess. No similarity or keyword rule. A test per mapped source with a recorded feed item. An editor's label always wins and is never overwritten by a later fetch |
| `[x]` T-1003 | News filters by story type, player and date: `/news` takes `type`, `player` and `from`/`to`, applied to the whole cluster as the existing filters are; the news page gains the controls. D-124 | T-1001, T-1006 | A type filter says how many stories in the window have no type and are therefore not shown. A player filter before T-1006 has linked anybody says `not_supplied`, not "no news". Dates are the story's first publication, in the viewer's time zone |
| `[x]` T-1004 | "Breaking": an editor marks a story breaking with a note, for a stated window (proposal: 6 h), and may clear it early with a reason. The homepage shows a strip of the marked stories while their windows last. D-125; migration `1764920000000` | T-1001 | Audited on mark and clear. An expired mark disappears on the next render, not on the next job. A guest sees the strip. With nothing marked there is no strip, not an empty one. The RTL test covers the strip |
| `[x]` T-1005 | The breaking alert: `breaking_news`, opt-in (off by default), to members who follow a team, competition or person the story links, once per story, deep-linked to the story. D-125; migration `1764930000000` | T-1004, T-331 | Quiet hours, mutes and the frequency cap apply as to every kind (12.2). A story marked, cleared and marked again is told once. A story that links nothing a member follows reaches nobody |
| `[x]` T-1006 | Persons linked to stories. The clustering links a person when a headline or summary carries their full name or a recorded alias as whole words, the person has a current spell at a team the story also links, and no other person in those squads matches. Measure the rule's precision on a sample of stored headlines before it writes. D-126 | T-142, T-303 | Precision recorded in D-126 from a hand-checked sample; the rule is off if it is under the bar the decision states. Rule 1: the link is by UUID, and a name that matches two people links neither. No surname-only match. The following section includes followed persons once links exist |
| `[x]` T-1007 | The player page's related news (`GET /players/:id/news`, the entity-news shape of D-119) and current availability: whether the feed lists the player out or doubtful for their team's next scheduled match, from `fixture_absence`. D-127 | T-1006, T-103, T-944 | Blueprint 5.3. Availability is `not_supplied` when the next match has not been asked, "not listed" when it was asked and the player is absent, never "fit" (the feed never says fit, T-103). News is `not_supplied` with `feeds_unread` as on the team page. No new provider request |
| `[x]` T-1008 | Trending counts saves: distinct members who saved the story in the window, beside distinct members on its matches' public panels, each weighted as D-128 states. The section's `limited` reason names both signals | T-842 | Blueprint 3.1. Views and shares are not counted (N-3) and the reason says so. A save moved by a cluster merge counts once. The section stays within its query budget (a test on a seeded 10,000-save table) |
| `[x]` T-1009 | The editor's news desk in the console: debates (the API exists), story types and breaking, one page, `editor` or `admin` | T-1001, T-1004 | Every action takes a reason where the API asks for one and shows the audit history of the story. A member gets `forbidden` (T-904). No new API beyond what T-1001 and T-1004 add |
| `[x]` T-1010 | News coverage per competition, stated. For each active competition: the carried sources that linked a story to it in the last 30 days, and the count. The competition page's news module is `limited` with a reason when the count is under D-129's floor; the console lists the gaps | T-944 | Rule 3: a competition with no carried source never shows a news module that looks populated. The console names the gap and does not add a source: which publishers to add is N-8 |

## E101 — The translator's desk

*Agent-doable, tooling only. The words are the translators' (T-305).*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1011 | The shared football glossary: a committed file per locale beside the catalogues, each English term with its locked flag and a target term with a status a person set (D-066's shape). `i18n:glossary` adds new source terms from the catalogue's football terms and the entity names; `--check` runs in CI. D-130 | T-302, T-303 | The script never writes a target term. A translated entry with no status fails the check. A locked term (a name, a competition) is one the checks in T-1012 enforce |
| `[x]` T-1012 | The automatic checks, a pure function over a source version and a target version: numbers (Latin, Arabic-Indic and Persian digits compared as numbers), scorelines, dates, the entity names the article links (in the target locale's localised name or the glossary's term), links, empty fields and markup. The review endpoint refuses a version with a failing check unless the reviewer records a reason. D-131; migration `1764940000000` | T-304, T-1011 | A test per check with a passing and failing pair, right to left included. The override names the reviewer, the check and the reason, and is an `audit_log` row. A check never rewrites the text |
| `[x]` T-1013 | The desk on the web console: a queue of articles by language (to translate, awaiting review, reviewed), the write form and the review form over T-304's API, each check's result beside the field it concerns, and the glossary terms found in the source | T-1012 | The author cannot review their own version (as the API already refuses). A source whose rights allow only a headline offers only the headline (PL016). The RTL test covers the form in Arabic. Only the roles T-304 admits reach it; everyone else gets `forbidden` |
| `[x]` T-1014 | Translation memory: for a source string, the reviewed translations of the same string in the same language, each shown with its author, reviewer and date, offered for the translator to copy. D-130 | T-1013 | Exact matches only. Nothing is inserted without the translator choosing it. A memory entry whose version was corrected shows the correction |

## E102 — Groups, run by their owners

*Agent-doable. Every refusal stays the schema's (D-057), and an invite-only
group stays 404 to anybody who has not been told it exists.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1020 | Who may invite: the owner sets `invite_policy` to owner only, owner and moderators, or every member; direct invitations obey it. D-132; migration `1764950000000` | T-241 | The schema refuses an invitation the policy does not allow, and the API explains it. Changing the policy is audited in the group's history. Existing groups keep today's behaviour as their default |
| `[x]` T-1021 | Invite links: a person the policy allows creates a link with an expiry and a use cap, and may revoke it. Following a link joins the group, or files a join request for a discoverable group whose owner asks for one. D-132; migration `1764960000000` | T-1020 | Only the token's hash is stored. A revoked, expired or exhausted link says which, and an invite-only group behind a dead link stays 404. Blocks, `groups` sanctions and the verified-e-mail gate apply as to a direct invitation. Link creation has a rate limit (D-103's inventory) |
| `[x]` T-1022 | A group's preferred language and favourite club or competition, by UUID; the directory filters by both, and the group's page and conversation render with the language as their `lang` attribute. D-133; migration `1764970000000` | T-242, T-303 | Rule 1: a favourite is an id, never a name. A group with none says nothing rather than "none". Machine translation of members' words stays declined (13.2, D-061) |
| `[x]` T-1023 | A group's rules: the owner writes them (versioned, never edited in place); a member reads them before joining and the version they accepted is recorded; a new version is shown once to existing members. D-133; migration `1764980000000` | T-241 | Joining a group with rules without accepting them is refused by the schema. Nobody is removed for not accepting a newer version. The rules' text is the group's, not the platform's, and says so |
| `[x]` T-1024 | The owner and moderators remove a message in the group's conversation or its match threads, with a reason, leaving the existing tombstone (`removed_kind = 'moderator'`). D-134 | T-245, T-244 | The author is told their message was removed and why. The removal is audited with the message as it was (rule 10). A group moderator cannot remove the owner's messages. A platform moderator's powers are unchanged |
| `[x]` T-1025 | Administrators close a group, and remove its content, with a reason (10.4). A closed group is read-only to its members, out of the directory and search, and says why; reopening takes a reason too. Reports about a group reach the queue with these actions. D-135; migration `1764990000000` | T-212, T-1024 | Every close, reopen and removal is an audited `moderation_decision` naming the actor, the reason and the previous state. Members can still leave a closed group and read their own history. The owner can appeal (T-211's appeal notes) |

## E103 — The public discussion and the contributor

*Agent-doable. T-1031's period is the maintainer's policy, built with a
stated proposal (N-7).*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1030 | A panel post links to at most one incident, player in either line-up, the author's own prediction or a statistic of the post's match, rendered as a card beside the post. D-136; migration `1765000000000` | T-251, T-254 | Blueprint 10.2. The schema refuses a link to another match. A link to an incident the feed later removed or changed says so rather than showing the old value. A prediction link shows only what the author's own visibility already shows (D-063). Rule 6: a prediction card is labelled as the member's |
| `[x]` T-1031 | A contributor below the threshold for a sustained period is flagged. A daily check over the stored rating history raises one `contributor_flag` per stretch and tells administrators once (`contributor_below_threshold`); the console's contributors page lists open flags. D-137; migration `1765010000000` | T-250, T-833 | Blueprint 9.4. Nothing is paused automatically: an administrator pauses with the existing audited act, or dismisses the flag with a reason. A member back above the threshold closes the flag. Recomputable from stored ratings (rule 8). The period is a named constant with the proposal in D-137 until N-7 is answered |

---

## Needs a decision

None of these is a task yet. Each needs a decision entry first. The note
says whose.

1. **N-1 — Machine-labelled story types (3.2).** Carried from Phase 9's N-8.
   A language model (D-070) labelling publishers' headlines would type the
   many stories whose feeds carry no category. It is machine output about
   other people's words, and whether the free feeds' terms allow it is
   D-061's question. *The maintainer's* (third-party terms). T-1001 and
   T-1002 are built either way; an answer of yes would be a third origin,
   labelled as the machine's.
2. **N-2 — Transfers, and injuries outside a match (12.2, 3.2).** The
   licensed feed has transfer and injury endpoints. Reading them spends the
   daily request budget and depends on the feed's plan and its terms for
   showing that data as alerts. A "transfer" story type from T-1002 or an
   editor gives transfer news without them, and T-1005 could alert on it.
   Which does the product use? *The maintainer's* (third-party terms, and a
   request budget that is also the live data's).
3. **N-3 — Views and shares in trending (3.1).** Counting who read or shared
   a story is product analytics that D-044 and D-102 kept out: the product
   counts only rows it keeps for its own function. Whether to count views
   and shares, and what the privacy text says, is *the maintainer's*.
4. **N-4 — A person's translation of a publisher's words.** T-304 already
   publishes a translator's version of a free feed's headline and summary
   beside the publisher's own. Whether each feed's terms allow publishing a
   translation of their headline is a licensing question D-061 did not ask.
   *The maintainer's*. T-1011 to T-1014 are built either way.
5. **N-5 — A translator role.** T-304's routes admit editors and
   administrators. Whether translators get a narrower `translator` role, and
   who holds it, is *the maintainer's*: the translators are theirs.
6. **N-6 — Group membership criteria and a group administrator role (8.2).**
   "Membership rules" is planned as a written rules text (T-1023). Criteria
   that decide entry -- a minimum rating, a country, a verified account age
   -- and an `administrator` role between owner and moderator are product
   behaviour the blueprint names without defining. *The maintainer's*.
7. **N-7 — The sustained period (9.4, T-1031).** How long below the
   threshold, and whether "below" is the contributor threshold of D-059 or a
   tier, is policy the maintainer settled for the thresholds themselves
   (D-059). The proposal is 30 consecutive days below the contributor
   threshold. *The maintainer's*.
8. **N-8 — Which publishers to add (3.2).** Blueprint 3.2 asks for full
   coverage of the popular leagues, continental competitions and national
   teams. T-1010 states the gaps. Adding a publisher is a free feed under
   D-061 with its robots and terms checked, and the choice of whose words
   the product carries is editorial. *The maintainer's*.

**Still open from earlier phases, not repeated:** Phase 8's N-1 (T-806), N-2,
N-4, N-5 and N-6; Phase 9's N-3 to N-7 (N-8 is N-1 here).

**Not in Phase 10, by earlier decision:** machine translation of anyone's
words (D-061, 13.2); group images and uploads (D-054); an abuse-language
classifier beyond moderation assistance (D-054, D-070); licensed full-text
news (D-061); video embeds (D-069); a native app (D-084).

---

## What blocks what

| Tasks | Blocked on | Who |
|---|---|---|
| T-1001, T-1004, T-1006, T-1008, T-1010, T-1011, T-1020, T-1022, T-1023, T-1030, T-1031 | nothing | agent |
| T-1002, T-1009 | T-1001 (T-1009 also T-1004) | agent |
| T-1003 | T-1001, T-1006 | agent |
| T-1005 | T-1004 | agent |
| T-1007 | T-1006 | agent |
| T-1012 → T-1013 → T-1014 | T-1011 | agent |
| T-1021 | T-1020 | agent |
| T-1024 → T-1025 | nothing | agent |
| Glossary target terms | T-1011's file | the translators, not an agent |
| T-1031's period | N-7 (built with the proposal meanwhile) | **maintainer** to confirm or change |

**Start with T-1001 and T-1006.** Every other news task reads a story's type
or its people. E101, E102 and E103 are independent of E100 and of each
other, and can run in parallel. Each task has its own decision number and,
where it needs one, its own migration timestamp.
