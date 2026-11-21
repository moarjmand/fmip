---
name: competition-team-p5
description: Package 5 (2026-11-07) canvas, live measurements and data facts for competition and team pages (table, rounds, UCL zones, bracket, MLS, team default)
metadata:
  type: project
---

- Canvas "Stadiomind Competition and Team": https://claude.ai/artifact/3aRDWN3a7Hu2NWhJdaUFkG (Main, P5-1..P5-8). Spec: E:\FMIP\ops\reports\ui-review-2026-11-05\P5-mockups-fa.md. Nobody saw it rendered. Css assets (current): base b394ac90..., p3 478bff39..., p4 19cd0d63..., p5 95995de540c3f70dd75c13c97ac1b250 (table .tr5/.fz/.vp/.in, chips .chp5, bracket .bkc/.tie5). Working folder was scratchpad p5build.
- Facts verified 2026-11-07: standings phone columns W/D/L/Goals/Form are display:none (sm/md classes, T-1203), box already overflow-x:auto. Matches tab 21,301px PL (results at 15,780), FA Cup 19,670 with rounds named only by dates (labels null, D-193); EFL Cup rounds are named. Round machinery (seasonRounds, defaultRound, ?round=, round-picker nav + details) exists server-side on the Overview only.
- Zones: committed list league-zones.json has 81 entries for domestic divisions/countries only; NO UCL entry and no kinds for round-of-16/play-off places, so UCL bands need a contract+data change (D9 in the spec), not a UI rule.
- Team page default is "first of API competitions that has data" (lib/team.ts recordFigures/topScorerEntry/mainStanding); API sends EFL Cup first. Around them draws a card per competition incl. an empty cup card (148px).
- UCL 2025/26 (season picker) has a full real bracket (23 ties) but no league-phase table and no sentence about it; its play-off round is labelled "Round of 32". 2026/27: all five rounds not_drawn. Phone bracket 4,266px, desktop 1,750.
- MLS at 1440: main column 854px, xl:grid-cols-2 keyed to viewport, tables 439px in 401px boxes.
- Public web has no /api/competitions route; read pages by DOM in the browser pane. Site clock lagged: Fri 6 Nov 21:46 UK on 7 Nov; PL MW10 had one result (Everton 3-1 Coventry).
