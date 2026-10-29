import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../../harness/contract-check';
import type { TransportResponse } from '../_contract';
import { createApiFootballAdapter } from './index';
import { mapAvailability, mapSeasonAvailability } from './map';

/**
 * T-1650 (D-306): a season's absences in one answer, for the training store.
 *
 * `/injuries?league=&season=` answers with the same entries as
 * `/injuries?fixture=`, one per player and match, for every match of the
 * season. The first entry below is the recorded one (Burnley v Manchester
 * City, 2023-08-11, `availability-burnley-man-city.json`), as served; the
 * others are CONSTRUCTED, not recorded, in the same shape, to show the rules
 * that need more than one match.
 */
const RECORDED = loadScenarios(join(__dirname, '..', '_fixtures', 'api-football')).find(
  (s) => s.name === 'availability-burnley-man-city',
);
const recordedEntries = (): unknown[] => {
  const raw = RECORDED?.requests[0]?.body;
  const body = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { response: unknown[] };
  return structuredClone(body.response);
};

const entry = (
  fixture: number | null,
  player: number,
  type: string,
  reason: string | null,
): unknown => ({
  player: { id: player, name: `Player ${player}`, type, reason },
  team: { id: 50, name: 'Manchester City' },
  fixture: fixture === null ? {} : { id: fixture, date: '2023-08-19T19:00:00+00:00' },
  league: { id: 39, season: 2023 },
});

const SEASON = (): unknown[] => [
  ...recordedEntries(),
  entry(1035045, 627, 'Missing Fixture', 'Suspended'),
  entry(1035045, 18861, 'Questionable', 'Illness'),
  // The same player and match twice: one absence.
  entry(1035045, 627, 'Missing Fixture', 'Suspended'),
  // The same player for another match: his own row there.
  entry(1035060, 627, 'Missing Fixture', 'Knee Injury'),
  // A status the provider never defined, and an entry that names no match.
  entry(1035060, 909, 'Rested', null),
  entry(null, 910, 'Missing Fixture', 'Knee Injury'),
];

describe('a season of absences (T-1650)', () => {
  it('keeps each entry under the match it names, decided as the per-match answer decides it', () => {
    const absences = mapSeasonAvailability(SEASON());
    expect(
      absences.map((a) => [a.fixtureExternalId, a.player.externalId, a.status, a.kind, a.reason]),
    ).toEqual([
      ['1035037', '18957', 'out', 'injury', 'Thigh Injury'],
      ['1035045', '627', 'out', 'suspension', 'Suspended'],
      ['1035045', '18861', 'doubtful', 'illness', 'Illness'],
      ['1035060', '627', 'out', 'injury', 'Knee Injury'],
    ]);
    // The recorded entry reads exactly as the match answer reads it.
    expect(absences[0]).toEqual(mapAvailability(recordedEntries(), '1035037')[0]);
    expect(absences[0]?.team).toMatchObject({ externalId: '44', name: 'Burnley' });
  });

  it('reads nothing from an answer that is not a list', () => {
    expect(mapSeasonAvailability(null)).toEqual([]);
    expect(mapSeasonAvailability({ response: [] })).toEqual([]);
  });

  it('asks once, by league and season year, and passes the answer time on', async () => {
    const asked: string[] = [];
    const adapter = createApiFootballAdapter(
      {
        request: (url): Promise<TransportResponse> => {
          asked.push(url);
          return Promise.resolve({
            status: 200,
            body: { get: 'injuries', errors: [], results: 7, response: SEASON() },
            receivedAt: '2026-10-29T21:00:00.000Z',
          });
        },
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getSeasonAbsences!({
      competitionExternalId: '39',
      seasonLabel: '2023/24',
    });
    expect(asked).toEqual(['https://v3.football.api-sports.io/injuries?league=39&season=2023']);
    expect(result).toMatchObject({ ok: true, requests: 1, fetchedAt: '2026-10-29T21:00:00.000Z' });
    expect(result.ok && result.data).toHaveLength(4);
  });

  it('turns a refusal into a result, and spends nothing on a label it cannot read', async () => {
    const refusing = createApiFootballAdapter(
      {
        request: () =>
          Promise.resolve({
            status: 200,
            body: {
              errors: { plan: 'Free plans do not have access to this season' },
              response: [],
            },
            receivedAt: '2026-10-29T21:00:00.000Z',
          }),
      },
      { apiKey: 'test-key' },
    );
    const refused = await refusing.getSeasonAbsences!({
      competitionExternalId: '39',
      seasonLabel: '2021/22',
    });
    expect(refused).toMatchObject({ ok: false, requests: 1, error: { kind: 'unsupported' } });

    const silent = createApiFootballAdapter(
      {
        request: () => {
          throw new Error('must not be asked');
        },
      },
      { apiKey: 'test-key' },
    );
    const unread = await silent.getSeasonAbsences!({
      competitionExternalId: '39',
      seasonLabel: 'Spring',
    });
    expect(unread).toMatchObject({ ok: false, requests: 0, error: { kind: 'unsupported' } });
  });
});
