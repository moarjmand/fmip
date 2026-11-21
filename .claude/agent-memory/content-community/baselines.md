---
name: baselines
description: Normal figures for the content watch (2026-11-06) and ruled-out false alarms
metadata:
  type: project
---

- 2026-11-06: 336 active sources (324 aggregated en, 5 rss fa, 3 rss en, 2 de, 1 pt, 1 aggregator); ~312 fetches/24h from 12 sources; ~1035 articles/24h; Yahoo Sports ~34% share, Khabar Varzeshi ~10%, kicker ~10%.
- Seven direct feeds lack an image licence record: known since 2026-11-01, accepted gap (no images shown), not a breach.
- Moderation queue empty, no decisions in 30 days (community still small).
- The first browser tab ("seed") refused navigation to /fa/news; open a new tab with tabs_create instead.
- Khabar Varzeshi headline lacking a number (AFC fine) is the source's own title, not ours; the real issue is dir=auto with a leading Latin word.
- 2026-11-12: 346 active sources (334 aggregated en); 312 fetches/24h; ~910 articles/24h; Yahoo Sports 33.4% (logged as cnt-2026-11-12-01, status decide). Queue still empty. /en and /fa top 30 clean.
- 2026-11-14: 352 active sources (341 aggregated en); 312 fetches/24h from 12 sources, 712 items written; Yahoo Sports 32.0%. Queue empty, no decisions. /en and /fa top 30 clean (all football, fa all Persian, dir=auto on every headline).
- 2026-11-16: 354 active sources; 312 ok fetches, 711 items; Yahoo 27.6%; queue empty. /fa clean; /en had 3 non-football (Tendulkar cricket, I'm a Celeb, Russell Brand) -> cnt-2026-11-16-01. Rooney-in-jungle headline judged borderline football.
- 2026-11-15: 353 active sources (342 aggregated en); 311 ok + 1 failed fetch/24h, 686 items; Yahoo Sports 26.2%. Queue empty. /en and /fa top 30 clean.
- 2026-11-17: 352 active sources (344 aggregated en); 310 ok + 2 failed fetches (one source, not all-day), 883 items; Yahoo 30.0%; queue empty, no decisions. /fa top 30 clean. /en: one borderline item (high-school field hockey/soccer vote) -> cnt-2026-11-17-01. Yahoo share fluctuates 26-33%.
- 2026-11-18: 363 active sources; 311 ok + 1 failed fetch, 780 items; Yahoo 31.0%; queue empty. /fa clean. /en: Beckham fragrance lawsuit x2 (non-football) -> cnt-2026-11-18-01.
- 2026-11-19: 363 active sources; 310 ok + 2 partial (one source), 545 items; Yahoo 22.4%; queue empty. /en and /fa top 30 clean (GTA football easter eggs, Leicester sponsor = football-related).
- 2026-11-20: 362 active sources (353 aggregated en); 312 ok fetches, 766 items; Yahoo 31.7% (cnt-2026-11-12-01 re-logged, decide); queue empty, no decisions. /en and /fa top 30 clean. The hidden-pane tab-2 hung on /fa/news; a fresh foreground tab (tabs_create foreground:true) worked.
