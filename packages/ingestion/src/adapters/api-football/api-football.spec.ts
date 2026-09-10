import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract, loadScenarios } from '../../harness/contract-check';
import { createApiFootballAdapter } from './index';
import {
  mapFixture,
  mapIncidents,
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
    expect(stageKindOf('Round of 16')).toBe('knockout');
    expect(stageKindOf('Relegation Round - 1')).toBe('playoff');
    expect(stageKindOf('Something else')).toBeNull();
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
