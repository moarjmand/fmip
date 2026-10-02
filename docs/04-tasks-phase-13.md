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
| `[x]` T-1333 | Group tables for group stages (D-180): every adapter reads a table's group from its label (`groupOfLabel`: "Group A" → `A`, "League A - Group 1" → `1`, a league's or conference's table → none); the hourly standings run writes `fixture.group_name` on each fixture of a `group`-kind stage whose two teams are in one provider group (in two different groups: none; a team the tables do not name: left as it is; a knockout or play-off stage, a friendly: never), then compares each provider group table with ours group by group and records a season's findings in one write (a write per group resolved the group before). No backfill: existing fixtures take their group on the next standings run once their stage exists (`docs/14-maintainer.md` section 11, step 6) | T-840, T-1332 | `group-assign.spec.ts`: a group-stage fixture whose teams share a provider group takes it, teams in two groups leave none, a team in no table and a knockout fixture are untouched, a second run writes nothing, and `groupTables` ranks each group on its own; `groupOfLabel` and `groupMembers` specs with constructed provider tables; the league table's comparison is unchanged (`ingestion-jobs.spec.ts`, the standings case) |
| `[x]` T-1334 | National teams and national-team competitions named in the reader's language: a national team without a name row is called what its country is called (CLDR, as countries are); the four competitions get Persian names by their provider ids (migration `1765836000000`) | T-1312, T-1332 | `/fa/scores` reads «ایران» and «لیگ ملت‌های اروپا»; `/en` keeps the canonical names |
| `[x]` T-1335 | Persian names for the national teams whose CLDR region name is not the football name (DR Congo, Congo, Palestine, Hong Kong, USA, UAE): `entity_alias` rows by FIFA code (migration `1765837000000`) | T-1334 | `/fa/scores` reads «کنگو دموکراتیک» and «فلسطین», not «کنگو - کینشاسا» and «سرزمین‌های فلسطینی» |
| `[x]` T-1337 | Persian names for the national teams whose country has no ISO code (England, Scotland, Wales, Northern Ireland, Kosovo), so no CLDR fallback: migration `1765838000000` | T-1335 | The Nations League group tables on `/fa` read «انگلیس» and «ولز» |
| `[x]` T-1336 | The competition page shows every group's table when its season has a group stage: `GET /competitions/:id` carries `group_tables` (`Covered<GroupTable[]>`, null for a season with no group stage, so a league answers and renders exactly as before), built by `StandingsService.groupStandings` from the same `groupTables` derivation the standings job and the match centre's group line use, in stage then group order, a group with no finished match listed by its teams without positions; the page groups them under their stage when there are several ("League A" → "Group A"), drops the league table only when a group season's league table has no rows, and labels groups with the existing `matchCentre.group` key. Coverage: a finished match of a `group`-kind stage that carries a `group_name` now owes the table (`coverage-store.ts`), as the group tables count it; the hourly fixtures job recomputes it, every targeted season by the 04:07 UTC sweep | T-1333 | `competition.http.spec.ts`: a cup with League A and League B ranks groups "2", "10" and "A" in that order, a not-started group has teams and no rows, a group-less match counts nowhere, and the league competition's `group_tables` is null; `group-tables.spec.ts` (`groupStandingsModule`); `standings-table.spec.tsx`: one stage heads groups by name, several by stage, a not-started group is a sentence, the league table keeps its zone marks; `ingestion-jobs.spec.ts`: a group stage's standings coverage is `not_supplied` until its matches carry a group, then `available` |
| `[x]` T-1338 | Out-of-coverage sides set aside: a fixture with a side whose team id is `ignored` in the review queue is skipped by every job without being written or reported (a person set aside likewise in line-ups, incidents, player statistics and availability), so the friendlies' youth, women's and club sides no longer make most runs partial; `catalog.mjs --ignore --type <team\|person\|venue>` sets pending ids aside from a file or, for teams, `--waiting-international` (every waiting team last seen in an international competition), with `--by` and `--reason` required and each row audited (`catalog.entity_ignored`); `--unignore` puts them back (`catalog.entity_unignored`). Production steps in `docs/14-maintainer.md` section 11 | T-1332 | `ingest-store.spec.ts`: an ignored home or away side writes nothing and reports nothing, an unreviewed side is still reported, an ignored player is skipped unreported; `ingestion-jobs.spec.ts`: with the queued clubs ignored the fixtures run is not partial; `catalog-ignore.spec.ts`: the dry run lists the waiting national sides and not a club, an unknown administrator writes nothing, pending ids are set aside with who and why while a resolved one is left, and `--unignore` restores one, all audited |
| `[x]` T-1339 | The provider's stage names and rounds in the reader's words, in the web layer (the API passes them on as data): `lib/stage-label.ts` (`stageLabel`, `STAGE_KEYS`) maps the known names (Regular Season, League Stage, Group Stage, Groups, Preliminary Round, 1st/2nd/3rd Qualifying Round, Play-offs, Knockout Round Play-offs, Round of 32, Round of 16, Quarter-finals, Semi-finals, Final, 3rd Place Final), "League X", "Group X" and the round form "<stage> - <n>" ("Regular Season - <n>" is the matchday alone) to `stage.*` catalogue keys, the number in the reader's digits; anything else is returned unchanged, and in English every label equals the provider's text. Used by the score card and the match centre header (keys in `SCORES_KEYS` / `MATCH_KEYS`), and through `stageName` (`lib/competition.ts`) by the competition page's fixtures, the group tables' stage headings and captions, the match centre's knockout round and a profile's `full_matchday` achievement | T-1336 | `stage-label.spec.ts`: every known form reads the same in English, «لیگ A»، «مرحله‌ی گروهی»، «هفته‌ی ۱۲»، «لیگ A، هفته‌ی ۱» and «گروه ۲» in Persian, unknown text ("Semi-finals Qualifying", "Regular Season - 03") unchanged; `score-card-stage.spec.tsx`: a Persian score card shows «لیگ A» and «لیگ A، هفته‌ی ۱» and no "League A", the English card is unchanged; first-load budgets hold (scores 167.0 kB, match 174.4 kB) |
| `[x]` T-1340 | A round whose words the adapter cannot classify keeps the stage an operator gave it: `IngestStore.stageId` falls back from the adapter's stage name to the round, matched as `catalog --add-stage` stamps it (the stage's name, or the name and " - "), longest name first. On production every fixtures poll set the Nations League's "League A - 1".. rounds back to no stage, so the group tables counted France 0 played where the provider counted 2 | T-1333 | `stage-of-round.spec.ts`: the adapter's name decides when it has one; with none, "<stage> - 1" and "<stage>" find the stage, "<stage>B - 1", another round and no round find none |

