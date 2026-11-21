---
name: rating-community-p7
description: Package 7 (2026-11-08) canvas, live measurements and facts on leaderboard, groups, nav names, profile
metadata:
  type: project
---

- Canvas "Stadiomind Rating and Community": https://claude.ai/artifact/WtyaaDqv4kt84pRUA39Bqf (Main, P7-1..P7-6). Spec: E:\FMIP\ops\reports\ui-review-2026-11-05\P7-mockups-fa.md. Nobody saw it rendered. Css assets of this canvas: base 5ede763e89aa738fc236bf91adef301f (copy of P5/P6 base), p7 5386a83e9ee118aa2ac49026489d2bf7. Style holes (`style="{{x}}"`) avoided: classes instead. Working folder: scratchpad p7build.
- Facts 2026-11-08: leaderboard phone empty sentence at y1043 (688px below filters start 355), desktop y789; board has 0 ranked yet 8 competition chips (predictions settled, nobody holds 30). Leaderboard and profile are NOT in perf-budgets.json. Floor 30 = versioned console row (D-152): card must read API `floor`, never type 30.
- API facts: `GET /groups` is guest-readable (public + discoverable only: name, description, member_count, language, favourite); `GET /groups/:slug` needs a viewer (401). Profile `favourite_teams` is names not ids. `GET /me/rating` rating null = 0 settled. No member-wide pending-pick list (D-361 endpoint is per fixture); no "resend confirmation" flow.
- Header at 1280 has 10px slack (More ends 778, search starts 788); "Predictions" link 88px; 1440 has ~250px. About page has no rating anchor (ids: about-how, about-map, model). Founder's analysis has no page (/en/founder 404), only #analysis on /scores.
- Site's Persian word for rating is «امتیاز» (not «رتبه»); leaderboard «جدول برترین‌ها»; "settled" «تسویه‌شده».
