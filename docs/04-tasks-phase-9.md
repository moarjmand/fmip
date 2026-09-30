# Phase 9 — Carry the load, repair the record, and finish the pages people see first

Phases 1 to 8 built the product the blueprint describes, put it on a live
server with fifteen competitions, gave it a face and a console, and taught it
to notice when it is broken. What a week of running it found is narrower and
more concrete than any earlier gap, and Phase 9 is that. A comparison of
`product-blueprint.md` (every section, 1 to 19), the published rules
(`13-policy.md`) and Phase 8's own measurements against what is built
(2026-09-28) found four kinds of gap:

- **Load the product already carries, measured and not yet met.** A kick-off
  of 90 matches to 10,000 following members takes about 70 s at p95
  (`08-load-test.md`, T-836: the target was set at 2,000). A campaign to
  10,000 still emits one member at a time -- about six round trips each --
  while match alerts are written by one set-based statement (T-835).
- **A record that contradicts itself.** The data-quality sweep (T-820, D-097)
  holds 2,447 open findings from past seasons: `lineup_not_eleven` 2,033 and
  `goals_disagree` 414. Nothing reviews them in bulk, and nothing re-asks the
  feed. Club Elo's API has answered `502` since 2026-09-25, so every forecast
  is fitted without its prior (`elo_used` false everywhere), and the line-up
  term (D-086) is built but not yet fitted.
- **Contracts that say different things for the same refusal.** A 403 carries
  `error: 'unauthenticated'` in six admin modules and `error: 'validation'` in
  about fifteen others. `ApiError` (`packages/contracts/src/identity.ts`) has no
  code for "signed in, but not allowed". The "Deleted member" label (D-094) is
  in the catalogue but renders only in conversations and match panels. Other
  surfaces show the tombstone's stored English `display_name`, and no RTL test
  covers a deleted member.
- **Blueprint pages still partly kept.** The scores card has no model
  forecast summary, community totals or viewing indicator. The contract says
  so (`scores.ts`), and all three now exist elsewhere (4.1). The story page
  has no share, follow or match-prediction links (3.3). The homepage has no
  friends' activity, group discussion, contributors' posts or viewing (2.3).
  Leaders are goals only (5.1). The team page has no manager and no news, and
  neither does the competition page (5.1, 5.2). A match cannot be followed
  (12.1), and an achievement unlock is not a notification (12.2).

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**Numbers are assigned here, so parallel agents do not collide.** Every
decision entry a task needs has its number below (D-106 to D-122). So does
every migration a task needs (timestamps from `1764840000000`, in steps of
`10000000`). An agent takes the number its row names and no other. A task
that finds it needs no decision or no migration leaves its number unused and
says so in its PR. It never passes the number to another task. A task that
finds it needs one it was not given stops and asks, and does not take the
next free number.

| Decision | Task | Subject |
|---|---|---|
| D-106 | T-901, T-902 | Carrying a burst: claims and outcomes set-based, and the send pool sized for the server |
| D-107 | T-903 | Campaign emission is one statement per audience page, like match alerts |
| D-108 | T-904 | A `forbidden` error code: 401 is "who are you", 403 is "not you" |
| D-109 | T-910, T-914 | What the past-season findings are, and what each class makes a season's coverage |
| D-110 | T-913 | Re-asking the feed for one fixture: who may, from which budget, and how it resolves a finding |
| D-111 | T-920, T-921, T-922 | An Elo prior from our own records, within D-014, when Club Elo does not answer |
| D-112 | T-930 | The origin answers only Cloudflare's addresses |
| D-113 | T-931 | The platform-rules version is recorded at registration, and a new version is accepted before it applies |
| D-114 | T-940 | What the scores card summarises: which forecast version, and the consensus floor |
| D-115 | T-942 | The member's homepage: whose activity, under which visibility |
| D-116 | T-945 | Following a match, and what it sends by default |
| D-117 | T-946 | An achievement unlock is told once, and only for achievements that cannot be lost |
| D-118 | T-943 | Leaders beyond goals: assists, clean sheets and cards, each a stated rule |
| D-119 | T-944 | The manager is the coach on the team's latest line-up; news on entity pages is the news boundary's linking |
| D-120 | T-535 | Promotion of the candidate (or not), with the numbers |
| D-121 | T-923 | The line-up term's fit, and whether the candidate carries it |
| D-122 | T-924 | The Power Index's line-up and stability weights, revalidated on our own line-ups |
| D-161 | — | The feed's values are not overridden by hand (N-3) |
| D-162 | T-947 | Club Elo retired from every new version (N-4) |
| D-163 | — | High-rating privileges as built; leaderboards by rating alone (N-6) |
| D-164 | T-1160 | Thresholds as versioned rows; the formula only by a new version (N-7) |
| D-165 | — | Story types never labelled by a machine (N-8) |