## Backups

The maintainer asked on 2026-10-01 whether everything is backed up and for a
complete copy on their own computer, on an external drive (`E:\Backup`). The
nightly dump went off-provider every night and the monthly drill passed; the
media volume (T-1320, T-1322) was in no backup.

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1341 | The media volume in the nightly backup (`<remote>/media/`, copied not synced; the remote's pruning reads the top level only), and `pull-copy.sh` for a dated copy on the maintainer's machine: dump and manifest (sha256 checked), media as one `media.tar`, a bundle of the repository, `INFO.txt`; secrets never copied | T-072, T-1320 | The next nightly run records the media count in `backup_run`; `pull-copy.sh /e/Backup` writes a copy whose dump matches its manifest and whose bundle verifies |
| `[x]` T-1344 | `rollout.sh` prunes BuildKit cache older than `ROLLOUT_BUILD_CACHE_HOURS` (default 72) after each rollout: the cache had reached 57 GB of the 75 GB disk (85 % used; 46 % after a manual prune on 2026-10-01) | T-074 | A rollout ends with the prune line in its log; `docker system df` shows no build cache older than three days |
| `[x]` T-1350 | A match a day or more ahead is never shown as played: the API-Football adapter drops a fixture it is told is live or finished when its kick-off is at least 24 hours after the answer arrived, as it drops an unknown status. On production the provider listed AFCON qualifier 1545957 (Tunisia v Botswana, 28 March 2027) as "FT" 2-2, and group H counted it | T-1333 | `api-football.spec.ts`: "FT" and "1H" a day ahead give no fixture; "NS" and "PST" a day ahead and "FT" within the day are kept |

## Upkeep

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1343 | Stage and round said once, in one wording: the knockout bracket's round names come from the `stage.name.*` keys `stageLabel` uses (the `bracket.round.*` keys are gone from every catalogue), and `stageAndRound` (`lib/stage-label.ts`) leaves the stage out when the round already names it ("League A" with "League A - 2"), on the score card and the match centre header | T-1339 | `bracket.spec.ts`: every round's label equals `stageLabel` of the provider's name in English and Persian («یک‌هشتم نهایی»); `score-card-stage.spec.tsx`: a Persian card shows «لیگ A، هفته‌ی ۱» once and no separate «لیگ A», a stage the round does not name stays; `stage-label.spec.ts` covers `stageAndRound` |
| `[x]` T-1342 | `data-quality.http.spec.ts` deterministic: CI run 36930228120 (PR #516) failed five of its tests because `ingestion-jobs.spec.ts`, running beside it against the same database, cleaned up every api_football fixture mapping first seen since it started, which took the two ids the data-quality spec gives one fixture between two of its sweeps (the `fixture_mapped_twice` finding resolved, the re-ask of that fixture found nothing to ask). The ingestion spec now deletes only the mappings it wrote and the fixture mappings of its own season's fixtures, before those fixtures go | T-820, T-913 | Both specs pass together against one database; no other suite's provider mapping is deleted by `ingestion-jobs.spec.ts`; the data-quality spec's assertions are unchanged |
| `[x]` T-1345 | A photo whose header names one raster format and whose bytes are another is stored under the type its bytes are, not refused: the first squads sweep (2026-10-02 03:41 UTC) left 511 player photos `failed` as "declared image/png, reads as image/jpeg" (or webp), API-Football's `.png` addresses serving JPEG. A mismatch involving SVG is still refused. The failed rows are retried by the existing back-off (2^attempts hours), so no backfill | T-1320, T-1324 | `image-check.spec.ts`: `image/png` with JPEG or WebP bytes is kept as `image/jpeg` / `image/webp`; `image/svg+xml` with PNG bytes, `image/png` with SVG bytes and unknown bytes are refused |
| `[x]` T-1346 | A country without an ISO code (England, Scotland, Wales, Northern Ireland, Kosovo) is named on a localised page by its senior men's national team's name row in that language, so the Persian scores list's heading for the English leagues reads «انگلیس» rather than "ENGLAND"; no row, its own name. Query only, the T-1337 rows already exist | T-1312, T-1337 | `localised-names.http.spec.ts`: a test country with no ISO code keeps its name, then takes its national team's Persian name row once one exists; English keeps the canonical name |
| `[x]` T-1347 | `platform-rules.http.spec.ts` safe beside parallel suites: CI on PR #522 failed its cleanup with "violates RESTRICT setting of foreign key constraint platform_rules_acceptance_version_fkey", because the three cleanup statements ran one by one and another suite registered a member (who accepts the version in force, the spec's temporary 1.1.0) between deleting 1.1.0's acceptances and deleting 1.1.0. The cleanup is now one transaction that first locks the 1.1.0 row (`FOR UPDATE`, which waits for registrations and acceptances already holding a key-share lock on it and holds off new ones); another suite's acceptance of 1.1.0 is moved to 1.0.0 rather than deleted, so its member still has one | T-931, T-1342 | The spec's assertions are unchanged and it passes; its cleanup cannot meet a 1.1.0 acceptance or account written after it looked; no other suite's member is left without an acceptance row |
| `[x]` T-1348 | The match T-1350 found stored as played is put back: migration `1765839000000` returns any fixture called live or finished a day or more before its kick-off to `scheduled` and removes its score (its `skipped` summary row is an immutable version and stays, never served). On production that was AFCON qualifier 1545957 (Tunisia v Botswana, 28 March 2027, "FT" 2-2), with no prediction, settlement or incident on it; group H's table and the hourly standings run stop counting it | T-1350 | After deploy, no fixture more than a day ahead is `live` or `finished`, and the standings run no longer reports "Botswana: provider 2 played, we have 3" |
