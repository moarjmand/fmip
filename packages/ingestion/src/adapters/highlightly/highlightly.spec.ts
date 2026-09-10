import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAdapterContract, loadScenarios } from '../../harness/contract-check';
import { createHighlightlyAdapter, daysBetween } from './index';
import { mapFixture, mapIncidents, mapStatistics, mapStatus, parseScore, parseTime } from './map';

const FIXTURES_DIR = join(__dirname, '..', '_fixtures', 'highlightly');

describe('Highlightly adapter against its recordings', () => {
  it('passes the contract check on every recorded scenario', async () => {
    const scenarios = loadScenarios(FIXTURES_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    const problems = await checkAdapterContract(createHighlightlyAdapter, scenarios, {
      apiKey: 'test-key',
    });
    expect(problems).toEqual([]);
  });

  it("records the plan's gaps as failures, not as empty successes", () => {
    const names = loadScenarios(FIXTURES_DIR).map((s) => [s.name, s.expect.ok, s.expect.errorKind]);
    expect(names).toContainEqual(['list-fixtures-opening-weekend', true, undefined]);
    expect(names).toContainEqual(['lineup-empty-on-plan', false, 'unsupported']);
    expect(names).toContainEqual(['detail-unknown-match', false, 'malformed']);
  });

  it('reports one request per day for a fixture list', () => {
    const scenario = loadScenarios(FIXTURES_DIR).find(
      (s) => s.name === 'list-fixtures-opening-weekend',
    );
    expect(scenario?.requests).toHaveLength(4);
  });
});

describe('mapping rules', () => {
  it('reads the free-text state and the string score', () => {
    expect(mapStatus('Not started')).toBe('scheduled');
    expect(mapStatus('First half')).toBe('live');
    expect(mapStatus('Half time')).toBe('live');
    expect(mapStatus('Finished')).toBe('finished');
    expect(mapStatus('After extra time')).toBe('finished');
    expect(mapStatus('Postponed')).toBe('postponed');
    expect(mapStatus('Abandoned')).toBe('abandoned');
    expect(mapStatus('Something new')).toBeNull();
    expect(parseScore('0 - 3')).toEqual({ home: 0, away: 3 });
    expect(parseScore(null)).toBeNull();
    expect(parseTime('90+4')).toEqual({ minute: 90, added: 4 });
    expect(parseTime('61')).toEqual({ minute: 61, added: null });
    expect(parseTime('HT')).toBeNull();
  });

  it('counts the days a range costs', () => {
    expect(daysBetween('2023-08-11', '2023-08-14')).toEqual([
      '2023-08-11',
      '2023-08-12',
      '2023-08-13',
      '2023-08-14',
    ]);
    expect(daysBetween('2023-08-14', '2023-08-11')).toBeNull();
  });

  it('never invents a half-time score and keeps the clock off finished matches', () => {
    const item = {
      id: 880817271,
      round: 'Regular Season - 1',
      date: '2023-08-11T19:00:00.000Z',
      state: { clock: 90, score: { current: '0 - 3', penalties: null }, description: 'Finished' },
      awayTeam: { id: 43334, name: 'Manchester City' },
      homeTeam: { id: 38228, name: 'Burnley' },
      league: { id: 33973, name: 'Premier League', season: 2023 },
    };
    const f = mapFixture(item, '2026-09-10T12:00:00Z');
    expect(f?.status).toBe('finished');
    expect(f?.minute).toBeNull();
    expect(f?.scores).toEqual({
      current: { home: 0, away: 3 },
      halfTime: null,
      fullTime: { home: 0, away: 3 },
      extraTime: null,
      penalties: null,
      aggregate: null,
    });
    expect(f?.season).toEqual({ label: '2023/24', startYear: 2023 });
    expect(f?.stage).toEqual({ name: 'Regular Season', kind: 'league' });

    const live = mapFixture(
      {
        ...item,
        state: {
          clock: 17,
          score: { current: '1 - 0', penalties: null },
          description: 'First half',
        },
      },
      '2026-09-10T12:00:00Z',
    );
    expect(live?.minute).toBe(17);
    expect(live?.scores.fullTime).toBeNull();
  });

  it('maps events with the substitute as the related player and the side by team id', () => {
    const incidents = mapIncidents(
      [
        {
          team: { id: 43334 },
          time: '4',
          type: 'Goal',
          assist: 'Rodri',
          player: 'E. Haaland',
          playerId: 177254,
          substituted: null,
          assistingPlayerId: 7238,
        },
        {
          team: { id: 43334 },
          time: '23',
          type: 'Substitution',
          assist: null,
          player: 'K. De Bruyne',
          playerId: 101423,
          substituted: 'M. Kovačić',
          assistingPlayerId: 369005,
        },
        {
          team: { id: 38228 },
          time: '90+4',
          type: 'Red Card',
          assist: null,
          player: 'Anass Zaroury',
          playerId: 20796363,
          substituted: null,
          assistingPlayerId: null,
        },
        { team: { id: 38228 }, time: '50', type: 'Goal', player: null, playerId: null },
      ],
      '880817271',
      '38228',
    );
    expect(incidents.map((i) => [i.sequence, i.minute, i.addedTime, i.kind, i.side])).toEqual([
      [1, 4, null, 'goal', 'away'],
      [2, 23, null, 'substitution', 'away'],
      [3, 90, 4, 'red_card', 'home'],
    ]);
    expect(incidents[0]?.relatedPlayer).toEqual({ externalId: '7238', name: 'Rodri' });
    expect(incidents[1]?.player).toEqual({ externalId: '101423', name: 'K. De Bruyne' });
    expect(incidents[1]?.relatedPlayer).toEqual({ externalId: '369005', name: 'M. Kovačić' });
  });

  it('turns a possession fraction into a percentage and skips unknown metrics', () => {
    const stats = mapStatistics(
      [
        {
          team: { id: 38228 },
          statistics: [
            { value: 0.34, displayName: 'Possession' },
            { value: 0.17, displayName: 'Shots accuracy' },
            { value: 1, displayName: 'Shots on target' },
            { value: 290, displayName: 'Successful passes' },
          ],
        },
      ],
      '38228',
    );
    expect(stats).toEqual([
      { side: 'home', metric: 'possession_pct', value: 34 },
      { side: 'home', metric: 'shots_on_target', value: 1 },
      { side: 'home', metric: 'passes_accurate', value: 290 },
    ]);
  });
});
