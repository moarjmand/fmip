# Phase 3 policy

**What this is.** The judgements `CLAUDE.md` §7 reserves for the maintainer, in
one place, so the code that reads them has something to point at. Numbers here
are configuration and appear in code as named constants; the two texts at the
bottom are what a member and a contributor accept.

**What this is not.** Legal advice, and not reviewed by a lawyer.

Settled by the maintainer on **2026-09-15**. Recorded as **D-059**.

**Both texts approved by the maintainer on 2026-09-15**, as
`platform-rules@1.0.0` and `contributor-rules@1.0.0`. They are versioned because
acceptance is recorded against a version: a registration stores which platform
rules were accepted, and a contributor grant stores which contributor rules were
(blueprint 9.4). Changing either in a way that changes what is allowed means a
new version and a new acceptance -- which is what the *Changes* clause promises,
and the version is how that promise is kept rather than asserted.

---

## 1. Who qualifies as a contributor

Blueprint 9.4 names four measurable requirements and a fifth that is a person's
decision. These are the four. **None of them grants anything** (T-250): they
decide who may be *considered*, and a grant is a separate, audited act.

| | Value | Where it lives |
|---|---|---|
| Minimum Performance Rating | **70** | `ELIGIBILITY_V1.minRating` |
| Minimum settled predictions | **50** | `ELIGIBILITY_V1.minSettled` |
| Verified e-mail | required | `eligibilityFor(..., emailVerified)` |
| Clean recent conduct | **no active sanction, and no `sanctioned` decision in the last 90 days** | T-250 |

The first two were already the values of `privilege-eligibility@1.0.0` and are
confirmed, not changed. The conduct window is new, and is the half the comment
in `eligibility.ts` says arrives with moderation.

**Why 50 settled predictions and not a rating alone.** The same floor as D-037,
for the same reason: a rating computed from three settlements is an accident, and
a threshold on the rating alone would be met most easily by predicting almost
nothing. Career Points are deliberately not an input (blueprint 9.2) and the
function cannot see them.

**Why a window and not "ever".** A sanction from two years ago that was served
and never repeated is not a reason to refuse somebody for life; an active one
is. Ninety days is long enough that the answer is about conduct rather than
timing, and short enough that it is a record rather than a brand.

## 2. Conduct, and what it earns

**This table is not applied automatically, and nothing in the code applies it.**
A report is read by a person and the outcome is theirs (D-053). The table is
what the moderation surface *shows* that person, and the durations it offers as
defaults. A moderator who departs from it records why, like any other decision.

| Reason | First | Second | Third |
|---|---|---|---|
| `spam` | warned | messaging restricted, 7 days | 30 days |
| `abuse` | messaging restricted, 7 days | 30 days | permanent |
| `impersonation` | content removed, contact and messaging restricted until resolved | permanent | — |
| `other` | the moderator's judgement, with a written reason required | | |

**`other` requires a description already** (`SubmitReportRequest.detail`), and a
decision on one requires a reason for the same purpose: "other" alone is a report
nobody can act on and a sanction nobody can review.

**A permanent sanction is allowed, and only with a written reason.** It is a row
like any other, it names its actor, and it can be appealed through
`appeal_note` — an appeal on a permanent sanction is the one that matters most,
so it is not a special case.

**Counting is per reason, not per member.** A member warned once for spam and
later reported for abuse meets the `abuse` row at its first step. The two
behaviours are different and a ladder that merged them would escalate for the
wrong reason.

## 3. A grant, and how it ends

An approval is a row with a lifecycle (blueprint 9.4), never a flag:

- it names its **approver**, its **reason**, and the contributor's **acceptance
  of the contributor rules** with the version accepted
- it can be **paused** — temporary, reversible, the member is told
- it can be **withdrawn** — and the withdrawal is its own row, so "who approved
  this, and when did it stop" has an answer

**An approval does not expire.** A yearly re-review would be a deadline nobody
keeps, and its lapse would read as a judgement when it was only a calendar.
Pausing exists for the case a review would have caught, and it is honest about
being a decision somebody made.

---

## 4. The platform rules — `platform-rules@1.0.0`

> **Approved 2026-09-15.** The words a member accepts at registration
> (blueprint 1.6).

