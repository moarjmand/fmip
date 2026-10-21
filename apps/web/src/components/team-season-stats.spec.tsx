import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamSeasonStats, TeamSeasonStatsLine } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  latestForm,
  minuteRows,
  readStatsSeason,
  scoreText,
  teamSeasonHref,
} from '@/lib/team-season-stats';
import { TeamSeasonStatsPanel } from './team-season-stats';

/**
 * The team page's season statistics (T-1437, D-228): the provider named as
 * the source, a season never asked or answered empty said so and never shown
 * as zeros, a missing figure as a dash, and goals by minute and penalties
 * withheld with the reason when a shoot-out polluted them.
 */

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const count = (home: number | null, away: number | null) => ({
  home,
  away,
  total: home === null || away === null ? null : home + away,
});

function line(over: Partial<TeamSeasonStatsLine> = {}): TeamSeasonStatsLine {
  return {
    played: count(19, 19),
    wins: count(13, 7),
    draws: count(3, 8),
    losses: count(3, 4),
    goals_for: count(39, 30),
    goals_against: count(24, 26),
    clean_sheets: count(4, 4),
    failed_to_score: count(2, null),
    form: 'LLLLLWDWDWWW',
    goals_for_by_minute: [{ from: 0, to: 15, goals: 9 }],
    goals_against_by_minute: [{ from: 76, to: 90, goals: 15 }],
    bands_withheld: false,
    penalties: { scored: 4, missed: 0 },
    biggest_win: { home: { for: 4, against: 2 }, away: null },
    biggest_defeat: { home: null, away: { for: 0, against: 3 } },
    longest_run: { wins: 4, draws: 3, losses: 1 },
    formations: [{ formation: '4-2-3-1', played: 20 }],
    ...over,
  };
}

const LEAGUE = {
  season_id: 's-league',
  label: '2026/27',
  is_current: true,
  competition: { id: 'c-pl', name: 'Premier League', short_name: 'PL' },
};
const CUP = {
  season_id: 's-cup',
  label: '2024/25',
  is_current: false,
  competition: { id: 'c-fa', name: 'FA Cup', short_name: null },
};

function data(over: Partial<TeamSeasonStats> = {}): TeamSeasonStats {
  return {
    source_name: 'API-Football',
    seasons: [LEAGUE, CUP],
    selected: LEAGUE,
    asked: true,
    stats: { coverage: 'limited', last_updated_at: '2026-10-21T10:00:00.000Z', data: line() },
    ...over,
  };
}

const render = (d: TeamSeasonStats, locale = 'en') =>
  renderToStaticMarkup(
    <TeamSeasonStatsPanel data={d} teamId="t-1" locale={locale} timeZone="UTC" />,
  );

describe('the helpers (T-1437)', () => {
  it('keeps the latest ten results, oldest first', () => {
    expect(latestForm('LLLLLWDWDWWW')).toEqual(['L', 'L', 'L', 'W', 'D', 'W', 'D', 'W', 'W', 'W']);
    expect(latestForm(null)).toEqual([]);
  });

  it('joins both sides by band, in minute order, with bars against the busiest', () => {
    expect(
      minuteRows(
        [{ from: 16, to: 30, goals: 2 }],
        [
          { from: 0, to: 15, goals: 4 },
          { from: 16, to: 30, goals: 1 },
        ],
      ),
    ).toEqual([
      { from: 0, to: 15, scored: 0, conceded: 4, scoredWidth: 0, concededWidth: 100 },
      { from: 16, to: 30, scored: 2, conceded: 1, scoredWidth: 50, concededWidth: 25 },
    ]);
    expect(minuteRows(null, null)).toEqual([]);
  });

  it('writes a score the team’s goals first, in the reader’s digits', () => {
    expect(scoreText('en', { for: 4, against: 1 })).toBe('4–1');
    expect(scoreText('fa', { for: 4, against: 1 })).toBe('۴–۱');
    expect(scoreText('en', null)).toBeNull();
  });

  it('reads and writes the season on the address', () => {
    expect(teamSeasonHref('en', 't-1', 's-cup')).toBe('/en/team/t-1?tab=stats&season=s-cup');
    expect(readStatsSeason({ season: 's-cup' })).toBe('s-cup');
    expect(readStatsSeason({ season: ['a', 'b'] })).toBe('a');
    expect(readStatsSeason({})).toBeNull();
  });
});

describe('TeamSeasonStatsPanel (T-1437)', () => {
  it('names the source, the season, the figures and when they were fetched', () => {
    const html = render(data());
    expect(html).toContain('Season statistics, as API-Football counts them');
    expect(html).toContain('PL 2026/27');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/en/team/t-1?tab=stats&amp;season=s-cup"');
    expect(html).toContain('Fetched from API-Football');
    expect(html.match(/data-testid="season-stat-tile"/g)).toHaveLength(8);
    expect(html).toContain('Home 39 · Away 30');
    // Failed to score away was not supplied: a dash, never a zero.
    expect(html).toContain('Home 2 · Away –');
    expect(html).toContain('4–2');
    expect(html).toContain('0–3');
    expect(html).toContain('4-2-3-1');
    expect(html.match(/data-testid="season-stats-band"/g)).toHaveLength(2);
  });

  it('withholds goals by minute and penalties with the reason', () => {
    const html = render(
      data({
        stats: {
          coverage: 'limited',
          last_updated_at: '2026-10-21T10:00:00.000Z',
          data: line({
            bands_withheld: true,
            goals_for_by_minute: null,
            goals_against_by_minute: null,
            penalties: { scored: null, missed: null },
          }),
        },
      }),
    );
    expect(html).toContain('data-testid="season-stats-withheld"');
    expect(html).toContain('penalty shoot-out');
    expect(html).not.toContain('data-testid="season-stats-band"');
    expect(html).not.toContain('>Penalties<');
  });

  it('says the season was never asked about, or answered empty, and shows no figure', () => {
    const notAsked = render(
      data({
        seasons: [],
        asked: false,
        stats: { coverage: 'not_supplied', last_updated_at: null, data: null },
      }),
    );
    expect(notAsked).toContain('API-Football has not been asked');
    expect(notAsked).not.toContain('season-stat-tile');
    expect(notAsked).not.toContain('Fetched from');
    const empty = render(
      data({
        selected: CUP,
        stats: {
          coverage: 'not_supplied',
          last_updated_at: '2026-10-21T10:00:00.000Z',
          data: null,
        },
      }),
    );
    expect(empty).toContain('API-Football has no statistics');
    expect(empty).toContain('FA Cup 2024/25');
  });

  it('says so for a team with no season at all', () => {
    const html = render(
      data({
        seasons: [],
        selected: null,
        asked: false,
        stats: { coverage: 'not_supplied', last_updated_at: null, data: null },
      }),
    );
    expect(html).toContain('This team has played no match we hold');
  });

  it('reads in Persian, digits and all', () => {
    const html = render(data(), 'fa');
    expect(html).toContain('آمار فصل، به شمارش API-Football');
    expect(html).toContain('۴–۲');
  });

  it('uses logical properties only', () => {
    const source = readFileSync(join(__dirname, 'team-season-stats.tsx'), 'utf8');
    expect(PHYSICAL.test(source)).toBe(false);
  });
});
