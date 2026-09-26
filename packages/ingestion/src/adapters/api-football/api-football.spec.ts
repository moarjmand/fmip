import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract, loadScenarios } from '../../harness/contract-check';
import { createApiFootballAdapter } from './index';
import {
  absenceKind,
  mapAvailability,
  mapFixture,
  mapIncidents,
  mapPlayerStatistics,
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
        team: { externalId: '44', name: 'Burnley' },
        player: { externalId: '18957', name: 'M. Obafemi' },
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
  });
});