**Joining.** You need an e-mail address you can receive mail at, a username
nobody else has, and to be old enough to hold an account where you live. One
account per person.

**What this place is for.** Football: matches, predictions, analysis and
argument about all three. Predictions here are a record of what you thought and
when. They are not betting advice, nothing here is a wager, and no money changes
hands.

**What is not allowed.**

- **Spam.** Repeated unwanted messages, advertising, or link-dropping.
- **Abuse.** Harassment, threats, slurs, or targeting somebody for who they are.
- **Impersonation.** Presenting yourself as another person, a club, a
  journalist, or this platform.

**Your rating is earned and is shown.** A Performance Rating is computed from
your settled predictions and can be recomputed from them. It is not a score you
can be given, and it is not one that can be taken from you as a punishment.

**Reports and decisions.** Anybody can report a member. A person reads every
report and records what they decided, including deciding that nothing was wrong.
A decision can restrict what you can do, for a stated time or permanently, and
you are told which and why.

**Appeals.** Every decision can be appealed once, in writing, and the appeal is
kept with the decision.

**Leaving.** You can delete your account. Your predictions and their settlements
are what other people's ratings were computed against, so they remain as records
without your name on them.

**Changes.** If these rules change in a way that affects what is allowed, you are
told before the change applies, and asked to accept the new version.

## 5. The contributor rules — `contributor-rules@1.0.0`

> **Approved 2026-09-15.** What an approved contributor accepts before their
> first post on a public panel (blueprint 9.4, 10.2, 10.3).

**What approval is.** Permission to post where most members can only read.
It was given by a person, for a reason that is recorded, and it is not a reward
for a number.

**Say what you think, and say it as yourself.** Your rating and your approved
status are shown beside everything you post, because on a public panel they are
the only thing separating your opinion from anybody else's.

**No undisclosed interest.** If you are paid, sponsored, or connected to a club,
an agent or a betting operator in a way that bears on what you are writing, say
so in the post. Nothing here is for sale, including your byline.

**Corrections are part of the job.** A published analysis is immutable; a
correction is a new version that says what changed. Getting something wrong and
correcting it costs you nothing here. Quietly editing it does.

**Approval can be paused or withdrawn**, by the person who gave it or by another
moderator, with a reason you are told. It is not a contract and it is not
permanent — and neither is its absence.

---

## What is still the maintainer's

The **approvals themselves**. The gate computes who qualifies; a person decides
who gets through it, and that decision has a name on it (blueprint 9.4). That
does not begin until there are members with fifty settled predictions, which is
after a real deployment.

---

## 6. Where news comes from

**Free sources only, for now** (D-061, 2026-09-15). What that permits is
narrower than "news", and the narrowness is the decision rather than a
limitation of it:

| | |
|---|---|
| Taken | headline, the publisher's own summary as the feed carries it, byline, publication time, and a link to the original |
| Not taken | the article body, paywalled content, and images re-hosted here |
| Shown | the publisher's name, on every item, as a link to their page |
| Withdrawn | on a publisher's request, without argument |

**The capability for a licensed source is built in from the start**, at the
maintainer's instruction. Every source carries its own rights, and a surface
renders what the rights allow rather than what the schema happens to hold. A
licensed wire feed later is a new adapter and a new rights row -- not a rewrite,
and not a second article table.

---

## 7. What a group sees of a member's predictions

**The member's own control decides, and nothing else** (T-246). A prediction
comparison inside a group shows what `prediction_history_visibility` already
allows -- the same setting that governs a profile's history (T-056). A member
who set `private` is not shown, one who set `friends` is shown only to friends,
and either way they are **counted** so the comparison never reports a smaller
group than the one that exists.

**This means a group can see a call before kick-off**, because the product
already allows that on a profile. It is stated here rather than buried because
it is the one place the maintainer might reasonably want a different rule: a
side-by-side comparison inside a small group makes copying easier than browsing
one profile at a time does.

**If that should change**, the rule would be "a call is shown to the group only
once the fixture is locked, except to its own author". It is one condition in
one place. Say so and it changes; until then the member's setting is the whole
answer, because a second rule would override a choice they have already made.
