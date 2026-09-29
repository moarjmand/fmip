import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type LeagueZoneEntry,
  leagueZoneProblems,
  leagueZonesFor,
  zoneOfPlace,
} from './league-zones';

/** The committed list (T-1167, D-171), read the way the API reads it. */
const LIST = JSON.parse(
  readFileSync(join(__dirname, '..', 'zones', 'league-zones.json'), 'utf8'),
) as LeagueZoneEntry[];

const entry = (over: Partial<LeagueZoneEntry> = {}): LeagueZoneEntry => ({
  division: 'E0',
  season: '2025/26',
  teams: 20,
  zones: [
    { kind: 'champions_league', from: 1, to: 4 },
    { kind: 'relegation', from: 18, to: 20 },
  ],
  complete: true,
  sources: ['https://example.org/rules'],
  ...over,
});

describe('the committed league-zone list', () => {
  it('is sound: no place past the table, no overlap, every entry sourced', () => {
    expect(LIST.length).toBeGreaterThan(0);
    expect(leagueZoneProblems(LIST)).toEqual([]);
  });
});

describe('leagueZoneProblems', () => {
  it('fails a listed place count that exceeds the table size', () => {
    const problems = leagueZoneProblems([
      entry({ teams: 18, zones: [{ kind: 'relegation', from: 18, to: 20 }] }),
    ]);
    expect(problems).toEqual(['E0 2025/26: relegation reaches place 20 of a 18-club table']);
  });

  it('fails overlapping bands, a band upside down, a repeat and a plain-http source', () => {
    const problems = leagueZoneProblems([
      entry({
        zones: [
          { kind: 'champions_league', from: 1, to: 4 },
          { kind: 'relegation_playoff', from: 4, to: 4 },
          { kind: 'relegation', from: 20, to: 18 },
        ],
      }),
      entry({ sources: ['http://example.org'] }),
    ]);
    expect(problems).toContain('E0 2025/26: place 4 is in two zones');
    expect(problems).toContain('E0 2025/26: relegation 20-18 is not a band');
    expect(problems).toContain('E0 2025/26: listed twice');
    expect(problems).toContain('E0 2025/26: source http://example.org is not https');
  });

  it('passes a sound entry', () => {
    expect(leagueZoneProblems([entry()])).toEqual([]);
  });
});

describe('leagueZonesFor', () => {
  const list = [entry()];
  it('lists a known season of a league', () => {
    const z = leagueZonesFor(list, { kind: 'league', division: 'E0' }, '2025/26');
    expect(z.state).toBe('listed');
  });
  it('says why there are none (rule 3)', () => {
    expect(leagueZonesFor(list, { kind: 'cup', division: 'E0' }, '2025/26')).toEqual({
      state: 'not_listed',
      reason: 'not_a_league',
    });
    expect(leagueZonesFor(list, { kind: 'league', division: null }, '2025/26')).toEqual({
      state: 'not_listed',
      reason: 'no_division',
    });
    expect(leagueZonesFor(list, { kind: 'league', division: 'E0' }, '2023/24')).toEqual({
      state: 'not_listed',
      reason: 'season_not_listed',
    });
  });
  it('finds the zone of a place', () => {
    expect(zoneOfPlace(entry().zones, 3)?.kind).toBe('champions_league');
    expect(zoneOfPlace(entry().zones, 10)).toBeNull();
  });
});
