---
name: social-cards-console-p11
description: 2026-11-15 social cards (3 types) and console Social tab mockups: canvas link, real matches used, facts and tool gotchas
metadata:
  type: project
---

- Canvas "Stadiomind Social Cards and Console": https://claude.ai/artifact/8vSCNRkH1mFjgLhyRXw7tS (11 boards; shared files project/cards.css and console.css linked relatively; phone board and feed test use dc-import of other boards with transform scale). Spec: E:\FMIP\ops\reports\designer\2026-11-15-social-cards-console-fa.md. Never seen rendered (private).
- Real matches: forecast Newcastle v Arsenal (b462c8b5..., 17.7/25.3/57.0, dixon-coles-elo@0.7.0 v1); check hit Salamanca UDS 0-5 Celta Vigo (match 1a8d3cdf..., 2026/27 Copa del Rey; the 2024/25 one 65706b38 is 0-7); check miss Real Avila v Unionistas (9a6a4329..., 0-0 after 90, 1-0 AET; model forecasts 90 min); Norway 3-1 Wales (956a6d20..., Nations League has no model forecast).
- Site facts: built cards are Night (D-351) and use initials() badges; match page "Model" section shows "What was forecast, what happened" with RPS after the match; /en/scores?date=YYYY-MM-DD lists matches; team search /en/search?q= finds team ids.
- Gotchas: fetching 100 match pages in one javascript_tool call times out (45 s): start it unawaited into window.__x and poll; the pane tab title stays "You are offline" but fetch works. Do not run python heredocs in Bash here (hung pyrepl).
