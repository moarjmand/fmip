import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leagueZoneProblems } from './league-zones-check';
import {
  DEFAULT_RANKING,
  type LeagueZoneEntry,
  type ZoneCompetition,
  leagueRankingFor,
  leagueZonesFor,
  zoneOfPlace,
  zonesOfTable,
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

  it('gives every note its Persian, and no Persian without a note (T-1557)', () => {
    for (const e of LIST) {
      const key = `${e.division ?? e.country} ${e.season}`;
      expect(e.note_fa === undefined, key).toBe(e.note === undefined);
      // Persian letters, not the English note copied over.
      if (e.note_fa !== undefined) expect(e.note_fa, key).toMatch(/[؀-ۿ]/);
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

  it('accepts a band for the AFC Champions League before the Elite (T-1659)', () => {
    expect(
      leagueZoneProblems([
        entry({
          division: 'IR1',
          season: '2022/23',
          teams: 16,
          zones: [
            { kind: 'afc_champions_league', from: 1, to: 3 },
            { kind: 'relegation', from: 15, to: 16 },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it('lists each IR1 season under the AFC competition its places went to (T-1659)', () => {
    // The Elite replaced the AFC Champions League from 2024/25, so a league
    // season up to 2022/23 earned places in the old competition and 2023/24
    // onwards in the Elite.
    for (const e of LIST.filter((x) => x.division === 'IR1')) {
      const afc = e.zones.filter((z) => z.kind.startsWith('afc_'));
      const expected =
        e.season >= '2023/24' ? 'afc_champions_league_elite' : 'afc_champions_league';
      for (const z of afc) expect(z.kind, `IR1 ${e.season}`).toBe(expected);
    }
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

describe('a league ranking (T-1674, D-323)', () => {
  const mls = (over: Partial<LeagueZoneEntry> = {}): LeagueZoneEntry =>
    entry({
      division: 'US1',
      season: '2026/27',
      teams: 30,
      zones: [],
      ranking: ['points', 'wins', 'goal_difference', 'goals_for'],
      ...over,
    });

  it('wants a ranking that starts with points and names each criterion once', () => {
    expect(leagueZoneProblems([mls()])).toEqual([]);
    const problems = leagueZoneProblems([
      mls({ ranking: ['wins', 'points'] }),
      mls({ season: '2027/28', ranking: ['points', 'wins', 'wins'] }),
      mls({ season: '2028/29', ranking: ['points', 'fair_play' as never] }),
    ]);
    expect(problems).toEqual([
      'US1 2026/27: a ranking starts with points',
      'US1 2027/28: a ranking names a criterion twice',
      'US1 2028/29: unknown ranking criterion fair_play',
    ]);
  });

  it('ranks MLS 2026 by wins after points, and every other listed league as before', () => {
    const us1 = { kind: 'league', division: 'US1' } as const;
    expect(leagueRankingFor(LIST, us1, '2026/27')).toEqual([
      'points',
      'wins',
      'goal_difference',
      'goals_for',
    ]);
    // A season the list does not hold, and a league with no entry, keep the default.
    expect(leagueRankingFor(LIST, us1, '2025/26')).toEqual(DEFAULT_RANKING);
    expect(leagueRankingFor(LIST, { kind: 'league', division: null }, '2026/27')).toEqual(
      DEFAULT_RANKING,
    );
    expect(DEFAULT_RANKING).toEqual(['points', 'goal_difference', 'goals_for']);
    for (const e of LIST) {
      if (e.division === 'US1') continue;
      const key = { kind: 'league', division: e.division ?? null, country: e.country ?? null };
      expect(leagueRankingFor(LIST, key, e.season), `${e.division ?? e.country} ${e.season}`).toBe(
        DEFAULT_RANKING,
      );
    }
    expect(LIST.filter((e) => e.ranking !== undefined).map((e) => e.division)).toEqual(['US1']);
  });
});

describe("the zones of a conference's table (T-1674, D-323)", () => {
  const mls = (zones: LeagueZoneEntry['zones']): LeagueZoneEntry =>
    entry({ division: 'US1', season: '2026/27', teams: 30, zones });

  it("lets two conferences' tables share places, never two bands of one table", () => {
    expect(
      leagueZoneProblems([
        mls([
          { kind: 'title_playoffs', from: 1, to: 7, conference: 'Eastern Conference' },
          { kind: 'title_playoffs_wild_card', from: 8, to: 9, conference: 'Eastern Conference' },
          { kind: 'title_playoffs', from: 1, to: 7, conference: 'Western Conference' },
          { kind: 'title_playoffs_wild_card', from: 8, to: 9, conference: 'Western Conference' },
        ]),
      ]),
    ).toEqual([]);
    const problems = leagueZoneProblems([
      mls([
        { kind: 'title_playoffs', from: 1, to: 7, conference: 'Eastern Conference' },
        { kind: 'title_playoffs_wild_card', from: 7, to: 9, conference: 'Eastern Conference' },
        { kind: 'title_playoffs', from: 1, to: 1, conference: ' ' },
      ]),
    ]);
    expect(problems).toContain('US1 2026/27: place 7 of the Eastern Conference is in two zones');
    expect(problems).toContain('US1 2026/27: title_playoffs names an empty conference');
    // A league's one table and a conference's are different tables.
    expect(
      leagueZoneProblems([
        mls([
          { kind: 'champions_league', from: 1, to: 1 },
          { kind: 'title_playoffs', from: 1, to: 7, conference: 'Eastern Conference' },
        ]),
      ]),
    ).toEqual([]);
  });

  it("lists MLS 2026's play-off places on each conference's table, none on the overall one", () => {
    const listed = leagueZonesFor(LIST, { kind: 'league', division: 'US1' }, '2026/27');
    if (listed.state !== 'listed') throw new Error('MLS 2026/27 is listed');
    expect(listed.complete).toBe(true);
    expect(zonesOfTable(listed.zones, null)).toEqual([]);
    for (const conference of ['Eastern Conference', 'Western Conference']) {
      expect(zonesOfTable(listed.zones, conference)).toEqual([
        { kind: 'title_playoffs', from: 1, to: 7, conference },
        { kind: 'title_playoffs_wild_card', from: 8, to: 9, conference },
      ]);
    }
    // A conference the list does not name shows nothing (rule 3).
    expect(zonesOfTable(listed.zones, 'Central Conference')).toEqual([]);
    // Only the season served is listed; earlier ones show no zones.
    expect(LIST.filter((e) => e.division === 'US1').map((e) => e.season)).toEqual(['2026/27']);
  });

  it('gives every table without conferences exactly the zones it had', () => {
    for (const e of LIST.filter((x) => x.division !== 'US1')) {
      expect(e.zones.some((z) => z.conference !== undefined)).toBe(false);
      expect(zonesOfTable(e.zones, null), `${e.division ?? e.country} ${e.season}`).toEqual(
        e.zones,
      );
    }
  });
});
