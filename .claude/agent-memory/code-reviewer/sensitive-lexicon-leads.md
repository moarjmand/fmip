---
name: sensitive-lexicon-leads
description: How to probe the social-post sensitive-topic lexicon (D-427) for misses and football false positives, incl. team/country names
metadata:
  type: project
---

The social-publishing lexicon (`internal/social-rules.ts`, `sensitivity(headlines)`) runs on headlines linked to the
fixture's teams, never on the card text. Probe it with a scratch vitest file of real-shaped headlines (see
[[review-toolbox]]), both ways:

- misses: tragedy/violence/politics headlines (round 1 of PR #893 found "passes away", "stabbed", "homophobic" missing);
- false positives: a country word alone catches the national team's own headlines ("Iran beat Qatar" -> politics,
  "Iranian giants Persepolis"); idioms "violent conduct", "arrest the slump", "title assault", "run riot", "hospital
  pass", "pays tribute", "killed the game".

The coordinator (2026-11-16) wanted Iran mentions to reach a person only from headlines/free text, never because a
card is about an Iranian team; left as a maintainer decision (rev-2026-11-16-01).

**Why:** over-matching is "safe" but mislabels results and starves a kind's automation. **How to apply:** any change
to the lexicon or to what `sensitivity` receives.
