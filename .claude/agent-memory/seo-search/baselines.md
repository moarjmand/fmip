---
name: baselines
description: SEO baselines and ruled-out false alarms as of 2026-11-16
metadata:
  type: project
---
- Sitemap 8550 urls (8440 team, 98 competition), flat since 2026-11-01; log at E:/FMIP/ops/sitemap-count.log.
- og:image fixed by 2026-11-16: all 12 checked pages have it (brand-card.png, team card.png, match card). Do not re-raise.
- Match description still carries raw ISO kick-off (en 162 chars) as of 2026-11-16 (seo-2026-11-09-02 open).
- Not a finding: team title "'s Gravenwezel-Schilde" (real club name); match SportsEvent without location (rule 3); /en/model-accuracy no JSON-LD.
- /en/news is slowest (~0.9 s on 11-16, limit 1.5 s).
- WebSearch never shows the site by name or match page (11-09, 11-16); site: operator is ignored by it. Indexing needs Search Console (maintainer's).
- Marketing priority 3: spelling variants; half-space tested 11-16, Arabic ي/ك still to test.
