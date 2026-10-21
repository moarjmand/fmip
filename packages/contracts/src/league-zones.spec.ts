import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leagueZoneProblems } from './league-zones-check';
import {
  type LeagueZoneEntry,
  type ZoneCompetition,
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

  it('keys a league the model does not hold by country, once per season (T-1444, D-234)', () => {
    const byCountry = LIST.filter((e) => e.country !== undefined);
    expect(byCountry.length).toBeGreaterThan(0);
    for (const e of byCountry) {
      expect(e.division, `${e.country} ${e.season}`).toBeUndefined();
      // Every one carries what a reader should know: a split, a place not marked, a source gap.
      expect(e.note, `${e.country} ${e.season}`).toBeTruthy();
    }
  });

  it('marks no place a split league could put in the other half', () => {
    // A club never crosses halves in a split league, so the table summed over
    // every result is only exact at the ends: the champion's place and the last
    // places. No entry may mark a band that straddles a split border.
    const borders: Record<string, number[]> = {
      SCO: [6],
      AUT: [6],
      SUI: [6],
      DEN: [6],
      CZE: [6, 10],
      SRB: [6],
      GRE: [4, 8],
    };
    for (const e of LIST) {
      const split = e.country === undefined ? undefined : borders[e.country];
      if (split === undefined) continue;
      for (const z of e.zones) {
        for (const b of split) {
          expect(
            z.from <= b && z.to > b,
            `${e.country} ${z.kind} ${z.from}-${z.to} crosses ${b}`,
          ).toBe(false);
        }
      }
    }
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

  it('needs exactly one of division and country, and a three-letter country', () => {
    const problems = leagueZoneProblems([
      entry({ country: 'BEL' }),
      entry({ division: undefined, season: '2026/27' }),
      entry({ division: undefined, country: 'Belgium', season: '2027/28' }),
    ]);
    expect(problems).toContain('E0 2025/26: exactly one of division and country is needed');
    expect(problems).toContain('? 2026/27: exactly one of division and country is needed');
    expect(problems).toContain('Belgium 2027/28: country is not a three-letter code');
  });

  it('accepts a Libertadores band', () => {
    expect(
      leagueZoneProblems([
        entry({
          division: undefined,
          country: 'BRA',
          teams: 20,
          zones: [
            { kind: 'copa_libertadores', from: 1, to: 4 },
            { kind: 'relegation', from: 17, to: 20 },
          ],
        }),
      ]),
    ).toEqual([]);
  });
});

describe('leagueZonesFor', () => {
  const list = [entry()];
  it('lists a known season of a league', () => {
    const z = leagueZonesFor(list, { kind: 'league', division: 'E0' }, '2025/26');
    expect(z.state).toBe('listed');
  });
  it('finds a league by its country when its division finds nothing (D-234)', () => {
    const byCountry = [entry({ division: undefined, country: 'BEL', season: '2026/27' })];
    const league = (over: Partial<ZoneCompetition>): ZoneCompetition => ({
      kind: 'league',
      division: null,
      country: 'BEL',
      tier: 1,
      ...over,
    });
    expect(leagueZonesFor(byCountry, league({}), '2026/27').state).toBe('listed');
    // A tier not recorded is read as the top flight; any other tier is not.
    expect(leagueZonesFor(byCountry, league({ tier: null }), '2026/27').state).toBe('listed');
    expect(leagueZonesFor(byCountry, league({ tier: 2 }), '2026/27')).toEqual({
      state: 'not_listed',
      reason: 'no_division',
    });
    // Another country, another season, or a competition that is not a senior men's league.
    expect(leagueZonesFor(byCountry, league({ country: 'NED' }), '2026/27').state).toBe(
      'not_listed',
    );
    expect(leagueZonesFor(byCountry, league({ country: null }), '2026/27')).toEqual({
      state: 'not_listed',
      reason: 'no_division',
    });
    expect(leagueZonesFor(byCountry, league({}), '2025/26')).toEqual({
      state: 'not_listed',
      reason: 'season_not_listed',
    });
    // A country the list never names has no key at all, as a league without a division had.
    expect(leagueZonesFor(byCountry, league({ country: 'NED' }), '2026/27')).toEqual({
      state: 'not_listed',
      reason: 'no_division',
    });
    // A division with an entry wins over the country.
    const both = [entry({ division: 'B1', season: '2026/27', teams: 18, zones: [] }), ...byCountry];
    expect(leagueZonesFor(both, league({ division: 'B1' }), '2026/27')).toMatchObject({
      teams: 18,
    });
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
