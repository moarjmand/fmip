---
name: review-checks-false-alarms
description: Known false FLAGs from review-checks.sh, my own past false finding (x-rtl), and durable facts for load and cache-key judgements
metadata:
  type: reference
---

- `provider-leak` FLAG on `source: 'highlightly'` in web specs (player_expected_goals fixtures) is a false alarm:
  `ExpectedGoalsSource` is part of the contract (`packages/contracts/src/match-centre.ts`, rule 6 names the
  source on every xG figure). Seen again on PR #889, 2026-11-13.
- Load judgements: the production web container is a single Node process (`CMD node apps/web/server.js`,
  no replicas, `deploy/docker-compose.prod.yml` service `web`). Server renders do not spread over cores;
  "N cores" estimates in plans do not apply. Re-check the compose file before relying on this.
- Server actions (`'use server'`) in this repo: `refreshCompetitionsMenu` (D-301) and `refreshLiveModules`
  (D-409). The live one shares only in-flight API reads, not renders (as of PR #889).
- `isLocale()` accepts the pseudo-locale `x-rtl` (`LOCALES` includes `PSEUDO_LOCALES`, `i18n/locales.ts`). I wrongly
  flagged the opposite on PR #889 round 1; check the array before claiming a locale is refused.
- `isTimeZone()` (`lib/scores.ts`) accepts anything Node's Intl accepts: any letter case, aliases (`GB`), offsets
  (`+03:30`). Any cache key built from a raw zone is unbounded unless canonicalised via `resolvedOptions().timeZone`.
- apps/web has no DOM test environment (no jsdom/happy-dom/testing-library, no `hydrateRoot`): web specs render with
  `renderToStaticMarkup` only, so a hydration fix cannot be proven by a unit spec; only E2E on a production build can
  (none watched React error 418 as of 2026-11-14). `use-hydrated.ts` (useSyncExternalStore, server snapshot false) exists since PR #889.
- MatchCentre module `last_updated_at` stamps all come from `Date.toISOString()` in the API (fixed 24-char UTC, ms;
  `fixtures/internal/match-centre-store.ts`, `covered.ts`), so they compare correctly as strings; null maps to ''.
  Statistics upserts are per-row autocommit (`ingest-store.ts` saveStatistics), so the max stamp is monotonic in practice.
- The locale proxy does not run on `/api/*` (`proxy.ts` matcher), so a reader can send `x-fmip-locale` there themselves;
  it is harmless only when the API path already carries `locale=`.
- **provider-leak FLAG on `'api_football'` in an API DB spec's coverage seed** (`INSERT ... coverage ... source`): test data in a spec, not API output (PR #895).
