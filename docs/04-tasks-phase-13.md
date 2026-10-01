# Phase 13 — Persian, and images

Two requests from the maintainer on 2026-10-01: "add Persian professionally,
right now" (D-175), and images across the product after a review of the
options, of which they chose crests and competition logos, licensed news
photos and player photos (path "A + B + C"; D-176, D-177).

**Where Persian starts.** The locale machinery exists (T-150, T-300, T-302):
routing, direction, plural rules from CLDR, a catalogue per locale, a
fallback that says so. 563 strings go through the catalogue; most of a
page's other text is English written in the page itself, which a catalogue
cannot translate. `Intl` gives Persian the Solar Hijri calendar and Persian
digits without any code (`۹ مهر ۱۴۰۵، ۲۲:۰۰`, `۶۴٪`).

**Where images start.** API-Football's responses carry crest, logo, flag and
photo URLs that no adapter keeps; news feeds carry enclosures that the
parser drops; D-061 took no news images. A reader's browser must never
request a third party (the D-089 precedent), and no provider URL may reach
the API (rule 2), so every image is fetched once by the server, stored, and
served from the site's own origin.

## Persian

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1300 | This plan | — | The two requests and their decisions |
| `[x]` T-1301 | `fa` as a locale: routing, direction, the catalogue (every key), the glossary's terms, the language name, held out of the picker and the index while pages are written (`PREPARING_LOCALES`) | T-1300 | `/fa` renders right-to-left with Solar Hijri dates and Persian digits; every catalogue key has Persian text |
| `[x]` T-1302 | The text of the homepage, header, footer, first run, about, rules and error pages through the catalogue | T-1301 | No English written in these pages; Persian for each key |
| `[x]` T-1303 | Scores, the score card and the match centre | T-1301 | As T-1302 |
| `[x]` T-1304 | Competition, team, player, comparison, search and watch pages | T-1301 | As T-1302 |
| `[x]` T-1305 | News, story, following, saved and notifications | T-1301 | As T-1302 |
| `[x]` T-1306 | Sign-in, registration, verification, password pages, settings, a member's profile | T-1301 | As T-1302 |
| `[x]` T-1307 | Predictions, leaderboard, prediction history, founder's and community analysis | T-1301 | As T-1302 |
| `[x]` T-1308 | Friends, messages, groups, invitations, match panels | T-1301 | As T-1302 |
| `[x]` T-1310 | Persian offered: out of `PREPARING_LOCALES`, indexed, picked for a reader whose browser asks for Persian | T-1302..T-1308 | The picker offers فارسی; `hreflang="fa"` on every page |
| `[x]` T-1311 | Persian names for the clubs and competitions a Persian reader meets first (the Iranian league, the national team), through the localised names (T-303) | T-1301 | Iranian clubs read in Persian on `/fa` |
| `[x]` T-1309 | The shared helpers the areas left in English: bracket rounds, incident and statistic labels, tiers, conversation titles, territory names, the demonstration title, share messages, action failures (#487). The words drawn on share-card images stay English: the image renderer (Satori) lays Persian words out left to right and draws the zero-width non-joiner as a box | T-1302..T-1308 | A Persian page shows no English beyond proper names without a Persian spelling and text the API supplies |
| `[x]` T-1312 | Localised names on every surface: every API read takes `?locale=` and returns the localised team, competition and person names, countries by `Intl.DisplayNames`; the live streams per locale (#488) | T-1311 | `/fa` shows «پرسپولیس» in the scores list, the table and the match centre |

## Images

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1320 | The entity media store: crests, competition logos and player photos fetched once from the provider, stored on the server, served from our origin, as an additive contract field with a coverage state (D-176) | T-1300 | No provider URL in any response; a missing image is `not_supplied`, never a placeholder silhouette |
| `[x]` T-1321 | Crests, logos, flags and photos on the pages: scores rows, match centre, competition, team and player pages, leaders and line-ups; a lettered mark where there is none | T-1320 | No layout shift; axe at zero; no request leaves the site |
| `[x]` T-1322 | Licensed news images: an image right per source, CC BY 4.0 for Mehr, Tasnim and Tehran Times only, the agency's own photos only, stored and served by us, with credit (D-177, amending D-061) | T-1300 | An image from a source without the right is refused by the database |
| `[x]` T-1323 | News images on the pages: story cards and the story page, with the credit and licence visible (#498; the saved list and the following feed carry no image in their contracts yet) | T-1322 | Every shown image names its source and licence |
| `[x]` T-1324 | Player photos for players already held: a monthly squads sweep within a daily request cap, each photo handed to the media store (#499, `INGESTION_SQUADS_PER_DAY`, default 60) | T-1320 | A player who has not played since T-1320 gets their photo within a month |

**Done on 2026-10-01.** T-1320 (#490) and T-1321 (#492): 270 club crests and
the competitions' logos were fetched within the first hour and are served
from `/api/media/...`; a team without one shows a lettered mark. T-1322
(#491, #495): photos from Mehr, Tasnim and Tehran Times are decided, stored
and carried on the story contracts with their credit; the maintainer chose to
accept a photo whose page names no other agency (D-177). T-1323 draws them (#498); the `/media/news/*` route reached readers only once caddy was recreated, which `rollout.sh` now does when its config changes (#501). Flags are not shown:
no decision covers a flag package.

## News by language

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1330 | A source's stories only for readers of its language, set per source in the console (D-178, #494): on by default for every Persian source; a story shows the article the reader may see, or is absent | T-1301 | `/en/news` shows no Persian source; `/fa/news` shows them; an administrator switches it per source with a reason, audited |


## Empty days

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1331 | An empty day on Scores points at the next day with a match (asked in two 14-day windows, the API's cap), so the FIFA window of 21 September to 6 October does not read as a broken page | T-031 | `/en/scores` on 2026-10-01 links to Thursday 8 October; a live or favourites view is unchanged |


## National teams

The maintainer chose to add national-team competitions so Scores is not empty
during FIFA windows: the UEFA Nations League, international friendlies, the
Asian Cup and the Africa Cup of Nations qualification (D-179).

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1332 | National-team competitions: a queued team carries the competition it was seen in (`payload.seenIn`); `catalog.mjs --adopt-teams` leaves a team seen in an `international` competition for `--adopt-national`, which takes each one's country by FIFA trigram from a list the operator fills in (`--dry-run` prints it); the forecast says "not in the model's training data" for them and asks no cross-league candidate; the squads job asks clubs only. Production steps in `docs/14-maintainer.md` section 2 | T-029, T-503, T-1324 | `--adopt-teams` never creates a national team as a club; `--adopt-national` refuses an id not queued from an international competition, an unknown country and a country that already has one; a national-team match's forecast is `competition_not_mapped` |
| `[ ]` T-1333 | Group tables for group stages: write `fixture.group_name` from the provider's group tables (each group's teams) so the Nations League, Asian Cup and AFCON qualification groups have a table, and compare the provider's group tables with ours group by group in the standings check (today it compares them with the league table, which a group stage does not have, so every row is a `table_disagrees` finding) | T-840, T-1332 | A Nations League match's context shows its group's table; the standings run for these competitions is not `partial` when the matches are all held |
| `[x]` T-1334 | National teams and national-team competitions named in the reader's language: a national team without a name row is called what its country is called (CLDR, as countries are); the four competitions get Persian names by their provider ids (migration `1765836000000`) | T-1312, T-1332 | `/fa/scores` reads «ایران» and «لیگ ملت‌های اروپا»; `/en` keeps the canonical names |