| Migration | Task | For |
|---|---|---|
| `1764840000000` | T-913 | `fixture_refetch_request`: a queued re-ask of one fixture's details, its reason and outcome |
| `1764850000000` | T-921 | `training.own_elo`: our daily Elo per club, with the matches it was computed from |
| `1764860000000` | T-931 | `platform_rules_acceptance`: the version each member accepted, and when |
| `1764870000000` | T-945 | `followed_entity` takes `fixture`, and the match-alert audience reads it |
| `1764880000000` | T-946 | `achievement_unlocked`: a notification kind and the first moment each achievement was derived |
| `1764890000000` | T-901 | An index for the page claim, **only if** the measurement shows the claim scans |

**The load targets stay the ones already written down.** A goal reaches a
device within 60 s at p95 (T-835), and a live tick is never skipped. T-901
and T-902 extend that target to a kick-off of 90 matches at 10,000 following
members. They do not relax it at 2,000.

**The model changes only through its own record (D-082).** A new prior or a
fitted term is a new candidate version in shadow. It is promoted only by the
evaluation T-535 runs, and every stored forecast keeps the version that made
it (rule 5). Nothing here edits `dixon-coles-elo@0.1.0`.

**Match days.** Club football resumes on **2026-10-08** after the
international break. Tasks marked **(match days)** can only be measured or
walked on real fixtures from then on. Everything else can be built now.

**Waiting for data is not waiting for match days.** T-923 and T-924 need the
2025/26 line-ups the past-season detail backlog is still loading (T-536: about
4,000 of 8,316 fixtures fetched on 2026-09-28). They can run as soon as it
finishes, international break or not.

**Nothing here buys, opens an account, or holds a secret.** Two tasks need
the maintainer's **yes** before they are applied, because each is a question
`CLAUDE.md` §7 reserves: T-930 changes who can reach the server, and T-931 is
a schema change with a backfill. Everything else is agent-buildable. It is
covered by the standing delegation of 2026-09-26, with a revisable decision
entry where a task names one.

