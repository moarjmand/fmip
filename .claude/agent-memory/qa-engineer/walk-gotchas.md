---
name: walk-gotchas
description: How to measure the live site reliably when the browser pane is shared, and false alarms already ruled out
metadata:
  type: project
---

- The built-in browser tabs may be navigated by another session mid-walk (seen 2026-11-11 and 2026-11-12, even on a tab I created). A fresh tab has innerWidth 0 until `resize_window` is set on it. Robust method: in one javascript_exec, define the helper inline (it is lost on navigation), load each page in a hidden same-origin iframe (width 375 or 1280), wait ~2 s, run the check on iframe.contentWindow. Keep one call under ~40 s (about 6 pages at 375); a longer one times out.
- innerWidth 0 makes overflowX true everywhere: a false alarm, check innerWidth first. iframe scrollWidth reads 15 px under the width (scrollbar): normal.
- Open since 2026-11-10: qa-2026-11-10-01 (fa competition page 375 px, scrollWidth 415 vs en 360; cause outside <main>), still reproduces 2026-11-16.
- False alarms: fa home model list shows Ligue 1 where en shows Belgian Pro League (tie order). "Tasnim News Agency (CC BY 4.0)" in /fa/news and "Manchester United" in /en/news are an image credit and a team tag, not stories. "Updated 7 days ago" on a not-started match is normal. PL table "Updated 8 Nov" during an international break is normal.
- Seen 2026-11-12, open: qa-2026-11-12-01 player page "Unused sub" + "1 goal". Module label "xG (Highlightly)" names a provider on match pages (owner's call).
- Baselines: model-accuracy 883 matches 58% (to 15 Nov). Tehran = UK + 3:30 in November. International-break days have no cup/extra-time candidate. Line-ups pitch lists away team first: by design. Home en/fa match counts can differ by Tehran day boundary. /en/scores?date=YYYY-MM-DD gives other days.
- Tab hijack: park a tab made with tabs_create (not the "seed" tab) at /robots.txt; survived 2026-11-15 and 2026-11-16. Console errors are not readable via iframes.
- 2026-11-17: tab hijack even on tab-2; iframe calls with 8 pages got cut off, 3 pages per call worked; append iframe to document.documentElement (robots.txt body can be null). en news non-football gone; opened qa-2026-11-17-01 (accumulator tips, US high-school poll); qa-2026-11-10-01 still 415 px.
- 2026-11-16: opened qa-2026-11-16-01 (en news non-football: I'm A Celeb, Russell Brand, cricket), -02 (player season order, 2027/28 label), -03 (Kyrgyzstan v Vietnam stuck). Check whether the news filter is fixed next time.
- 2026-11-18: seed tab hijacked mid-call again; tab-2 on robots.txt worked all walk. qa-2026-11-10-01 (fa comp 415 px) NOT reproduced on 9 comps: fixed-unverified, re-check twice then resolve. Kyrgyzstan v Vietnam resolved. en news now has Beckham fragrance (2x) as non-football. New qa-2026-11-18-01: player page last update 13 Nov omits 17 Nov match. Model baseline unchanged 883/58% (to 15 Nov). Persian Gulf Pro League comp id 1cc6df09-..., PL 607293fd-..., MLS 9458f030-....
- 2026-11-20: tab-1 (tabs_create, parked at robots.txt) worked all walk, no hijack; 3 pages per iframe call fine. Header/skip-link at iframe 375 report right=375/376 (scrollbar): false alarm, use threshold >377. Closed site-menu panel has buttons at negative left: hidden, not a fault. New: qa-2026-11-20-01 (fa match 375 px scorer span nowrap, sw 381), -02 (GTA 6 story en news). Model baseline 898 matches 58% (to 20 Nov). Seattle v RSL (pens) /match/ac80885c-... is a good shoot-out candidate when it is in yesterday's list.
