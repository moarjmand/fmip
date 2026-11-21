import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { matchWords } from '@/lib/words-server';
import { LiveClockProvider } from './live-age';
import { MatchCentreView } from './match-centre-view';
import { liveSlots } from './match-live-slots';

vi.mock('./use-hydrated', () => ({ useHydrated: () => true }));

/**
 * The match band's markup for the cases a browser measures (T-1947, finding
 * qa-2026-11-20-01).
 *
 * The E2E build has no API, so no match, and Playwright cannot render a
 * component of ours itself. So this spec renders the real `MatchCentreView`
 * and keeps its band (`<header data-testid="match-header">`) in
 * `tests/e2e/fixtures/match-band/`, and `tests/e2e/scorer-fit.spec.ts` puts
 * those files into the real page, with its production CSS, at phone width.
 * The band measured there is the component's own markup, not a copy written
 * by hand: when the band changes, this spec fails until the files are written
 * again (`pnpm --filter @fmip/web exec vitest run src/components/match-band-fit.spec.tsx -u`),
 * and the browser then measures the new band.
 */

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
});
const goal = (
  minute: number,
  side: 'home' | 'away',
  name: string,
  added: number | null = null,
): MatchIncident => ({
  id: `goal-${minute}-${added ?? 0}`,
  sequence: minute * 10 + (added ?? 0),
  minute,
  added_time: added,
  kind: 'goal',
  side,
  player: { id: `p-${name}`, name },
  related_player: null,
  detail: null,
});

type Sides = { home: string; away: string };
const centre = (
  teams: Sides,
  scores: Partial<MatchCentre['fixture']['scores']>,
  goals: MatchIncident[],
) =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: '2026-11-20T03:00:00.000Z',
      status: 'finished',
      minute: null,
      competition: { id: 'c', name: 'MLS', short_name: null, country_id: null },
      season: { id: 's', label: '2026' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', teams.home),
      away: team('a', teams.away),
      scores: {
        current: { home: 1, away: 1 },
        half_time: { home: 1, away: 0 },
        full_time: { home: 1, away: 1 },
        extra_time: null,
        penalties: null,
        aggregate: null,
        ...scores,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-11-20T06:00:00.000Z',
      freshness: null,
    },
    timeline: { coverage: 'available', last_updated_at: null, data: goals },
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: empty,
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
  }) as MatchCentre;

type Locale = 'en' | 'fa';
// The reported match: Seattle Sounders v Real Salt Lake, 1-1 and 2-4 on
// penalties, as each page names the sides.
const SOUNDERS: Record<Locale, Sides> = {
  en: { home: 'Seattle Sounders', away: 'Real Salt Lake' },
  fa: { home: 'سیاتل ساندرز', away: 'رئال سالت لیک' },
};
const SHOOTOUT = { extra_time: { home: 1, away: 1 }, penalties: { home: 2, away: 4 } };

const CASES: Record<string, (locale: Locale) => MatchCentre> = {
  // As reported: the long line under the score, a scorer a side.
  reported: (locale) =>
    centre(SOUNDERS[locale], SHOOTOUT, [
      goal(36, 'home', 'Albert Rusnák'),
      goal(63, 'away', 'Morgan Guilavogui'),
    ]),
  // The same band with the longest units: three minutes, two scorers a side.
  crowded: (locale) =>
    centre(SOUNDERS[locale], SHOOTOUT, [
      goal(12, 'home', 'Dominic Calvert-Lewin'),
      goal(45, 'home', 'Dominic Calvert-Lewin', 2),
      goal(90, 'home', 'Dominic Calvert-Lewin', 4),
      goal(88, 'home', 'Albert Rusnák'),
      goal(63, 'away', 'Morgan Guilavogui'),
      goal(70, 'away', 'Jean-Ricner Bellegarde'),
    ]),
  // An ordinary result: nothing in it is long, and nothing may be cut or wrapped.
  ordinary: (locale) =>
    centre(
      locale === 'fa' ? { home: 'چلسی', away: 'آرسنال' } : { home: 'Chelsea', away: 'Arsenal' },
      {},
      [goal(36, 'home', 'Nicolas Jackson'), goal(63, 'away', 'Morgan Guilavogui')],
    ),
};

const band = (c: MatchCentre, locale: Locale): string => {
  const words = matchWords(locale);
  const html = renderToStaticMarkup(
    <LiveClockProvider
      value={{ now: undefined, behind: { events: false, stats: false }, drawnAt: undefined }}
    >
      <MatchCentreView
        words={words}
        centre={c}
        timeZone="Europe/London"
        locale={locale}
        now={undefined}
        slots={liveSlots({ centre: c, locale, timeZone: 'Europe/London', words })}
      />
    </LiveClockProvider>,
  );
  const start = html.indexOf('<header');
  return `${html.slice(start, html.indexOf('</header>', start))}</header>\n`;
};

describe('the match band a browser measures (T-1947)', () => {
  for (const [name, build] of Object.entries(CASES))
    for (const locale of ['en', 'fa'] as const)
      it(`${name}, ${locale}: the kept band is the band as drawn`, async () => {
        const html = band(build(locale), locale);
        expect(html).toContain('data-testid="match-header"');
        expect(html).toContain('data-testid="scorers-away"');
        await expect(html).toMatchFileSnapshot(
          fileURLToPath(
            new URL(`../../tests/e2e/fixtures/match-band/${name}-${locale}.txt`, import.meta.url),
          ),
        );
      });

  it('the reported case carries the long line under the score, in Persian digits', () => {
    const html = band(CASES.reported!('fa'), 'fa');
    expect(html).toContain('M. Guilavogui');
    expect(html).toContain('۶۳′');
    expect(html).toContain('data-testid="ninety"');
  });
});
