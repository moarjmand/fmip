# Phase 7 — A face, a console, and the rest of the blueprint

Phases 1 to 6 built the product the blueprint describes and put it on a live
server with fifteen competitions. A comparison of `product-blueprint.md`
against what is built (2026-09-27) found three kinds of gap: **the product has
no visual identity** (no brand mark, palette, typography or Persian-capable
font; the system colours of the browser), **an operator runs half the
administration through the API or scripts** (the moderation queue, contributor
grants, featured matches and the debate have endpoints and no page), and
**several blueprint promises are partly kept** (knockout brackets, player
comparison, rating history, leaderboards by period, search beyond football
entities, onboarding). Phase 7 is those, chosen by the maintainer on
2026-09-27.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic.

---

## Read this before planning work from it

**E61 comes first because it needs nothing from anybody.** Every page in it
calls an endpoint that exists, is role-checked by the API and writes its audit
row there (rule 10). The web adds no gate of its own: a page that decided who
may act would be a second copy of a rule that already has a home.

**E60 waits on the maintainer's answers** (`CLAUDE.md` §7: product behaviour
and brand are theirs): the name shown, a mark or a choice between drafts, the
tone, the primary colour and the default theme. The font (a self-hosted
Persian- and Arabic-capable face) and the token scheme are an agent's, recorded
as a decision entry when made.

**Nothing here buys, opens an account, or holds a secret.**

---

## Exit criteria

- Every administrative write the API offers has a page, and none needs `curl`
  or a script: moderation, contributors, featured matches, the debate.
- The product has a recorded identity (decision entry), one set of tokens used
  by every page, a theme a member can choose, and a font that renders Persian
  and Arabic; axe stays at zero violations and the RTL test passes.
- A new member is asked for language, territory, time zone and favourites once.
- Knockout stages have a bracket; two players can be compared.

---

## E61 — The operator's console on the web

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-610 | The moderation queue page: open reports grouped by member, the reporters, the assistant's suggestion when there is one, and a decision form (outcome, reason, sanction scope and days or permanent) | T-212, T-441 | A moderator decides without `curl`; the page states "nothing waiting", "cannot be shown" and "needs the role" as three different sentences |
| `[x]` T-611 | One member's moderation history, with lifting a sanction by reason | T-610 | Reports, decisions and sanctions on one page; a lift carries a reason and the page shows the API's sentence |
| `[ ]` T-612 | Contributors: the list, a grant, pause, resume and withdraw, each by reason | T-250 | The same four actions as the API, each reason required |
| `[ ]` T-613 | Featured matches and the debate: open and close a panel, select and clear a story | T-253, T-143 | Both run from the admin area with a reason |

## E60 — A visual identity and a design system (waits on the maintainer)

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-600 | The identity decided: name shown, mark, tone, primary colour, default theme | maintainer | A decision entry names each |
| `[ ]` T-601 | A self-hosted Persian- and Arabic-capable font and the type scale | T-600 | `/ar` and `/en` render with it; no request leaves the site for a font |
| `[ ]` T-602 | Tokens on `:root` for light and dark, and a theme a member can choose | T-600 | Every colour in the web app comes from a token; axe at zero |
| `[ ]` T-603 | A small set of shared components replacing repeated Tailwind strings | T-602 | Buttons, fields, cards and notices from one place |
| `[ ]` T-604 | The mark in the icons, the share cards and the manifest | T-600 | `make-icons.mjs` draws from the mark |
| `[ ]` T-605 | Scores and the match centre, mobile first | T-603 | Usable at 360 px on a Saturday with every league playing |

## E62 — Onboarding and a member's own controls

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-620 | First run: language, territory, time zone and favourite teams, once | — | Blueprint 2.3 and 7.1; a guest's choice survives until sign-up |
| `[ ]` T-621 | Text size and contrast in Settings | T-602 | Blueprint 2.2 |
| `[ ]` T-622 | Following with nothing followed says what to do next | — | Never an empty page that looks broken |

## E63 — Football pages, deeper

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-630 | Knockout brackets for the three UEFA cups | — | Blueprint 5.1; a tie not yet drawn is stated, never invented |
| `[ ]` T-631 | Two players compared | — | Blueprint 5.3; a figure one of them lacks is a coverage state |
| `[ ]` T-632 | A team's figures home and away and by competition | — | Blueprint 5.2 |
| `[ ]` T-633 | The scores page: a date picker and filters by country and stage | T-504 | Blueprint 4.1 |

## E64 — Reputation and discovery, completed

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-640 | A member's rating over time, by competition, and their highest | — | Blueprint 9.3; recomputable from stored settlements (rule 8) |
| `[ ]` T-641 | Leaderboards among friends, by month and by season | T-640 | Blueprint 9.3 |
| `[ ]` T-642 | Search over articles, groups and members who allow it | — | Blueprint 2.2; a private profile is never a result |
| `[ ]` T-643 | Achievements and group polls | maintainer | Their list and the poll rules are product behaviour to confirm first |
