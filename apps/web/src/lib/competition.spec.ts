import type { SeasonFixture } from '@fmip/contracts';
import { LEAGUE_ZONE_KINDS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  competitionQuery,
  fixtureLine,
  formLine,
  formatFixtureDate,
  leadersHref,
  readMinMinutesParam,
  readSeasonParam,
  seasonHref,
  ZONE_KEY,
  ZONE_MARK,
  zoneBand,
  zonesAbsentLine,
} from './competition';
import { t } from '@/i18n/messages';

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

describe('the minutes floor on the leaders (T-824)', () => {
  it('reads a whole number of minutes and drops anything else', () => {
    expect(readMinMinutesParam({})).toBeNull();
    expect(readMinMinutesParam({ min_minutes: '900' })).toBe(900);
    expect(readMinMinutesParam({ min_minutes: ['450', '900'] })).toBe(450);
    expect(readMinMinutesParam({ min_minutes: '0' })).toBeNull();
    expect(readMinMinutesParam({ min_minutes: '-5' })).toBeNull();
    expect(readMinMinutesParam({ min_minutes: '12.5' })).toBeNull();
    expect(readMinMinutesParam({ min_minutes: '10001' })).toBeNull();
  });

  it('puts the floor in the URL, keeping an older season', () => {
    expect(competitionQuery(null, 900)).toBe('?min_minutes=900');
    expect(competitionQuery(ID, 900)).toBe(`?season=${ID}&min_minutes=900`);
    expect(leadersHref('en', 'c1', { id: ID, is_current: true }, 450)).toBe(
      '/en/competition/c1?min_minutes=450#leaders',
    );
    expect(leadersHref('en', 'c1', { id: ID, is_current: false }, null)).toBe(
      `/en/competition/c1?season=${ID}#leaders`,
    );
  });
});

describe('labels', () => {
  it('names a fixture with the score once there is one, short names first', () => {
    expect(fixtureLine('en', fixture())).toBe('ALP 3–1 Test Beta');
    expect(fixtureLine('en', fixture({ score: null, status: 'scheduled' }))).toBe(
      'ALP v Test Beta',
    );
  });

  it('writes a fixture in Persian with Persian digits, the score kept left to right (T-1304)', () => {
    expect(fixtureLine('fa', fixture())).toBe('ALP \u2066۳–۱\u2069 Test Beta');
    expect(fixtureLine('fa', fixture({ score: null, status: 'scheduled' }))).toBe(
      'ALP - Test Beta',
    );
    expect(formLine('fa', ['W', 'D', 'L'])).toBe('ب م ش');
  });

  it('spells out the form run and the kick-off in the viewer zone', () => {
    expect(formLine('en', ['W', 'D', 'L'])).toBe('W D L');
    expect(formLine('en', [])).toBe('');
    expect(formatFixtureDate('en', '2025-09-01T15:00:00.000Z', 'Asia/Tehran')).toBe(
      'Mon, 1 Sept 2025, 18:30',
    );
    // The same instant in Spanish: the weekday and the month are Spanish and
    // the clock is the same digits.
    expect(formatFixtureDate('es', '2025-09-01T15:00:00.000Z', 'Asia/Tehran')).toMatch(
      /^lun.*sept?.*18:30$/,
    );
  });
});

describe('league zones (T-1167)', () => {
  it('names and marks every kind, with a token colour class', () => {
    for (const kind of LEAGUE_ZONE_KINDS) {
      expect(t('en', ZONE_KEY[kind])).toBeTruthy();
      expect(ZONE_MARK[kind]).toMatch(/^border-s-(accent|strong|warning|danger)$/);
    }
  });
  it('reads a band', () => {
    expect(zoneBand('en', { kind: 'relegation', from: 18, to: 20 })).toBe('18–20');
    expect(zoneBand('en', { kind: 'relegation_playoff', from: 16, to: 16 })).toBe('16');
    expect(zoneBand('fa', { kind: 'relegation_playoff', from: 16, to: 16 })).toBe('۱۶');
  });
  it('says why a league shows none, and says nothing for a cup', () => {
    expect(zonesAbsentLine('en', { state: 'not_listed', reason: 'season_not_listed' })).toMatch(
      /not listed/,
    );
    expect(zonesAbsentLine('en', { state: 'not_listed', reason: 'not_a_league' })).toBeNull();
  });
});
