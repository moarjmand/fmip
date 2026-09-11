import type { SeasonFixture } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  competitionQuery,
  fixtureLine,
  formLine,
  formatFixtureDate,
  readSeasonParam,
  seasonHref,
} from './competition';

const ID = '00000000-0000-4000-8000-000000000302';

const fixture = (over: Partial<SeasonFixture> = {}): SeasonFixture => ({
  id: 'f1',
  kickoff_at: '2025-09-01T15:00:00.000Z',
  status: 'finished',
  round: null,
  stage: null,
  home: { id: 'a', name: 'Test Alpha', short_name: 'ALP' },
  away: { id: 'b', name: 'Test Beta', short_name: null },
  score: { home: 3, away: 1 },
  ...over,
});

describe('season selection', () => {
  it('reads a season id and ignores anything else', () => {
    expect(readSeasonParam({})).toBeNull();
    expect(readSeasonParam({ season: ID.toUpperCase() })).toBe(ID);
    expect(readSeasonParam({ season: ['x', ID] })).toBeNull();
    expect(readSeasonParam({ season: 'latest' })).toBeNull();
  });

  it('links the current season without a parameter and the others with one', () => {
    expect(seasonHref('en', 'c1', { id: ID, is_current: true })).toBe('/en/competition/c1');
    expect(seasonHref('fa', 'c1', { id: ID, is_current: false })).toBe(
      `/fa/competition/c1?season=${ID}`,
    );
    expect(competitionQuery(null)).toBe('');
    expect(competitionQuery(ID)).toBe(`?season=${ID}`);
  });
});

describe('labels', () => {
  it('names a fixture with the score once there is one, short names first', () => {
    expect(fixtureLine(fixture())).toBe('ALP 3–1 Test Beta');
    expect(fixtureLine(fixture({ score: null, status: 'scheduled' }))).toBe('ALP v Test Beta');
  });

  it('spells out the form run and the kick-off in the viewer zone', () => {
    expect(formLine(['W', 'D', 'L'])).toBe('W D L');
    expect(formLine([])).toBe('');
    expect(formatFixtureDate('2025-09-01T15:00:00.000Z', 'Asia/Tehran')).toBe(
      'Mon, 1 Sept 2025, 18:30',
    );
  });
});
