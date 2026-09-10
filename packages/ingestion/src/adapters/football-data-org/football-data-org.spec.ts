import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract, loadScenarios } from '../../harness/contract-check';
import { createFootballDataOrgAdapter } from './index';
import {
  humanise,
  mapFixture,
  mapIncidents,
  mapStandings,
  mapStatus,
  positionOf,
  stageKindOf,
} from './map';

const FIXTURES_DIR = join(__dirname, '..', '_fixtures', 'football-data-org');

describe('football-data.org adapter against its recordings', () => {
  it('passes the contract check on every recorded scenario', async () => {
    const scenarios = loadScenarios(FIXTURES_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    const problems = await checkAdapterContract(createFootballDataOrgAdapter, scenarios, {
      apiKey: 'test-key',
    });
    expect(problems).toEqual([]);
  });

  it('records what the free tier serves and what it refuses', () => {
    const names = loadScenarios(FIXTURES_DIR).map((s) => [s.name, s.expect.ok, s.expect.errorKind]);
    expect(names).toContainEqual(['list-fixtures-opening-weekend', true, undefined]);
    expect(names).toContainEqual(['lineup-not-on-free-tier', false, 'unsupported']);
    expect(names).toContainEqual(['list-fixtures-competition-not-on-tier', false, 'unsupported']);
  });
});

describe('mapping rules', () => {
  it('maps statuses and stages', () => {
    expect(mapStatus('TIMED')).toBe('scheduled');
    expect(mapStatus('PAUSED')).toBe('live');
    expect(mapStatus('AWARDED')).toBe('awarded');
    expect(mapStatus('WEIRD')).toBeNull();
    expect(stageKindOf('REGULAR_SEASON')).toBe('league');
    expect(stageKindOf('GROUP_STAGE')).toBe('group');
    expect(stageKindOf('LAST_16')).toBe('knockout');
    expect(stageKindOf('QUALIFICATION_ROUND_1')).toBe('qualifying');
    expect(humanise('REGULAR_SEASON')).toBe('Regular Season');
    expect(humanise('GROUP_A')).toBe('Group A');
    expect(positionOf('Centre-Back')).toBe('defender');
    expect(positionOf('Goalkeeper')).toBe('goalkeeper');
    expect(positionOf(null)).toBeNull();
  });

  it("reverses the provider's newest-first form string", () => {
    const standings = mapStandings(
      {
        competition: { id: 2021, name: 'Premier League' },
        season: { startDate: '2023-08-11' },
        standings: [
          {
            stage: 'REGULAR_SEASON',
            type: 'TOTAL',
            group: null,
            table: [
              {
                position: 3,
                team: { id: 64, name: 'Liverpool FC' },
                playedGames: 38,
                form: 'W,D,W,D,L',
                won: 24,
                draw: 10,
                lost: 4,
                points: 82,
                goalsFor: 86,
                goalsAgainst: 41,
              },
            ],
          },
          { stage: 'REGULAR_SEASON', type: 'HOME', group: null, table: [] },
        ],
      },
      '2026-09-10T12:00:00Z',
    );
    expect(standings).toHaveLength(1);
    expect(standings[0]?.rows[0]?.form).toBe('LDWDW');
    expect(standings[0]?.seasonLabel).toBe('2023/24');
    expect(standings[0]?.group).toBeNull();
  });

  it('keeps the ninety-minute score honest and the clock off finished matches', () => {
    const base = {
      id: 1,
      utcDate: '2024-05-25T14:00:00Z',
      status: 'FINISHED',
      minute: 120,
      matchday: null,
      stage: 'FINAL',
      competition: { id: 2001, name: 'UEFA Champions League' },
      season: { startDate: '2023-09-19' },
      homeTeam: { id: 1, name: 'A' },
      awayTeam: { id: 2, name: 'B' },
      score: {
        duration: 'EXTRA_TIME',
        fullTime: { home: 2, away: 1 },
        halfTime: { home: 0, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 1, away: 0 },
        penalties: { home: null, away: null },
      },
      referees: [{ id: 9, name: 'R. Ref', type: 'REFEREE' }],
    };
    const f = mapFixture(base, '2026-09-10T12:00:00Z');
    expect(f?.minute).toBeNull();
    expect(f?.scores.current).toEqual({ home: 2, away: 1 });
    expect(f?.scores.fullTime).toEqual({ home: 1, away: 1 });
    expect(f?.scores.extraTime).toEqual({ home: 1, away: 0 });
    expect(f?.scores.penalties).toBeNull();
    expect(f?.stage).toEqual({ name: 'Final', kind: 'knockout' });
    expect(f?.referee).toEqual({ externalId: '9', name: 'R. Ref' });

    const noSplit = mapFixture(
      { ...base, score: { duration: 'EXTRA_TIME', fullTime: { home: 2, away: 1 } } },
      '2026-09-10T12:00:00Z',
    );
    expect(noSplit?.scores.fullTime).toBeNull();

    const live = mapFixture(
      {
        ...base,
        status: 'IN_PLAY',
        minute: 63,
        score: { duration: 'REGULAR', fullTime: { home: 1, away: 0 } },
      },
      '2026-09-10T12:00:00Z',
    );
    expect(live?.minute).toBe(63);
    expect(live?.scores.fullTime).toBeNull();
    expect(live?.scores.current).toEqual({ home: 1, away: 0 });
  });

  it('orders goals, cards and substitutions into one incident sequence', () => {
    const incidents = mapIncidents(
      {
        id: 7,
        goals: [
          {
            minute: 70,
            injuryTime: null,
            type: 'PENALTY',
            team: { id: 2 },
            scorer: { id: 20, name: 'S' },
            assist: null,
          },
          {
            minute: 12,
            injuryTime: null,
            type: 'REGULAR',
            team: { id: 1 },
            scorer: { id: 10, name: 'G' },
            assist: { id: 11, name: 'A' },
          },
        ],
        bookings: [
          {
            minute: 45,
            injuryTime: 2,
            team: { id: 1 },
            player: { id: 12, name: 'C' },
            card: 'YELLOW_RED',
          },
        ],
        substitutions: [
          {
            minute: 60,
            team: { id: 2 },
            playerOut: { id: 21, name: 'Out' },
            playerIn: { id: 22, name: 'In' },
          },
        ],
      },
      '1',
    );
    expect(incidents.map((i) => [i.sequence, i.minute, i.kind, i.side])).toEqual([
      [1, 12, 'goal', 'home'],
      [2, 45, 'second_yellow_card', 'home'],
      [3, 60, 'substitution', 'away'],
      [4, 70, 'penalty_goal', 'away'],
    ]);
    expect(incidents[2]?.relatedPlayer).toEqual({ externalId: '22', name: 'In' });
    expect(incidents[0]?.relatedPlayer).toEqual({ externalId: '11', name: 'A' });
  });
});
