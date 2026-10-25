import type { PlayerMatch, PlayerSeasonRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  availabilityStale,
  ageOn,
  appearances,
  filterMatches,
  filterRecord,
  minutesText,
  readSeasonFilter,
  roleLabel,
  seasonLabelOf,
  seasonsOf,
  spellPeriod,
} from './player';
import { afterTimeNote } from './team';

const ID_A = '00000000-0000-4000-8000-000000000301';
const ID_B = '00000000-0000-4000-8000-000000000302';
// The cup's own 2025/26: every competition has a season of its own (T-1565).
const ID_C = '00000000-0000-4000-8000-000000000303';
const LABEL: Record<string, string> = { [ID_A]: '2024/25', [ID_B]: '2025/26', [ID_C]: '2025/26' };

const row = (seasonId: string, competition: string): PlayerSeasonRecord => ({
  season: { id: seasonId, label: LABEL[seasonId] ?? 'S' },
  competition: { id: competition, name: competition, short_name: null },
  team: { id: 't', name: 'T' },
  starts: 3,
  sub_appearances: 2,
  goals: 1,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
  minutes: {
    coverage: 'available',
    total: 270,
    matches: 5,
    matches_with_minutes: 5,
    supplied_minutes: 270,
  },
});

const match = (seasonId: string, role: PlayerMatch['role'], cameOn = false): PlayerMatch => ({
  fixture: {
    id: `f-${seasonId}-${role}`,
    kickoff_at: '2025-09-01T15:00:00.000Z',
    status: 'finished',
    round: null,
    stage: null,
    competition: { id: 'c', name: 'C', short_name: null },
    season: { id: seasonId, label: LABEL[seasonId] ?? 'S' },
    home: { id: 'a', name: 'A', short_name: null },
    away: { id: 'b', name: 'B', short_name: null },
    score: { home: 1, away: 0 },
    after_extra_time: false,
    penalties: null,
  },
  team: { id: 'a', name: 'A' },
  role,
  came_on: cameOn,
  goals: 0,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
  expected_goals: null,
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
    expect(spellPeriod('en', { start_date: '2022-07-01', end_date: '2025-06-30' })).toBe(
      'Jul 2022 – Jun 2025',
    );
    expect(spellPeriod('en', { start_date: '2025-07-01', end_date: null })).toBe(
      'Jul 2025 – present',
    );
    // "present" is a word and stays English until T-151's catalogue reaches
    // it; the months are dates and change now.
    expect(spellPeriod('de', { start_date: '2025-07-01', end_date: null })).toBe(
      'Juli 2025 – present',
    );
  });

  it('sums appearances and names the role', () => {
    expect(appearances({ starts: 3, sub_appearances: 2 })).toBe(5);
    expect(roleLabel('en', { role: 'starter', came_on: false })).toBe('Started');
    expect(roleLabel('en', { role: 'bench', came_on: true })).toBe('Came on');
    expect(roleLabel('en', { role: 'bench', came_on: false })).toBe('Unused sub');
  });
});

describe('season selector', () => {
  const record = [row(ID_B, 'league'), row(ID_C, 'cup'), row(ID_A, 'league')];
  const matches = [match(ID_B, 'starter'), match(ID_C, 'bench', true), match(ID_A, 'starter')];

  it('reads the filter and lists each season once by its label, in record order (T-1565)', () => {
    expect(readSeasonFilter({})).toBeNull();
    expect(readSeasonFilter({ season: 'all' })).toBeNull();
    expect(readSeasonFilter({ season: ID_A.toUpperCase() })).toBe(ID_A);
    // The league's and the cup's 2025/26 are one season to the reader.
    expect(seasonsOf(record)).toEqual([
      { id: ID_B, label: '2025/26' },
      { id: ID_A, label: '2024/25' },
    ]);
  });

  it('turns either competition’s id into the season’s label, or none for an unknown one', () => {
    expect(seasonLabelOf(record, matches, ID_C)).toBe('2025/26');
    expect(seasonLabelOf([], matches, ID_C)).toBe('2025/26');
    expect(seasonLabelOf(record, matches, '00000000-0000-4000-8000-000000000399')).toBeNull();
    expect(seasonLabelOf(record, matches, null)).toBeNull();
  });

  it('filters the record and the matches by the label, every competition in it, or keeps everything', () => {
    expect(filterRecord(record, null)).toHaveLength(3);
    expect(filterRecord(record, '2025/26').map((r) => r.competition.id)).toEqual(['league', 'cup']);
    expect(filterRecord(record, '2024/25').map((r) => r.competition.id)).toEqual(['league']);
    expect(filterMatches(matches, '2025/26').map((m) => m.role)).toEqual(['starter', 'bench']);
    expect(filterMatches(matches, null)).toHaveLength(3);
  });
});

describe('the match log after extra time (T-822)', () => {
  it("says aet and the shoot-out from the player's own team's side", () => {
    const base = match(ID_A, 'starter');
    const m: PlayerMatch = {
      ...base,
      team: { id: 'b', name: 'B' },
      fixture: {
        ...base.fixture,
        score: { home: 2, away: 2 },
        after_extra_time: true,
        penalties: { home: 3, away: 4 },
      },
    };
    // The player played for the away side, which won the shoot-out.
    expect(afterTimeNote('en', m.fixture, m.team.id)).toBe('aet, won 4–3 on penalties');
    expect(afterTimeNote('en', base.fixture, base.team.id)).toBeNull();
  });
});

describe('minutesText (T-823)', () => {
  const m = (coverage: 'available' | 'limited' | 'not_supplied', withMinutes: number) => ({
    coverage,
    total: coverage === 'available' ? 270 : null,
    matches: 5,
    matches_with_minutes: withMinutes,
    supplied_minutes: withMinutes === 0 ? 0 : 200,
  });

  it('shows the total only when it is whole', () => {
    expect(minutesText('en', m('available', 5))).toEqual({ text: '270', note: null });
  });

  it('shows a partial season as "at least", with the matches it covers', () => {
    expect(minutesText('en', m('limited', 4))).toEqual({
      text: 'at least 200',
      note: '4 of 5 matches',
    });
  });

  it('says not supplied when the feed sent none', () => {
    expect(minutesText('en', m('not_supplied', 0))).toEqual({ text: 'not supplied', note: null });
  });
});

describe('availabilityStale (T-1007)', () => {
  it('says an answer older than two missed re-asks may have changed', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(availabilityStale('2026-09-29T07:00:00Z', now)).toBe(false);
    expect(availabilityStale('2026-09-29T05:59:00Z', now)).toBe(true);
  });
});
