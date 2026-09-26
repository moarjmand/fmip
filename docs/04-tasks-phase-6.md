# Phase 6 — Breadth, first members, a better model

Phases 1 to 5 built the product: a match record, the football intelligence
around it, members who predict and reach each other, a product that travels,
and a language model on a short leash. Since 2026-09-25 it has been live on a
real server with a paid feed. What it does not have yet is **enough football,
anybody using it, and a model that has had to compete for its place**. Phase 6
is those three, chosen by the maintainer on 2026-09-26 as four bands: more
leagues, Iran's league, the first members, and a second model version.

Read `01-roadmap.md` for why the phases are shaped this way and
`00-decisions.md` before proposing anything that changes a locked decision.
The sequencing rule applies inside every epic: **schema and contracts, then
data, then the backend module with tests, then the published contract, then
the frontend, then observability.**

---

## Read this before planning work from it

**Most of this phase is operations on a live server, not code.** A new league
is a catalogue operation (`catalog.mjs`, D-077), a backfill, an adoption and a
line in the training alias list (D-080), all of which exist. The code in
E50 is what a larger catalogue shows up: the request budget and the scores page
at fifteen competitions.

**Three gates, all the maintainer's (`CLAUDE.md` §7).** Whether the model may
learn Iran's league, and from what licensed history (T-511). A Telegram channel
the product posts to, which needs a bot and a channel only they can create
(T-524). And the feed itself: the provider's plan on the server runs to
**2026-10-21**; everything in E50 and E51 assumes it continues.

**The first members need e-mail.** A new account cannot predict until its
address is verified (T-040), and verification needs the delivery provider
(T-330), which is the maintainer's to switch on. E52 is buildable without it;
its exit criterion is not observable until it is on.

**A second model earns its place in the open.** Nothing in E53 replaces the
published model on a belief. A candidate runs in shadow beside it on every
match, its forecasts stored like any other (rule 5) and shown nowhere, and it
is promoted by a decision entry only when the evaluation records (T-066) say it
is better on forecasts made before kick-off (D-031).

---

## What Phase 6 is, in one paragraph

Four bands. **More leagues** (E50): six domestic leagues the training data
already covers and the two other European cups, on the same paid feed, inside
a measured request budget. **Iran** (E51): the Persian Gulf Pro League with
everything the feed supplies, and a forecast only once a licensed history for
it is chosen. **First members** (E52): a match, a table or a settled
prediction that looks like something when pasted into a chat, a link a member
can invite a friend with, and a page that tells a first visitor what this is.
**A second model** (E53): the baseline restated at scale, a shadow version
that adds what the first could not see -- tuned constants, European cup
matches on one scale, line-ups and absences -- and a promotion only on
evidence.

---

## Exit criteria

Checked on the public deployment:

- Fifteen competitions are ingested, each module under an honest coverage
  state, and every match of a covered domestic league has a model forecast in
  its seven-day window.
- The Persian Gulf Pro League has scores, a table and match pages; its forecast
  follows T-511's answer, and until then the panel says why there is none.
