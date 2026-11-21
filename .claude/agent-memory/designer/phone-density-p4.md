---
name: phone-density-p4
description: Package 4 (2026-11-07) canvas, live phone measurements and conflict resolution (D-368 vs 72px row), reusable canvas CSS assets
metadata:
  type: project
---

- Canvas "Stadiomind Phone First Screen": https://claude.ai/artifact/HG58Rai3QLZfuwVK2Yf5MW (Main, P4-1..P4-8). Spec: E:\FMIP\ops\reports\ui-review-2026-11-05\P4-mockups-fa.md. Nobody saw it rendered. Assets: base css /_blob/c92cad538f693a7477650071e672e5a9, p3.css /_blob/216d85939051b5931de146b82b0e58e0, p4.css /_blob/97a050f947d6ffa9fe9e0a68cd630c40 (phone frame .v4, header .hd4, rail .rail4, line .rl4, row .r72, group .gr4); working folder was scratchpad p4build.
- Live phone facts 2026-11-07 (375x812 guest): rail 185px on every page, header 61 (relative, direct child of body so sticky works), tab bar 61 fixed; home banner 186 (FA 242), main match at 818; scores first row 692, rows 95-117, group header 57 sticky already, desktop row already 72px (grid 52/1fr/208/72); player first number ~913; register field 479/submit 1023; login 358; 404 title 278. Site clock was 6 Nov 21:46 UK while system date 7 Nov: lists differ by day (Sat 7 Nov: 128 matches, 26 groups).
- Decision-relevant: D-338 already folds the rail to a 44px button line on the match page (precedent for P4 D1); D-368 labels above bar stay, the bar goes in a 104px side column; Pick must sit under the time (start column 56px) or 73% of EN rows wrap a name; honest ceiling is ~6-8 matches/screen, not Sofascore's 10-12.
- FA strings read: tab bar بازی‌ها/پیش‌بینی/لیگ‌ها/اخبار/شما; FA 404 text; «ممکن است به‌روز نباشد» = shell.moments.behind; «آخرین بررسی N ثانیه پیش». FA review screenshots can be read with the Read tool (ops shots folder) to get Persian text.
- Workflow notes: browser screenshots saved under C:\Users\arjma\.claude\projects\...\tool-results\*.jpg can be uploaded as canvas assets (Now images); resize_window colorScheme light/dark emulates prefers-color-scheme without touching the site's theme switch; canvas sc-for with nested sc-if worked in all boards written (not render-verified).
