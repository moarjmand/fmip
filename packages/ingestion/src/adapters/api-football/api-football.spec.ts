import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract, loadScenarios } from '../../harness/contract-check';
import { validateIncident } from '../../harness/validate';
import { createApiFootballAdapter } from './index';
import {
  absenceKind,
  liveExtras,
  mapAvailability,
  mapFixture,
  imageUrl,
  mapIncidents,
  mapLineup,
  mapPlayerStatistics,
  mapSeasonCoverage,
  mapSquad,
  mapStandings,
  mapStatistics,
  mapStatus,
  seasonLabel,
  seasonYear,
  stageKindOf,
  statValue,
} from './map';

const FIXTURES_DIR = join(__dirname, '..', '_fixtures', 'api-football');

describe('API-Football adapter against its recordings', () => {
  it('passes the contract check on every recorded scenario', async () => {
    const scenarios = loadScenarios(FIXTURES_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    const problems = await checkAdapterContract(createApiFootballAdapter, scenarios, {
      apiKey: 'test-key',
    });
    expect(problems).toEqual([]);
  });

  it('records both a served season and one the free plan refuses', () => {
    const names = loadScenarios(FIXTURES_DIR).map((s) => [s.name, s.expect.ok, s.expect.errorKind]);
    expect(names).toContainEqual(['list-fixtures-opening-weekend', true, undefined]);
    expect(names).toContainEqual(['list-fixtures-season-not-on-plan', false, 'unsupported']);
  });

  /**
   * T-1376. Before a line-up is announced, `/fixtures?id=` answers with the
   * fixture and an empty `lineups`. That is the recorded line-up answer with
   * its line-ups taken out, so no hand-written recording is needed.
   */
  it('tells a line-up not announced yet from a refusal', async () => {
    const recorded = loadScenarios(FIXTURES_DIR).find((s) => s.name === 'lineup-burnley-man-city');
    const body = structuredClone(recorded?.requests[0]?.body) as {
      response: { lineups: unknown[] }[];
    };
    for (const element of body.response) element.lineups = [];
    const answering = (answer: unknown) =>
      createApiFootballAdapter(
        {
          request: async () => ({ status: 200, body: answer, receivedAt: '2026-10-10T00:00:00Z' }),
        },
        { apiKey: 'test-key' },
      );

    const waiting = await answering(body).getLineup('1035037');
    expect(!waiting.ok && waiting.error).toMatchObject({ kind: 'unsupported', unpublished: true });

    // A plan that cannot ask is unsupported too, but it is not an answer.
    const refused = await answering({
      errors: { plan: 'Free plans do not have access to this season' },
      response: [],
    }).getLineup('1035037');
    expect(!refused.ok && refused.error.kind).toBe('unsupported');
    expect(!refused.ok && refused.error.unpublished).toBeUndefined();
  });
});

describe('the whole season in one request (T-505)', () => {
  const asked: string[] = [];
  const adapter = createApiFootballAdapter(
    {
      request: async (url) => {
        asked.push(url);
        return {
          status: 200,
          body: { errors: [], response: [] },
          receivedAt: '2026-09-26T00:00:00Z',
        };
      },
    },
    { apiKey: 'test-key' },
  );

  it('leaves the dates off, so a schedule published past the recorded end is not missed', async () => {
    const query = {
      competitionExternalId: '290',
      seasonLabel: '2026/27',
      from: '2026-09-23',
      to: '2026-11-08',
    };
    await adapter.listFixtures(query);
    await adapter.listFixtures({ ...query, wholeSeason: true });
    expect(asked[0]).toContain('from=2026-09-23');
    expect(asked[1]).toMatch(/\/fixtures\?league=290&season=2026$/);
  });
});

describe('mapping rules', () => {
  it('reads seasons both ways', () => {
    expect(seasonYear('2023/24')).toBe(2023);
    expect(seasonYear('2023')).toBe(2023);
    expect(seasonYear('23/24')).toBeNull();
    expect(seasonLabel(2023)).toBe('2023/24');
    expect(seasonLabel(1999)).toBe('1999/00');
  });

  it('maps every provider status to ours and refuses unknown ones', () => {
    expect(mapStatus('NS')).toBe('scheduled');
    expect(mapStatus('HT')).toBe('live');
    expect(mapStatus('AET')).toBe('finished');
    expect(mapStatus('WO')).toBe('awarded');
    expect(mapStatus('XYZ')).toBeNull();
    expect(mapStatus(undefined)).toBeNull();
  });

  it('infers the stage kind from the round text', () => {
    expect(stageKindOf('Regular Season - 3')).toBe('league');
    expect(stageKindOf('Group A - 2')).toBe('group');
    // The Champions League's one table since 2024/25, as the provider spells it.
    expect(stageKindOf('League Stage - 1')).toBe('league');
    expect(stageKindOf('3rd Qualifying Round')).toBe('qualifying');
    expect(stageKindOf('Round of 16')).toBe('knockout');
    expect(stageKindOf('Relegation Round - 1')).toBe('playoff');
    expect(stageKindOf('Something else')).toBeNull();
  });

  /**
   * T-101, against the recorded Burnley v Manchester City (2023-08-11, 0-3):
   * Haaland played 80 minutes and scored twice; Ortega sat on the bench.
   */
  it('reads each player’s numbers from the detail, and nothing for a player who never came on', () => {
    const scenario = loadScenarios(FIXTURES_DIR).find((s) => s.name === 'detail-burnley-man-city');
    const request = scenario?.requests[0];
    const raw = request?.body;
    const body = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      response: { players: unknown }[];
    };
    const stats = mapPlayerStatistics(body.response[0]?.players, '44', '50');
    const of = (playerId: string) =>
      Object.fromEntries(
        stats.filter((s) => s.player.externalId === playerId).map((s) => [s.metric, s.value]),
      );

    expect(of('1100')).toMatchObject({
      minutes: 80,
      rating: 8.6,
      goals: 2,
      shots: 3,
      shots_on_target: 2,
      passes: 11,
      key_passes: 2,
    });
    expect(stats.find((s) => s.player.externalId === '1100')?.side).toBe('away');
    // The provider left his assists null: absent, not zero.
    expect(of('1100')).not.toHaveProperty('assists');
    // An outfield player's "conceded" is the provider's zero, not a fact.
    expect(of('1100')).not.toHaveProperty('goals_conceded');
    // The unused substitute has no rows at all.
    expect(of('25004')).toEqual({});
    expect(stats.every((s) => s.value >= 0)).toBe(true);
  });

  /** T-103: who missed Burnley v Manchester City, as the provider recorded it. */
  it('reads who will miss a match, with the provider’s reason kept beside what it amounts to', () => {
    const scenario = loadScenarios(FIXTURES_DIR).find(
      (s) => s.name === 'availability-burnley-man-city',
    );
    const raw = scenario?.requests[0]?.body;
    const body = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { response: unknown };
    expect(mapAvailability(body.response, '1035037')).toEqual([
      {
        fixtureExternalId: '1035037',
        team: {
          externalId: '44',
          name: 'Burnley',
          imageUrl: 'https://media.api-sports.io/football/teams/44.png',
        },
        player: {
          externalId: '18957',
          name: 'M. Obafemi',
          imageUrl: 'https://media.api-sports.io/football/players/18957.png',
        },
        status: 'out',
        kind: 'injury',
        reason: 'Thigh Injury',
      },
    ]);
    // An entry for another match, or with a status the provider never defined, is not ours to read.
    expect(
      mapAvailability(
        [
          {
            player: { id: 1, name: 'A', type: 'Missing Fixture' },
            team: { id: 2, name: 'B' },
            fixture: { id: 9 },
          },
          {
            player: { id: 3, name: 'C', type: 'Rested' },
            team: { id: 2, name: 'B' },
            fixture: { id: 5 },
          },
        ],
        '5',
      ),
    ).toEqual([]);
  });

  it('reads what a reason amounts to, and keeps an unknown one as other', () => {
    expect(absenceKind('Knee Injury')).toBe('injury');
    expect(absenceKind('Suspended')).toBe('suspension');
    expect(absenceKind('Red Card')).toBe('suspension');
    expect(absenceKind('Illness')).toBe('illness');
    expect(absenceKind("Coach's decision")).toBe('other');
    expect(absenceKind(null)).toBeNull();
  });

  it('parses statistic values and drops what the provider left null', () => {
    expect(statValue('55%')).toBe(55);
    expect(statValue('1.23')).toBe(1.23);
    expect(statValue(7)).toBe(7);
    expect(statValue(null)).toBeNull();
    const stats = mapStatistics(
      [
        {
          team: { id: 44 },
          statistics: [
            { type: 'Ball Possession', value: '39%' },
            { type: 'Total Shots', value: null },
            { type: 'expected_goals', value: '0.61' },
            { type: 'Shots insidebox', value: 5 },
          ],
        },
      ],
      '44',
    );
    expect(stats).toEqual([
      { side: 'home', metric: 'possession_pct', value: 39 },
      { side: 'home', metric: 'expected_goals', value: 0.61 },
    ]);
  });

  it('does not show a clock on a finished match and never invents a full-time score', () => {
    const base = {
      fixture: { id: 1, date: '2023-08-11T19:00:00+00:00', status: { short: 'FT', elapsed: 90 } },
      league: { id: 39, name: 'Premier League', season: 2023, round: 'Regular Season - 1' },
      teams: { home: { id: 44, name: 'Burnley' }, away: { id: 50, name: 'Manchester City' } },
      goals: { home: 0, away: 3 },
      score: {
        halftime: { home: 0, away: 2 },
        fulltime: { home: 0, away: 3 },
        extratime: { home: null, away: null },
        penalty: { home: null, away: null },
      },
    };
    const finished = mapFixture(base, '2026-09-10T12:00:00Z');
    expect(finished?.minute).toBeNull();
    expect(finished?.scores.fullTime).toEqual({ home: 0, away: 3 });
    expect(finished?.scores.extraTime).toBeNull();
    expect(finished?.stage).toEqual({ name: 'Regular Season', kind: 'league' });

    const scheduled = mapFixture(
      {
        ...base,
        fixture: { ...base.fixture, status: { short: 'NS', elapsed: null } },
        goals: { home: null, away: null },
        score: {},
      },
      '2026-09-10T12:00:00Z',
    );
    expect(scheduled?.status).toBe('scheduled');
    expect(scheduled?.scores.current).toBeNull();
    expect(scheduled?.scores.fullTime).toBeNull();

    expect(
      mapFixture(
        { ...base, fixture: { ...base.fixture, status: { short: '??' } } },
        '2026-09-10T12:00:00Z',
      ),
    ).toBeNull();
  });

  it('drops a match a day or more ahead that the provider calls live or finished (T-1350)', () => {
    const item = (date: string, short: string) => ({
      fixture: { id: 1545957, date, status: { short, elapsed: 90 } },
      league: {
        id: 36,
        name: 'Africa Cup of Nations - Qualification',
        season: 2027,
        round: 'Group Stage - 6',
      },
      teams: { home: { id: 28, name: 'Tunisia' }, away: { id: 1503, name: 'Botswana' } },
      goals: { home: 2, away: 2 },
      score: { fulltime: { home: 2, away: 2 } },
    });
    const at = '2026-10-01T16:00:00Z';
    expect(mapFixture(item('2027-03-28T16:00:00+00:00', 'FT'), at)).toBeNull();
    expect(mapFixture(item('2027-03-28T16:00:00+00:00', '1H'), at)).toBeNull();
    // Still listed when it is merely scheduled or postponed that far ahead.
    expect(mapFixture(item('2027-03-28T16:00:00+00:00', 'NS'), at)?.status).toBe('scheduled');
    expect(mapFixture(item('2027-03-28T16:00:00+00:00', 'PST'), at)?.status).toBe('postponed');
    // A kick-off within the day (time-zone slack, an early whistle) is taken as given.
    expect(mapFixture(item('2026-10-02T10:00:00+00:00', 'FT'), at)?.status).toBe('finished');
  });

  it('turns events into incidents with the side by team id and the substitute as the related player', () => {
    const incidents = mapIncidents(
      [
        {
          time: { elapsed: 4, extra: null },
          team: { id: 50 },
          player: { id: 1, name: 'Haaland' },
          assist: { id: 2, name: 'Rodri' },
          type: 'Goal',
          detail: 'Normal Goal',
        },
        {
          time: { elapsed: 45, extra: 2 },
          team: { id: 44 },
          player: { id: 3, name: 'A' },
          assist: { id: null, name: null },
          type: 'Card',
          detail: 'Yellow Card',
        },
        {
          time: { elapsed: 60, extra: null },
          team: { id: 44 },
          player: { id: 4, name: 'Off' },
          assist: { id: 5, name: 'On' },
          type: 'subst',
          detail: 'Substitution 1',
        },
        {
          time: { elapsed: 70, extra: null },
          team: { id: 50 },
          player: { id: null, name: null },
          assist: { id: null, name: null },
          type: 'Var',
          detail: 'Goal cancelled',
        },
        {
          time: { elapsed: 80, extra: null },
          team: { id: 50 },
          player: { id: null, name: null },
          assist: { id: null, name: null },
          type: 'Goal',
          detail: 'Normal Goal',
        },
      ],
      '1',
      '44',
    );
    expect(incidents.map((i) => [i.sequence, i.kind, i.side, i.addedTime])).toEqual([
      [1, 'goal', 'away', null],
      [2, 'yellow_card', 'home', 2],
      [3, 'substitution', 'home', null],
      [4, 'var', 'away', null],
    ]);
    expect(incidents[2]?.relatedPlayer).toEqual({ externalId: '5', name: 'On' });
    // Our words or none, never "Normal Goal" or "Substitution 1" (T-1378).
    expect(incidents.map((i) => i.detail)).toEqual([null, null, null, 'goal_cancelled']);
  });

  it('keeps a long shoot-out inside the contract: a kick past 120+30 has no added time (T-538)', () => {
    const kick = (extra: number) => ({
      time: { elapsed: 120, extra },
      team: { id: 44 },
      player: { id: 7, name: 'Taker' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Penalty',
    });
    const incidents = mapIncidents([kick(1), kick(30), kick(31), kick(34)], '1', '44');
    expect(incidents.map((i) => [i.sequence, i.minute, i.addedTime])).toEqual([
      [1, 120, 1],
      [2, 120, 30],
      [3, 120, null],
      [4, 120, null],
    ]);
    expect(incidents.flatMap((i) => validateIncident(i))).toEqual([]);
  });
});

describe('the live list carries events and the half-time interval (T-830)', () => {
  it("maps each recorded element's events and says which are at half-time", () => {
    const scenario = loadScenarios(FIXTURES_DIR).find((s) => s.name === 'live-all-now');
    const body = scenario?.requests[0]?.body as {
      response: { fixture: { status: { short: string } }; events?: unknown[] }[];
    };
    expect(body.response.some((item) => item.fixture.status.short === 'HT')).toBe(true);
    for (const item of body.response) {
      const fixture = mapFixture(item, '2026-09-10T19:07:41.492Z');
      if (fixture === null) continue;
      const extras = liveExtras(item, fixture);
      expect(extras.halfTimeBreak).toBe(item.fixture.status.short === 'HT');
      // Every element of this recording carries its events array.
      expect(extras.incidents).toBeDefined();
      expect(extras.incidents?.length ?? 0).toBeLessThanOrEqual(item.events?.length ?? 0);
    }
  });

  it('leaves incidents absent, not empty, when the element has no events array', () => {
    const item = {
      fixture: { id: 1, date: '2026-09-10T19:00:00+00:00', status: { short: '1H', elapsed: 3 } },
      league: { id: 39, name: 'Premier League', season: 2026, round: 'Regular Season - 4' },
      teams: { home: { id: 44, name: 'Burnley' }, away: { id: 50, name: 'Manchester City' } },
      goals: { home: 0, away: 0 },
      score: {},
    };
    const fixture = mapFixture(item, '2026-09-10T19:05:00Z');
    expect(fixture).not.toBeNull();
    if (fixture === null) return;
    expect(liveExtras(item, fixture)).toEqual({ halfTimeBreak: false });
  });
});

describe('image addresses are carried inside ingestion (T-1320)', () => {
  const bodyOf = (name: string): { response: unknown[] } => {
    const raw = loadScenarios(FIXTURES_DIR).find((s) => s.name === name)?.requests[0]?.body;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as { response: unknown[] };
  };
  const MEDIA =
    /^https:\/\/media\.api-sports\.io\/football\/(teams|leagues|players|coachs)\/\d+\.png$/;

  it('gives a fixture its competition logo and both crests', () => {
    const fixture = mapFixture(
      bodyOf('list-fixtures-opening-weekend').response[0],
      '2026-09-10T00:00:00Z',
    );
    expect(fixture?.competition.imageUrl).toBe(
      'https://media.api-sports.io/football/leagues/39.png',
    );
    expect(fixture?.home.imageUrl).toMatch(/\/teams\/\d+\.png$/);
    expect(fixture?.away.imageUrl).toMatch(/\/teams\/\d+\.png$/);
  });

  it('gives every standings row its crest, and the table its logo', () => {
    const [table] = mapStandings(bodyOf('standings-final-table').response, '2026-09-10T00:00:00Z');
    expect(table?.competition.imageUrl).toBe('https://media.api-sports.io/football/leagues/39.png');
    expect(table?.rows.length).toBeGreaterThan(0);
    for (const row of table?.rows ?? []) expect(row.team.imageUrl).toMatch(MEDIA);
  });

  it('gives line-up players their photos from the per-player block, and the coach his', () => {
    const item = bodyOf('lineup-burnley-man-city').response[0] as {
      lineups: unknown;
      players: unknown;
      teams: { home: { id: number }; away: { id: number } };
    };
    const lineup = mapLineup(
      item.lineups,
      item.players,
      '1035037',
      String(item.teams.home.id),
      String(item.teams.away.id),
    );
    expect(lineup).not.toBeNull();
    expect(lineup?.home.coach?.imageUrl).toMatch(MEDIA);
    const players = [...(lineup?.home.players ?? []), ...(lineup?.away.players ?? [])];
    expect(players.filter((p) => p.imageUrl !== undefined).length).toBeGreaterThan(20);
    for (const p of players) if (p.imageUrl !== undefined) expect(p.imageUrl).toMatch(MEDIA);
  });

  it('gives a player statistic its player photo', () => {
    const item = bodyOf('detail-burnley-man-city').response[0] as {
      players: unknown;
      teams: { home: { id: number }; away: { id: number } };
    };
    const stats = mapPlayerStatistics(
      item.players,
      String(item.teams.home.id),
      String(item.teams.away.id),
    );
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) expect(s.player.imageUrl).toMatch(MEDIA);
  });

  it('carries nothing when the answer has no image, and only an https address', () => {
    const fixture = mapFixture(
      {
        fixture: { id: 1, date: '2026-09-10T19:00:00+00:00', status: { short: 'NS' } },
        league: { id: 39, name: 'Premier League', season: 2026, logo: 'http://x/39.png' },
        teams: { home: { id: 44, name: 'Burnley', logo: '' }, away: { id: 50, name: 'City' } },
        goals: {},
        score: {},
      },
      '2026-09-10T19:05:00Z',
    );
    expect(fixture?.competition).toEqual({ externalId: '39', name: 'Premier League' });
    expect(fixture?.home).toEqual({ externalId: '44', name: 'Burnley' });
    expect(imageUrl('https://media.api-sports.io/football/teams/44.png')).not.toBeNull();
    expect(imageUrl('javascript:alert(1)')).toBeNull();
    expect(imageUrl(42)).toBeNull();
  });
});

