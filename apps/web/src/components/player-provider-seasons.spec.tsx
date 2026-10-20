import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerProviderSeasonLine, PlayerProviderSeasons } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hasKeeperFigures, sentOff, splitProviderLines, yearRuns } from '@/lib/player-provider';
import { ProviderCareerPanel, ProviderSeasonsPanel } from './player-provider-seasons';

/**
 * The player page's provider modules (T-1431, D-223): the provider named as
 * the source, a competition our record counts named beside the table
 * and never shown with the provider's numbers, a missing figure as a dash and
 * never a zero, and what was left out counted.
 */

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function line(over: Partial<PlayerProviderSeasonLine> = {}): PlayerProviderSeasonLine {
  return {
    season: { year: 2026, label: null },
    competition: { id: 'c-cup', name: 'FA Cup', short_name: null },
    team: { id: 't-club', name: 'Liverpool', short_name: null },
    counted_by_us: false,
    appearances: 2,
    starts: 2,
    minutes: 180,
    goals: 1,
    assists: null,
    yellow_cards: 0,
    second_yellow_cards: 0,
    red_cards: 0,
    saves: null,
    goals_conceded: null,
    rating: 7.25,
    ...over,
  };
}

const ours = line({
  competition: { id: 'c-pl', name: 'Premier League', short_name: 'PL' },
  counted_by_us: true,
  appearances: 9,
  goals: 6,
});

function data(over: Partial<PlayerProviderSeasons> = {}): PlayerProviderSeasons {
  return {
    source_name: 'API-Football',
    seasons: {
      coverage: 'limited',
      last_updated_at: '2026-10-20T06:00:00Z',
      data: { lines: [line(), ours], unlisted: 2 },
    },
    career: {
      coverage: 'available',
      last_updated_at: '2026-10-18T06:00:00Z',
      data: {
        unlisted: 0,
        teams: [
          {
            team: { id: 't-club', name: 'Liverpool', short_name: null },
            season_years: [2026, 2025, 2024, 2017],
          },
          { team: { id: 't-old', name: 'Roma', short_name: null }, season_years: [2016] },
        ],
      },
    },
    ...over,
  };
}

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('the provider helpers (T-1431)', () => {
  it('shows only what our record does not count, and names the rest', () => {
    expect(splitProviderLines([line(), ours])).toEqual({ shown: [line()], ours: ['PL'] });
  });

  it('adds a straight red and a second yellow only when both are known', () => {
    expect(sentOff(line({ red_cards: 1, second_yellow_cards: 1 }))).toBe(2);
    expect(sentOff(line({ red_cards: null }))).toBeNull();
    expect(sentOff(line({ second_yellow_cards: null }))).toBeNull();
  });

  it('shows the goalkeeper columns only when a line has them', () => {
    expect(hasKeeperFigures([line()])).toBe(false);
    expect(hasKeeperFigures([line({ saves: 40, goals_conceded: 12 })])).toBe(true);
  });

  it('runs the season years together, newest first, in the reader digits', () => {
    expect(yearRuns('en', [2017, 2026, 2024, 2025, 2025])).toEqual(['2024–2026', '2017']);
    expect(yearRuns('fa', [2016])).toEqual(['۲۰۱۶']);
  });
});

describe('the provider seasons panel (T-1431)', () => {
  it('names the source, the season and the fetch, and keeps our competitions out of the table', () => {
    const html = render(<ProviderSeasonsPanel data={data()} locale="en" timeZone="UTC" />);
    expect(html).toContain('Every competition, as API-Football counts it');
    expect(html).toContain('Season starting 2026');
    expect(html.match(/data-testid="provider-line"/g)).toHaveLength(1);
    expect(html).toContain('FA Cup');
    expect(html).not.toContain('>PL<');
    expect(html).toContain('Also this season, in our own record from the matches: PL.');
    expect(html).toContain('lists 2 competitions or teams that are not in our catalogue');
    expect(html).toContain('Fetched from API-Football');
    expect(html).toContain('data-coverage-badge="limited"');
  });

  it('shows a missing figure as a dash, never a zero', () => {
    const html = render(<ProviderSeasonsPanel data={data()} locale="en" timeZone="UTC" />);
    expect(html).toContain('data-supplied="false"><span class="text-muted">–</span>');
    expect(html).toContain('A dash is a figure API-Football did not supply, not a zero.');
  });

  it('says so when the provider was never asked, or every competition is ours', () => {
    const never = data({
      seasons: { coverage: 'not_supplied', last_updated_at: null, data: null },
    });
    const asked = render(<ProviderSeasonsPanel data={never} locale="en" timeZone="UTC" />);
    expect(asked).toContain('API-Football has not been asked about this player yet.');
    expect(asked).not.toContain('provider-fetched');
    const onlyOurs = data({
      seasons: {
        coverage: 'available',
        last_updated_at: '2026-10-20T06:00:00Z',
        data: { lines: [ours], unlisted: 0 },
      },
    });
    expect(render(<ProviderSeasonsPanel data={onlyOurs} locale="en" timeZone="UTC" />)).toContain(
      'Every competition API-Football lists this season is counted in our own record from the matches',
    );
  });

  it('is in Persian on /fa', () => {
    const html = render(<ProviderSeasonsPanel data={data()} locale="fa" timeZone="Asia/Tehran" />);
    expect(html).toContain('همه‌ی رقابت‌ها، به شمارش API-Football');
    expect(html).toContain('۱۸۰');
  });
});

describe('the provider career panel (T-1431)', () => {
  it('lists each team with its seasons run together', () => {
    const html = render(<ProviderCareerPanel data={data()} locale="en" timeZone="UTC" />);
    expect(html).toContain('Career, as API-Football lists it');
    expect(html.match(/data-testid="provider-career-team"/g)).toHaveLength(2);
    expect(html).toContain('2024–2026, 2017');
  });

  it('says so when the provider was never asked', () => {
    const never = data({ career: { coverage: 'not_supplied', last_updated_at: null, data: null } });
    expect(render(<ProviderCareerPanel data={never} locale="en" timeZone="UTC" />)).toContain(
      'API-Football has not been asked about this player yet.',
    );
  });
});

describe('the provider modules are RTL-safe', () => {
  it('use no physical left or right', () => {
    const source = readFileSync(join(__dirname, 'player-provider-seasons.tsx'), 'utf8');
    expect(PHYSICAL.test(source)).toBe(false);
  });
});