**Phase 6's measurements stay in Phase 6.** T-501 (the request budget on a
real match day), T-504 (fifteen competitions on a phone on a real Saturday)
and T-535 (promotion on the candidate's own record) are ticked in
`04-tasks-phase-6.md`. They are listed under E92 because Phase 9's model work
depends on them, but they are not repeated with new ids. T-806 (an
off-machine uptime check) stays the maintainer's, in `04-tasks-phase-8.md`.

---

## Exit criteria

- A kick-off of 90 matches reaches 10,000 following members' devices within
  60 s at p95, and a campaign to 10,000 emits in seconds, in the T-834 and
  campaign-scale scripts.
- Every 403 from the API carries one error code, and a CI test proves it.
- No surface shows a deleted member by a stored English name. The RTL test
  covers a deleted member.
- Every past-season finding is classified, reviewed with a reason or repaired
  from the feed. Each season's declared coverage says what the findings mean.
- A forecast made while Club Elo is down says so. A candidate with an Elo
  prior from our own records is in shadow, with its backtest written down.
- The scores card, the story page, the homepage, the leaders and the team page
  carry what blueprint 2.3, 3.3, 4.1, 5.1 and 5.2 list, or say which part is
  not supplied.
- A member can follow a match, and is told once when they earn an
  achievement.

---

## E90 — Delivery at scale, and contracts that agree

*Agent-doable.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-900 | This plan | — | `04-tasks-phase-9.md`, the roadmap's Phase 9 section and the outline after it merged |
| `[x]` T-901 | The carry claims and records set-based. `NotificationsService.carry()` claims a page of due notifications in one statement and records each page's outcomes in one statement. Today it takes about three round trips per notification. D-106; migration `1764890000000` only if the claim needs an index | T-836, T-837 | T-834's kick-off run of 90 matches at 10,000 members, with a 50 ms push, is within 60 s at p95 on the laptop, and no live tick is skipped. A notification is still never sent twice: a test races two carriers over one page |
| `[x]` T-902 | The send pool sized for the server. Measure `NOTIFICATION_SEND_CONCURRENCY` at 16, 32 and 64 against the API's database pool of 10, on the laptop and on the production server's 2 vCPUs, and record the production value in D-106 | T-901 | A table beside `08-load-test.md`'s T-836 section, with the chosen value in `.env.example`'s comment. A value that starves the pool (requests waiting on a connection) is rejected on the numbers, not by guessing |
| `[x]` T-903 | Campaign emission set-based. `CampaignsService.send` writes each audience page's notifications and its outcome rows in one statement each, as T-835's `emitToAudience` does. D-107 | T-837 | With `FMIP_CAMPAIGN_SCALE_MEMBERS=10000`, emission takes seconds rather than two to six minutes, and every member is reached exactly once (D-075's "claimed once"). The campaign-scale spec's assertions are unchanged, and `08-load-test.md`'s "What is left" paragraph is replaced by the new run |
| `[x]` T-904 | A `forbidden` code in `ApiError`, and one shared refusal body per role in `packages/contracts` (administrator, editor, moderator, operator). D-108 | — | `console-security.http.spec.ts` asserts that a member and every other non-entitled role get `403` with `error: 'forbidden'` on every `/admin` route. Admin routes are asserted from this task on; the whole router from T-907. 401 stays `unauthenticated`, and `email_unverified` stays its own code |
| `[x]` T-905 | The admin-only controllers use it: activity, admin, campaigns, data-quality, failure-counts, ingestion-admin, rate-limits and watchdog | T-904 | Each module's local `NOT_ADMIN` or `NOT_AN_ADMIN` is gone. The web console's pages read `forbidden` where they read the old codes. No other behaviour changes |
| `[x]` T-906 | The editor, moderator and operator controllers use it: analysis reviews, debate-admin, translations-admin, summaries, viewing-admin, panel-admin, moderation-admin, moderation-assist and contributor | T-904 | As T-905, for `NOT_AN_EDITOR`, `NOT_A_MODERATOR`, `NOT_A_REVIEWER` and `NOT_AN_OPERATOR` |
| `[x]` T-907 | The member-facing 403s use it: forecast, founder, groups, news, panel, predictions, social and conversations. The web reads the code, not the old body | T-905, T-906 | The T-904 assertion now runs over the whole router. A 403 with any other code fails CI. The web shows "you may not do this" rather than a validation message |
| `[x]` T-908 | "A deleted member" wherever a member is named. List every contract field that carries a member's name: group members, friends, search results, leaderboards, group polls and comparisons, community analysis authors, notifications, and `/u/<tombstone>`. Render each one through `isDeletedMember` and `account.deletedMember`, never the stored `display_name` | T-812 | A test enumerates those fields and fails on a new one without the rule. The RTL pseudo-locale test renders a conversation and a match panel with a deleted member. The key is present in every catalogue with its status as a person set it (D-066). No machine text is written into a catalogue |

## E91 — The past seasons, checked and repaired

*Agent-doable. Nothing is corrected automatically (D-097). A repair is the
feed asked again, or a person's reviewed judgement.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-910 | Diagnose the 2,447 findings. Group them by check, competition and season, then sample each group against the stored rows and the provider's answer. Name the cause of each class: the feed supplied fewer or more than eleven starters, our parser, incidents missing for a match with a score, or a check rule that misreads own goals, shoot-outs or abandoned matches. D-109 | T-820 | A table in `05-data-providers.md` gives each class's count, cause and example fixture. Read-only on the server: no finding is marked and no request is spent beyond the sample, which is counted against the day's budget (T-501) |
| `[x]` T-911 | Fix the checks T-910 finds wrong, if any. A class caused by our own rule or parser is fixed where it lives (`data-quality/internal/checks.ts` or the adapter), and the findings it raised resolve on the next sweep | T-910 | A unit test per corrected rule against the recorded fixture T-910 named. If T-910 finds no defect of ours, this task is closed with that sentence |
| `[x]` T-912 | Bulk review in the console. Mark every open finding of one check in one competition's season as reviewed with one reason, from the data-quality page | T-821 | One `audit_log` row per batch, naming the check, the season, the count and the reason, with the finding ids as the previous value (rule 10). A finding that reopens later is open again, not hidden by the batch |
| `[x]` T-913 | Re-ask the feed. An administrator queues a re-fetch of one fixture's details, or of every fixture behind a class of findings in a season. The detail job carries the queue inside a stated share of the daily budget. D-110; migration `1764840000000` | T-910, T-501 | The request and its reason are audited. A re-fetch that makes the data agree resolves the finding on the next sweep. One that does not leaves it open with "asked again on <date>, unchanged". The day's budget is never exceeded (the watchdog's budget condition stays green in a test) |
| `[x]` T-914 | Coverage says what the findings mean. Where T-910 finds the feed incomplete for a past season's line-ups or incidents, the data-quality page proposes the season's `lineups` or `incidents` coverage as `limited`. An administrator applies it with the existing audited coverage write (T-070). D-109 | T-910 | Rule 3: a season whose line-ups are mostly incomplete never shows as `available`. The proposal names the counts it rests on. Nothing is applied without a person |

## E92 — The model's inputs, and what match days measure

*Agent-doable. T-501, T-504, T-535, T-925 and T-926 wait for match days (from
2026-10-08). T-923 and T-924 wait for the past-season backlog.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-920 | The Elo source's state visible. The model service reports Club Elo's last successful day and its last error. The watchdog raises `degraded` after 3 days without an Elo answer. The forecast panel's factor list says "no Elo prior this time", as the stored `elo_used` already records. D-111 | T-801 | An alert once per incident, never per tick (D-095). The System page shows the source's state. A test with the loader failing drives both |
| `[x]` T-921 | An Elo computed from our own records. A daily Elo per club from the results in the training store, both football-data's divisions (D-016, training only) and our own records (D-083), is stored with the matches it was computed from. D-111; migration `1764850000000` | T-920 | Licensed and training data only, within D-014. Recomputable from stored results (a test recomputes a day). Clubs map by the committed bridge (D-080), never by name. Clubs with no history are left out, not given 1500 |
| `[x]` T-922 | Candidate `dixon-coles-elo@0.5.0` in shadow: 0.4.0 with the own-records Elo as its prior. It uses Club Elo when it answers and ours when it does not, or ours always, whichever the backtest favours. D-111 | T-921, D-082 | A backtest of 0.4.0 without a prior, with Club Elo's last cached ratings, and with ours, over the same fit dates, recorded in `12-power-index.md`'s neighbour or the handoff. The candidate stays in shadow. Stored forecasts keep their versions (rule 5) |
| `[x]` T-947 | Club Elo retired (D-162): a candidate file declaring `elo_prior: clubelo` or `clubelo_then_own` is refused by a test; from the promotion that replaces `dixon-coles-elo@0.1.0`, `MODEL_CLUBELO_REFRESH` defaults to `off` and the watchdog's `elo_source` condition and the System page's line are removed | T-922, D-082 | Rule 5: stored forecasts and 0.1.0's constants are untouched, and Club Elo's past snapshots stay as the record of what 0.1.0 read. `03-project-map.md` and `.env.example` follow |
| `[x]` T-923 | Fit the line-up term (D-086) on the 2025/26 line-ups once the past-season backlog has loaded them. **Waits for data.** D-121 | T-536, T-534 | `python -m fmip_model.backtest.lineups` on the full season, with the fit and held-out score recorded. The candidate carries `lineup_beta` only if the held-out gain is real. Otherwise D-121 says why not, with the numbers |
| `[x]` T-924 | The Power Index's line-up quality (20%) and stability (5%) weights, validated on our own recorded line-ups. `12-power-index.md` currently says they "cannot be validated". **Waits for data.** D-122 | T-923, T-113 | `power-index-backtest.mjs` extended to read our line-ups. The bar is unchanged (beat the blueprint by more than 0.01 held-out log-loss). A change is a new `power-index@x.y.z`, never an edit |
| `[ ]` T-925 | Match alerts measured on a real Saturday. **(match days)** Record the delivery time from incident to push outcome for kick-off, goal and full-time, from the run's own rows, beside T-834's synthetic figures | T-835, T-901 | A table in `08-load-test.md` with the day's fixtures, followers and p50/p95. A miss is written down with its cause, not re-run until it passes |
| `[ ]` T-926 | D-071's real-fixture clause walked. **(match days)** Walk the launch acceptance list (blueprint 19, football and prediction experience) on a Saturday's real fixtures: live without refresh, the match centre before, during and after, and a prediction locked and settled | T-501 | Each line is ticked or given a task, recorded in `06-session-handoff.md`. D-071's condition is recorded as met or not |
| — | *Carried:* T-501, T-504 and T-535, in `04-tasks-phase-6.md`. **(match days)** T-535's entry is D-120 | — | Ticked where they are |

## E93 — The server's edge and the member's agreement

*Each is built by an agent and applied only after the maintainer says yes (see
"Needs a decision", N-1 and N-2).*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-930 | **Needs the maintainer's yes (N-1).** The origin answers only Cloudflare. Caddy refuses a connection whose address is outside Cloudflare's published ranges (a `remote_ip` matcher from a committed list, with no new Caddy module). A weekly check on the server compares the list with Cloudflare's published one and raises a watchdog alert when they differ. SSH is untouched. D-112 | D-093, T-801 | Closes the gap D-093 names: a forged `CF-Connecting-IP` from outside Cloudflare cannot reach the per-address counters. Rehearsed on the laptop first (`09-deploy.md`), with the rollback written down. `verify-rollout.sh` passes through Cloudflare after it is applied |
| `[x]` T-931 | **Needs the maintainer's yes (N-2).** The platform-rules version is recorded at registration, as `13-policy.md` says it is. A member is asked to accept a new version before it applies to them. D-113; migration `1764860000000` | T-040 | Registration stores `platform-rules@1.0.0` beside `accepted_rules_at`. Every existing account is backfilled to 1.0.0, the only version that has existed. A test publishes a 1.1.0 and shows that a signed-in member is asked once and can read before accepting, and that nothing they wrote is hidden meanwhile |

## E94 — The pages people see first, completed

*Agent-doable.*

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-940 | The scores card carries the model's forecast summary (the latest pre-kick-off version, labelled as the model's), the community totals (only at D-052's five predictors) and the viewing indicator for the viewer's territory. D-114 | T-064, T-134, T-314 | Blueprint 4.1. The three prediction products stay separate (rule 6, `three-products.spec.ts` extended). A missing summary is absent with a stated reason, never an empty bar. The scores page stays within its T-808 budget |
| `[x]` T-941 | The story page: a share control, follow controls for the teams and competition it links, and for a match story the model's forecast, the founder's analysis and the community consensus, each linked with its own label | T-144, T-521 | Blueprint 3.3. Rule 6: three labelled links, never one figure. The page's stale comment ("save and share are not built") is corrected |
| `[x]` T-942 | The member's homepage: friends' recent predictions (only those the friend's visibility lets the viewer see, D-063), active discussions in their groups, contributors' posts on today's public panels, and viewing for the featured matches. D-115 | T-201, T-245, T-253, T-314 | Blueprint 2.3. A guest sees none of the member sections and is not told they are empty. A section with nothing in it says so once. Private and friends-only history is never shown past its setting (a test per setting) |
| `[x]` T-943 | Leaders beyond goals: assists, clean sheets (the goalkeeper who started and finished a match without conceding) and cards, each from stored incidents and line-ups, under the minimum-minutes filter. D-118 | T-824 | Blueprint 5.1. Each board is its own `Covered` module. A season whose incidents do not carry assists is `not_supplied` for assists, never a board of zeros |
| `[x]` T-944 | The team page's manager (the coach named on the team's most recent line-up) and related news, and the competition page's news, from the news boundary's existing links. D-119 | T-036, T-145 | Blueprint 5.1 and 5.2. A team with no recorded coach says so. News is `not_supplied` until the feeds have been read, as on the match page. No new provider request |
| `[x]` T-945 | Follow a match. A follow control in the match centre, and `followed_entity` of type `fixture`. Its followers join the match-alert audience under the same controls and quiet hours. D-116; migration `1764870000000` | T-830, T-831 | Blueprint 12.1. One alert per event per member even when they follow the match, both teams and the competition (a test). The follow ends by itself after full-time plus a stated window |
| `[x]` T-946 | An achievement unlock is a notification. The first time a derived achievement (D-091) appears for a member, they are told once, deep-linked to their profile. Opt-out in the existing controls. D-117; migration `1764880000000` | T-643, T-331 | Blueprint 12.2. An achievement that a recomputation removes and restores is not told twice. A deleted member is never told. Achievements stay derived and change nothing (D-091) |

---

## Needs a decision

None of these is a task yet, except where a task above names it as its gate.
Each needs a decision entry first. The note says whose.

1. **N-1 — Only Cloudflare reaches the origin (T-930).** *The maintainer's
   yes.* It closes the forged-address gap D-093 names. It also means the site
   cannot be served by pointing DNS straight at the server during a
   Cloudflare outage, unless the change is rolled back first. A Hetzner cloud
   firewall would do the same one layer lower, but that needs the
   maintainer's account. The proposal is Caddy's own matcher, because it
   needs no account and rolls back with one commit.
2. **N-2 — Backfilling the rules version (T-931).** *The maintainer's yes*
   (`CLAUDE.md` §7: a schema change with a backfill). The proposal is that
   every existing account records `platform-rules@1.0.0`, because no other
   version has ever been published.
3. **N-3 — A person correcting the feed.** **Answered 2026-09-30 under the standing delegation: D-161** -- no hand override of a stored score, incident or line-up; review and re-asking the feed are the correction tools. Blueprint 16 asks for "correction
   and manual review tools". Review is built (T-821, T-912), and re-asking
   the feed is T-913. Overriding a stored score, incident or line-up by hand
   is not. Three questions come with it: whether the feed's next answer wins,
   how the page says "corrected by the desk", and whether the licensed
   feed's terms allow showing a changed value beside its data. *The
   maintainer's* (licensing and product behaviour).
4. **N-4 — Club Elo after T-921.** **Answered 2026-09-30 under the standing delegation: D-162** -- retired: no new version reads it, and asking stops once the published version no longer does (T-947). Club Elo is free, not licensed, and has not
   answered since 2026-09-25. Once our own Elo exists, the proposal is to
   retire Club Elo as an input, so that the model's critical path is licensed
   and training data only (D-014). *The maintainer's* (third-party terms).
   T-922 is built either way.
5. **N-5 — Persian as a language.** The product is served from an Iranian
   domain and covers Iran's league, and the identity already renders Persian
   (D-089). Blueprint 13's eight languages do not include it. Adding a locale
   is scope and needs a fluent reviewer (D-066). *The maintainer's.*
6. **N-6 — The privileges blueprint 9.4 lists beyond contributor access and
   exclusive groups.** **Answered 2026-09-30 under the standing delegation: D-163** -- contributor access, exclusive groups and the badge only; leaderboards stay ordered by rating alone; nothing else is built without its own decision. Private prediction events, greater visibility in
   leaderboards and discovery, early access, and further perks are product
   behaviour with no rule written anywhere. *The maintainer's.*
7. **N-7 — Rating formula and thresholds set from the console (9.1, 16).**
   **Answered 2026-09-30 under the standing delegation: D-164** -- yes, as proposed; T-1160 is no longer gated.
   Today they are versioned constants (D-035, D-059). The proposal is that
   thresholds become versioned rows an administrator changes with a reason,
   and the formula changes only by a new version, so that rule 8 holds. The
   thresholds are policy the maintainer settled (D-059). *The maintainer's.*
8. **N-8 — Story types and breaking news (3.2, 12.2).** **Answered 2026-09-30 under the standing delegation: D-165** -- no machine labelling; D-123 and D-125 stand. An editor marking a
   story "breaking", with an opt-in alert, is covered by the standing
   delegation. Labelling publishers' headlines by machine (D-070) touches
   the feeds' terms (D-061). *The maintainer's.* This is planned for Phase 10,
   not here.

**Still open from Phase 8, not repeated:** N-1 (T-806, an off-machine uptime
check), N-2 (point-in-time recovery), N-4 (a copy of my data), N-5
(predicted line-ups) and N-6 (women's and youth football), all in
`04-tasks-phase-8.md`.

**Not in Phase 9, by earlier decision:** a native app (D-084); uploads,
avatars and group images as files, an abuse-language classifier, and SMS
(D-054, Phase 4); machine translation of anyone's words (D-061, 13.2); a
second CMS (Phase 4); licensed full-text news (D-061); video embeds (D-069); a
tracing or error-tracking vendor, and product analytics beyond our own counts
(D-044, D-102); OpenAPI and Storybook (blueprint 14.1 is not authoritative on
engineering; shared types are the contract, D-006).

---

## What blocks what

| Tasks | Blocked on | Who |
|---|---|---|
| T-901..T-908, T-910..T-914, T-920..T-922, T-940..T-946 | nothing | agent |
| T-913 | T-910's diagnosis | agent |
| T-923, T-924 | the past-season detail backlog finishing (T-536) | agent, when the data is in |
| T-925, T-926, T-501, T-504, T-535 | club matches, from 2026-10-08 | agent, on match days |
| T-930 | N-1 | built by an agent, applied on the **maintainer's** yes |
| T-931 | N-2 | built by an agent, applied on the **maintainer's** yes |
| T-806 (Phase 8) | an account | **maintainer** |

**Start with E90 and E91.** T-901 and T-903 are the load the product carries
the first Saturday it has 10,000 members. T-910 decides how much of E91 is a
repair and how much is a label. E94's tasks are independent of each other and
can run in parallel. Each has its own decision number and, where it needs
one, its own migration timestamp.
