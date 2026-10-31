# The golden set: defects we have shipped, and what must catch them

Every real defect found on the live site goes here, with the check that catches it now. The
auditor is judged on this list (D-326): on a database restored from before a fix, it must find
the defect. A defect with no check yet is a gap to close, by an invariant in `invariants.sql`
or by a page check in `SKILL.md`.

| # | Found | Defect | Where it showed | Caught by | Fixed by |
|---|---|---|---|---|---|
| 1 | 2026-10-31, teammate | The 90-minute score shown for a cup match settled in extra time (Manresa 0–0 shown, 2–2 played) | match page, score cards, form | R1 (the sum) and page check P1 | T-1664, T-1665, D-317 |
| 2 | 2026-10-31, teammate | Shoot-out kicks counted as goals on the scorers' board and the player page (Copa del Rey 180 goals for 168) | competition boards, player stats | R3a, R3b, R4 | T-1673, D-322, T-1679 |
| 3 | 2026-10-31, teammate | A shoot-out read short when the feed missed a kick | match timeline | R3b | T-1666, D-318 |
| 4 | 2026-10-31, teammate | MLS shown as one table, no conferences | competition page | T2, page check P3 | T-1667, T-1671, T-1672, D-319 |
| 5 | 2026-10-31, agent | Play-off matches counted in league tables (MLS 2025 35–40 played for 34) | every league table with stage-less play-offs | T1 | T-1678, D-325 |
| 6 | 2026-10-31, teammate | Argentina's knockout rounds without a stage name | match page, fixtures | N1 (stage and round both empty), page check P2 | T-1668, T-1676, D-320 |
| 7 | 2026-10-31, teammate | Cricket and tennis on the news pages | news | page check P4 | T-1669, T-1675, D-321, D-324 |
| 8 | 2026-10-31, agent | Brasileirão zones never served (looked up by the shown label) | competition page | page check P3 (zones legend) | T-1674, D-323 |
| 9 | 2026-10-28, maintainer | Line-ups swapped between the sides | match page | I2 (one person on both sides) | 2026-10-28 round |
| 10 | 2026-10-28, maintainer | Line-ups late: our job, not the feed | match page an hour before | S4 (job failing or stopped) | 2026-10-28 round |

## Found by the first audit (2026-10-31), not yet fixed

- **R6, visible today:** "Pens 0-0" on matches with no shoot-out: Gornik v Legia and Widzew v
  Wisla (Ekstraklasa, October 2026), Rayo v Athletic (abandoned), and Celtic v St Mirren (Scottish
  Cup semi-final 2026-04-19: 6-2 after extra time is right, only the shoot-out row is false). The
  feed's `extratime` and `penalty` zeros are stored as periods played.
- **R1/R7:** Pafos v Hajduk and Los Garres v Manises, 4-0 after extra time, shown 2-0 with
  "90' 4-0": `extra_time` holds the first leg's score and `current` is wrong.
- **R3a:** Malavan v Sepahan, Hazfi Cup 2025-04-26: Malavan won 4-2 on penalties (Tasnim); we
  store 1-0 and only Sepahan's kicks.
- **I2:** five matches with one person on both line-ups ("M. Ali" in Al-Wahda v Al-Wasl with two
  shirt numbers, a "Trialist"): resolution by name.
- **P4:** a wrestling story (Tehran Times) on `/en/news`.
- **I4:** every club has no country (4,013), so same-name clubs cannot be told apart; I1 was
  narrowed to one competition and found Neftchi twice in the AFC Champions League Two.

## Accepted: known and explained, not findings

- **The feed's own wrong answers, left to the provider (the maintainer, 2026-10-31):** re-asked on
  2026-10-31 (T-1681) and answered the same. R1/R7: Pafos v Hajduk and Los Garres v Manises (4–0
  after extra time, stored 2–0), Khujand v Neftchi 2020, Kocaelispor v Sivasspor 2025; R2:
  Bengaluru v Maziya 2020; R3a: Malavan v Sepahan (Hazfi Cup 2025-04-26). Report them in one line
  with their count; flag only a new match of that shape.
- **I2, one provider player id on both line-ups** (five matches): a feed error; the page will mark
  it as unclear in the source (the maintainer's choice). Report the count; flag only a new one.
- **R4 after T-1679:** 2 shoot-outs (Danish Superliga 2021-05-28, Belgian Pro League 2026-05-31)
  with one kick stored; nothing more can be read.

- **R3b, past seasons:** shoot-outs whose first kick the feed never stored (154). Report the count,
  not each match.
- **T1, Major League Soccer 2020/21:** the MLS-is-Back group stage.
