# Phase 12 — A design pass over the pages a reader meets

Phase 7 gave the product an identity (D-089), tokens, a theme, shared
components, and a mobile-first scores list and match centre (T-600 to T-605).
Every other page kept the layout it was first built with. On 2026-10-01 the
maintainer asked for a design review; the live site was walked at 375 x 812
(a phone), at 1280 x 800 and in right-to-left, and this is what it found.

**Findings (2026-10-01, on traveltohormuz.ir).**

- The homepage ended with "Locale: en" and "API: ok, up for 4345s as of
  2026-09-30T21:32:14.566Z", developer lines from Phase 0.
- The homepage's match list wrapped unevenly: a long pair of names dropped
  below the time, a short one sat beside it. Its lists were bare underlined
  links, and its table had no headings.
- On the scores list at 375 px, names were cut to "Nassaji Maz…",
  "Aluminium …" and "Esteghlal Kh…" while a second line stood empty.
- Raw ISO timestamps were printed as text: "Snapshot
  2026-09-30T21:32:42.320Z" on scores, "Updated 2026-09-26T16:15:19.876Z" on
  the competition's modules, and "Last data update …" on the team, player,
  comparison and leaderboard pages.
- The competition table at 375 px carried eleven columns: every club's name
  wrapped onto two lines and the form column became a vertical stack of
  letters at the screen's edge.
- The match centre's recent form lines up its second column at a different
  place on every row.
- The team page's home-and-away tables repeat "Not supplied for these
  matches" under every figure the feed does not carry, seven rows per
  season.
- The news page's filters fill the whole first screen on a phone before a
  single story.
- At 1280 px the header wraps onto two rows (navigation and search, then
  register, settings and the theme switch).

Rules 3 and 4 stand throughout: a figure the feed does not supply is still
said to be missing, and a stamp still says when it was taken; only how it is
said changes.

## Tasks

| ID | Task | Deps | Acceptance |
|---|---|---|---|
| `[x]` T-1200 | This plan | — | The findings above, from the live site |
| `[x]` T-1201 | The homepage: the developer lines gone, the match list in a fixed time column, each list a bordered box of rows, the table with its headings; and every stored moment printed for a reader (`components/stamp.tsx`), in the viewer's zone and saying "UTC" when that is the zone | T-1200 | No ISO string printed as text on the homepage, scores, competition, team, player, comparison or leaderboard pages |
| `[x]` T-1202 | The scores list: a team's name wraps onto a second line before it is cut | T-1200 | At 360 px a two-word name reads whole; the row stays one link |
| `[x]` T-1203 | The competition table on a phone: position, team, played, goal difference and points; the rest from the tablet width up | T-1200 | At 375 px no name wraps for want of room and no column is cut |
| `[ ]` T-1204 | The match centre's recent form and head-to-head as aligned rows | T-1200 | Result, score and opponent, date in fixed columns |
| `[ ]` T-1205 | The team page's figures: the figures the feed does not supply named once per table, not once per row | T-1200 | Rule 3 still holds: each missing figure is named |
| `[ ]` T-1206 | The news filters behind a disclosure on a phone | T-1200 | The first story is on the first screen at 375 px |
| `[ ]` T-1207 | The header on one row at 1280 px | T-1200 | Navigation, search, account and theme on one line from 1280 px |
