import type { PlayerMatch, PlayerSeasonRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  appearances,
  filterMatches,
  filterRecord,
  readSeasonFilter,
  roleLabel,
  seasonsOf,
  spellPeriod,
} from './player';

const ID_A = '00000000-0000-4000-8000-000000000301';
const ID_B = '00000000-0000-4000-8000-000000000302';

const row = (seasonId: string, competition: string): PlayerSeasonRecord => ({
  season: { id: seasonId, label: seasonId === ID_A ? '2024/25' : '2025/26' },
  competition: { id: competition, name: competition, short_name: null },
  team: { id: 't', name: 'T' },
  starts: 3,
  sub_appearances: 2,
  goals: 1,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
});

const match = (seasonId: string, role: PlayerMatch['role'], cameOn = false): PlayerMatch => ({
  fixture: {
    id: `f-${seasonId}-${role}`,
    kickoff_at: '2025-09-01T15:00:00.000Z',
    status: 'finished',
    round: null,
    stage: null,
    competition: { id: 'c', name: 'C', short_name: null },
    season: { id: seasonId, label: 'S' },
    home: { id: 'a', name: 'A', short_name: null },
    away: { id: 'b', name: 'B', short_name: null },
    score: { home: 1, away: 0 },
  },
  team: { id: 'a', name: 'A' },
  role,
  came_on: cameOn,
  goals: 0,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
});

describe('ageOn', () => {
  it('counts whole years, birthday not yet reached this year excluded', () => {
    expect(ageOn('2000-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(25);
    expect(ageOn('2000-02-29', new Date('2026-03-01T12:00:00Z'))).toBe(26);
    expect(ageOn('2000-09-12', new Date('2026-09-12T00:00:00Z'))).toBe(26);
    expect(ageOn(null, new Date())).toBeNull();
  });
});

describe('labels', () => {
  it('names a spell period', () => {
    expect(spellPeriod({ start_date: '2022-07-01', end_date: '2025-06-30' })).toBe(
      'Jul 2022 – Jun 2025',
    );
    expect(spellPeriod({ start_date: '2025-07-01', end_date: null })).toBe('Jul 2025 – present');
  });

  it('sums appearances and names the role', () => {
    expect(appearances({ starts: 3, sub_appearances: 2 })).toBe(5);
    expect(roleLabel({ role: 'starter', came_on: false })).toBe('Started');
    expect(roleLabel({ role: 'bench', came_on: true })).toBe('Came on');
    expect(roleLabel({ role: 'bench', came_on: false })).toBe('Unused sub');
  });
});

describe('season selector', () => {
  const record = [row(ID_B, 'league'), row(ID_B, 'cup'), row(ID_A, 'league')];
  const matches = [match(ID_B, 'starter'), match(ID_A, 'bench', true)];

  it('reads the filter and lists each season once in record order', () => {
    expect(readSeasonFilter({})).toBeNull();
    expect(readSeasonFilter({ season: 'all' })).toBeNull();
    expect(readSeasonFilter({ season: ID_A.toUpperCase() })).toBe(ID_A);
    expect(seasonsOf(record)).toEqual([
      { id: ID_B, label: '2025/26' },
      { id: ID_A, label: '2024/25' },
    ]);
  });

  it('filters the record and the matches, or keeps everything', () => {
    expect(filterRecord(record, null)).toHaveLength(3);
    expect(filterRecord(record, ID_A).map((r) => r.competition.id)).toEqual(['league']);
    expect(filterMatches(matches, ID_B).map((m) => m.role)).toEqual(['starter']);
    expect(filterMatches(matches, null)).toHaveLength(2);
  });
});