describe('a club squad (T-1324)', () => {
  // CONSTRUCTED, not recorded: the shape of `/players/squads?team=` as
  // API-Football documents it (`response[0].players[]` with id, name, age,
  // number, position, photo). No squad answer has been recorded from the
  // provider; the ids and addresses below are invented for this test.
  const constructed = {
    get: 'players/squads',
    parameters: { team: '9001' },
    errors: [],
    results: 1,
    response: [
      {
        team: { id: 9001, name: 'Constructed FC', logo: 'https://example.test/teams/9001.png' },
        players: [
          {
            id: 70001,
            name: 'A. Keeper',
            age: 30,
            number: 1,
            position: 'Goalkeeper',
            photo: 'https://example.test/players/70001.png',
          },
          {
            id: 70002,
            name: 'B. Back',
            age: 24,
            number: null,
            position: 'Defender',
            photo: 'javascript:alert(1)',
          },
          { id: 70001, name: 'A. Keeper', photo: 'https://example.test/players/70001.png' },
          { name: 'No Id', photo: 'https://example.test/players/none.png' },
        ],
      },
    ],
  };

  it('asks once, by team, and keeps each player once with only an https photo', async () => {
    const asked: string[] = [];
    const adapter = createApiFootballAdapter(
      {
        request: async (url) => {
          asked.push(url);
          return { status: 200, body: constructed, receivedAt: '2026-10-01T00:00:00Z' };
        },
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getSquad!('9001');
    expect(asked).toEqual(['https://v3.football.api-sports.io/players/squads?team=9001']);
    expect(result).toMatchObject({ ok: true, requests: 1 });
    expect(result.ok && result.data).toEqual([
      {
        externalId: '70001',
        name: 'A. Keeper',
        imageUrl: 'https://example.test/players/70001.png',
      },
      { externalId: '70002', name: 'B. Back' },
    ]);
  });

  it('ignores an entry for another club, and counts a refusal as one request', async () => {
    expect(mapSquad(constructed.response, '1')).toEqual([]);
    expect(mapSquad(null, '9001')).toEqual([]);
    const adapter = createApiFootballAdapter(
      {
        request: async () => ({
          status: 200,
          body: { errors: { requests: 'limit reached' }, response: [] },
          receivedAt: '2026-10-01T00:00:00Z',
        }),
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getSquad!('9001');
    expect(result).toMatchObject({ ok: false, requests: 1, error: { kind: 'quota' } });
  });
});

describe('a standings table names its group (T-1333)', () => {
  const bodyOf = (name: string): { response: unknown[] } => {
    const raw = loadScenarios(FIXTURES_DIR).find((s) => s.name === name)?.requests[0]?.body;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as { response: unknown[] };
  };

  /**
   * Constructed, not recorded: the shape of `/standings` for a group stage,
   * `league.standings` an array of groups whose rows each carry the group's
   * label. The labels are the ones the provider is documented to use.
   */
  function groupBody(labels: string[]): unknown[] {
    let team = 100;
    const row = (label: string, position: number): unknown => ({
      rank: position,
      team: { id: team++, name: `Team ${team}`, logo: null },
      points: 3,
      group: label,
      form: 'W',
      all: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 2, against: 0 } },
      update: '2026-10-01T00:00:00+00:00',
    });
    return [
      {
        league: {
          id: 5,
          name: 'UEFA Nations League',
          logo: 'https://media.api-sports.io/football/leagues/5.png',
          season: 2026,
          standings: labels.map((label) => [row(label, 1), row(label, 2)]),
        },
      },
    ];
  }

  it("reads the group's own name from each table's label", () => {
    const tables = mapStandings(
      groupBody(['League A - Group 1', 'League A, Group 2', 'Group B', 'GROUP_C']),
      '2026-10-01T00:00:00Z',
    );
    expect(tables.map((t) => t.group)).toEqual(['1', '2', 'B', 'C']);
  });

  it('gives no group to a table that is not one', () => {
    const tables = mapStandings(
      groupBody(['UEFA Nations League', 'Eastern Conference', 'Group Stage', 'League A']),
      '2026-10-01T00:00:00Z',
    );
    expect(tables.map((t) => t.group)).toEqual([null, null, null, null]);
  });

  it('keeps a recorded league table groupless', () => {
    const [table] = mapStandings(bodyOf('standings-final-table').response, '2026-10-01T00:00:00Z');
    expect(table?.group).toBeNull();
  });
});

describe('what the provider covers for a season (T-1364)', () => {
  // CONSTRUCTED, not recorded: the shape of `/leagues?id=&season=` as
  // API-Football documents it (`response[].seasons[].coverage.injuries`).
  // League 5 says no to injuries as `/leagues?current=true` did for the UEFA
  // Nations League on 2026-10-04; the other values are invented.
  const leagues = (injuries: unknown) => ({
    get: 'leagues',
    parameters: { id: '5', season: '2026' },
    errors: [],
    results: 1,
    response: [
      {
        league: { id: 5, name: 'UEFA Nations League', type: 'Cup' },
        country: { name: 'World', code: null, flag: null },
        seasons: [
          { year: 2024, current: false, coverage: { standings: true, injuries: true } },
          {
            year: 2026,
            current: true,
            coverage: { fixtures: { events: true, lineups: true }, standings: true, injuries },
          },
        ],
      },
    ],
  });

  it('asks once, by league and season year, and reads injuries as absences', async () => {
    const asked: string[] = [];
    const adapter = createApiFootballAdapter(
      {
        request: async (url) => {
          asked.push(url);
          return { status: 200, body: leagues(false), receivedAt: '2026-10-04T00:00:00Z' };
        },
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getSeasonCoverage!({
      competitionExternalId: '5',
      seasonLabel: '2026/27',
    });
    expect(asked).toEqual(['https://v3.football.api-sports.io/leagues?id=5&season=2026']);
    expect(result).toEqual({
      ok: true,
      data: { absences: false },
      requests: 1,
      fetchedAt: '2026-10-04T00:00:00Z',
    });
  });

  it('reads only the season asked about, and says null when the answer does not say', () => {
    expect(mapSeasonCoverage(leagues(true).response, '5', 2026)).toEqual({ absences: true });
    expect(mapSeasonCoverage(leagues(false).response, '5', 2024)).toEqual({ absences: true });
    expect(mapSeasonCoverage(leagues('yes').response, '5', 2026)).toEqual({ absences: null });
    expect(mapSeasonCoverage(leagues(false).response, '5', 2025)).toEqual({ absences: null });
    expect(mapSeasonCoverage(leagues(false).response, '36', 2026)).toEqual({ absences: null });
    expect(mapSeasonCoverage(null, '5', 2026)).toEqual({ absences: null });
  });

  it('spends no request on a season label it cannot read', async () => {
    const adapter = createApiFootballAdapter(
      {
        request: async () => {
          throw new Error('must not be asked');
        },
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getSeasonCoverage!({
      competitionExternalId: '5',
      seasonLabel: 'Spring',
    });
    expect(result).toMatchObject({ ok: false, requests: 0, error: { kind: 'unsupported' } });
  });
});