- A match link pasted into Telegram shows a card with what the page shows and
  nothing more; a person who signs up through a member's invite link predicts
  a match (needs T-330's provider on).
- A candidate model has run in shadow over at least 300 pre-kick-off forecasts
  and has either replaced the published version, with the improvement recorded,
  or been recorded as not better.

---

## E50 — More leagues

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-500 | Provider facts for eight competitions: ids, the current season's dates, coverage flags, and the two cups' stage names | T-029 | Every id, date and flag in `14-maintainer.md` came from the provider on a stated day |
| `[~]` T-501 | The request budget at fifteen competitions: each ingest run records the requests it spent, a match day is measured, and a ceiling is set below the plan | T-071 | The projection is in `05-data-providers.md`; a day over the ceiling is a partial run naming the budget, never a refusal from the provider |
| `[x]` T-502 | The six domestic leagues on the server: Championship, Eredivisie, Primeira Liga, Süper Lig, Belgian Pro League, Scottish Premiership | T-500, T-501, D-080 | `--alias-training` agrees with every current-season result in E1, N1, P1, T1, B1 and SC0 |
| `[x]` T-503 | The Europa League and the Conference League on the server, with their stages | T-500, T-501 | Their tables are the league stage's; their match pages say why there is no forecast yet (T-533) |
| `[~]` T-504 | Fifteen competitions on one scores page | T-502, T-042 | A stated order after a member's favourites, and the page stays usable on a phone on a Saturday with every league playing |

**The leagues were chosen for the model, not only for the audience.** Each of
the six is a division football-data.co.uk carries (D-016), so each one's
matches get the same forecast the first five do on the day they arrive; a
league the training data does not hold would be scores without a forecast,
which is Iran's case and has a gate of its own. The two cups add the European
nights of the clubs already covered.

**Why T-501 comes before any league is added.** The plan allows 7,500 requests
a day and the server spent about 740 a day during the international break. The
live job asks once a minute whatever is playing, the line-up job asks per
fixture near kick-off, and every finished match costs its detail calls --
fifteen competitions is roughly three times the matches. The feed counts
requests; today nothing on our side does, so the first overrun would be the
provider's refusal in the middle of a match day. Each run recording its
requests makes the budget a number on `/health/ingestion`, and the ceiling
(`API_FOOTBALL_DAILY_BUDGET`, which exists) turns an overrun into our own
partial run.

---

## E51 — Iran's Persian Gulf Pro League

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-510 | The league on the server: provider facts, competition, season, teams, backfill, and each module's coverage as the feed supplies it | T-500, T-501 | Scores, table and match pages; every module the feed lacks says so in a sentence |
| `[ ]` T-511 | **Decision gate:** whether the model forecasts Iranian matches, and from which licensed history | — | A decision entry; neither football-data.co.uk nor Club Elo covers the league |
| `[ ]` T-512 | The league's forecasts, per T-511 | T-511, T-530 | Its history in the training store under its own division, a backtest beside the others, and a forecast in the seven-day window |

**What T-511 asks, and what the agent will not guess.** The training store is
built from sources whose licences were read and recorded (D-016, rule 9). The
feed's own past seasons are the obvious candidate, and whether the plan the
maintainer holds allows training a model on them is a question about its
terms, which is theirs to answer. The other honest answer is no forecast, and
the panel says so; the Power Index still reads line-up quality and stability
from our own records (T-112) and says what it cannot measure.

---

## E52 — The first members

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[~]` T-520 | Share cards: an Open Graph image for a match, a competition table and a member's settled prediction, rendered with `next/og` | T-065 | A link pasted into Telegram shows the card; a card never shows what its page does not, and a private profile's prediction has none |
| `[ ]` T-521 | A share control on the match centre and after a prediction is saved | T-520 | The platform's share sheet where there is one, a copied link where not; the link carries nothing about the sharer |
| `[ ]` T-522 | Invite links: a member's link, and a sign-up through it offered a friend request to the inviter | T-040, T-201 | The new member may decline; there is no reward and no ranking of inviters |
| `[ ]` T-523 | A page for a first visit: what the product is, the three prediction products, how a rating is earned | — | Linked from the homepage for signed-out visitors; every claim on it is true of the product as deployed |
| `[ ]` T-524 | **Decision gate:** a Telegram channel the product posts to | — | The maintainer creates the bot and the channel and puts the token on the server themselves |
| `[ ]` T-525 | A daily post: the day's covered matches with the model's forecast, each linking to its match | T-524, T-520 | Labelled as the model's; a day with no matches posts nothing |

**Nothing here buys attention.** No points for inviting, no streak bonuses, no
leaderboard of recruiters: the rating is earned by predicting (blueprint 1.5,
rule 8), and a mechanic that rewards bringing people rewards something else.
What this band does is make the product legible where people already talk
about football -- a chat, a channel -- and let one member bring another.

---

## E53 — A second model

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[ ]` T-530 | The baseline restated at scale: the backtest over every loaded division and the last three seasons, against the market and uniform | T-062, T-502 | Per-division log loss and Brier recorded as the numbers a candidate must beat |
| `[ ]` T-531 | Shadow forecasts: a candidate version computed beside the published one for every match, stored and never shown | T-064, T-066 | The evaluation records read both; the match page is unchanged |
| `[ ]` T-532 | The constants D-029 left to the backtest -- time decay, ridge, Elo weight -- tuned per division | T-530, T-531 | Frozen into the candidate only where they beat the baseline out of sample |
| `[ ]` T-533 | European cup matches on one scale: clubs of two leagues forecast from Club Elo and each side's domestic strength | T-531, T-060 | In shadow until the season's cup results show it calibrated; its limits stated in the model's docs |
| `[ ]` T-534 | Line-ups and absences in expected goals: the T-112 measurement as an additive term | T-531, T-112, T-103 | Fitted on our own recorded matches, since the history holds no line-ups; in shadow |
| `[ ]` T-535 | Promotion: the candidate replaces the published version only on the evaluation | T-531 | A decision entry with the numbers; stored forecasts keep their version (rule 5) |

**What v2 has to beat.** The first backtest (T-062, 2024/25 Premier League, 320
forecasts) gave log loss 1.0170 against the market's 0.9811 and uniform's
1.0986. The market is the honest ceiling -- it sees the line-ups, the news and
the money -- and closing part of that gap is the goal, not passing it.

**Why shadow, rather than a backtest alone.** Two of the three additions cannot
be backtested: the history holds no line-ups, and it holds no European cup
matches. Evidence for them can only come from matches recorded from now on,
which is what a shadow version collects. It is not a second prediction product
(rule 6): it is the same model's next version, unpublished until it is better,
and never blended with the first.

---

**T-501 built on 2026-09-26, and stays `[~]` for its measurement.** Each run
records the requests it sent, `/health/ingestion` and `check-setup.sh` show
the day's total beside the ceiling, and the projection is in
`05-data-providers.md`. Writing it found the largest cost before it was spent:
the live job asked the provider's live list once per competition, the same
list every time, which at fifteen competitions would have been more than the
whole plan on a Saturday; it now asks once a tick. The row is ticked when the
first match day after the international break has been measured and recorded
beside the projection.

---

**T-502 started on 2026-09-26: the backfill as a command.** Adding a league on
the server is `catalog.mjs` and then a backfill, and the backfill was only the
admin page's button -- a browser carrying an administrator's own session. An
agent working on the server has neither, and never signs in for anybody.
`dist/cli/backfill.js` is the same act for the operator already on the
server: it names an administrator with `--by`, audits the reason before a
request is spent, and runs without a scheduler of its own.

---

**T-502 and T-503 done on 2026-09-26.** The eight competitions are on the
server with their 2026/27 seasons, backfilled twice (1,153 matches), 241 clubs
adopted, and the two cups' stages added under the names their matches carry
-- the Conference League calls its play-off round "Playoff round". The six
leagues' history is in the training store and `--alias-training` agrees with
every current-season result in all eleven divisions: 379 of 379 in the six new
ones. Trial forecasts answer for each new division. One weakness is visible
already: a club relegated into a division has only this season's few matches
there (West Ham and Wolves in the Championship), and the Elo prior that would
anchor it is absent while Club Elo is down -- T-533's case, and the reason the
constants in T-532 are tuned per division. A cup match's panel now says why
the model has no forecast for it (`cross_competition`) rather than that the
competition "is not mapped", and a domestic league without training history
says that instead.

---

**T-504 built on 2026-09-26, and stays `[~]` until a real Saturday.** With
fifteen competitions the old order -- country, then name -- put the
Championship above the Premier League and every European cup above every
league. A competition now has a stated place (`competition.display_order`,
set with `catalog.mjs --set-order`, audited), and the scores page orders by a
member's favourites, then that place, then country and name as before; the
order used on the server is in `14-maintainer.md`. Whether the page stays
usable on a phone with every league playing is observed on the first full
Saturday after the international break, not asserted.

---

**T-520 started on 2026-09-26: a match and a table.** A link to a match or a
competition pasted into a chat now shows a card, rendered by `next/og` from the
same answers the page is built from (`lib/share-card.ts` decides the words,
`components/share-card-image.tsx` draws them): the teams, the score or the
kick-off -- in UTC, and saying so, because a preview is fetched once and shown
to everyone in the chat -- and the statistical model's forecast with the
model's name when the page shows one; or the top six of the current season's
table. A page that cannot be read gives a card with the product's name and
nothing about the match. A member's settled prediction is the part still to
come, with the rule that a private profile has no card.

