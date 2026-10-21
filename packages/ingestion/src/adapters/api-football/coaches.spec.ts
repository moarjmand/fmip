import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../../harness/contract-check';
import type { TransportResponse } from '../_contract';
import { coachExternalId, coachNumber, coachRef, mapCoaches } from './coaches';
import { createApiFootballAdapter } from './index';

// Recorded read-only on the Ultra plan, 2026-10-21 (T-1439): see the files' `note`.
const DIR = join(__dirname, '..', '_fixtures', 'api-football-coachs');
function recorded(name: string): { url: string; body: { response: unknown } } {
  const file = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as {
    requests: { url: string; body: { response: unknown } }[];
  };
  return file.requests[0]!;
}
const CITY = recorded('coachs-team-manchester-city');
const ONE = recorded('coachs-id-4');

describe('the coach id space (D-230)', () => {
  it('writes a coach number apart from a player number', () => {
    expect(coachExternalId(4)).toBe('coach:4');
    expect(coachExternalId(0)).toBeNull();
    expect(coachExternalId('4')).toBeNull();
    expect(coachExternalId(4.5)).toBeNull();
    expect(coachNumber('coach:4')).toBe('4');
    expect(coachNumber('4')).toBeNull();
    expect(coachNumber('coach:04')).toBeNull();
    expect(coachNumber('coach:')).toBeNull();
  });

  it('reads a coach block with its photo, and nothing without an id or a name', () => {
    expect(
      coachRef({ id: 4, name: 'Guardiola', photo: 'https://media.api-sports.io/x.png' }),
    ).toEqual({
      externalId: 'coach:4',
      name: 'Guardiola',
      imageUrl: 'https://media.api-sports.io/x.png',
    });
    expect(coachRef({ id: 4, name: 'Guardiola', photo: 'http://insecure/x.png' })).toEqual({
      externalId: 'coach:4',
      name: 'Guardiola',
    });
    expect(coachRef({ id: null, name: 'Guardiola' })).toBeNull();
    expect(coachRef({ id: 4, name: '  ' })).toBeNull();
  });

  it("names the recorded line-up's coaches in the coach id space, the players not", async () => {
    const scenario = loadScenarios(join(__dirname, '..', '_fixtures', 'api-football')).find(
      (s) => s.name === 'lineup-burnley-man-city',
    );
    const body = scenario?.requests[0]?.body;
    const adapter = createApiFootballAdapter(
      { request: async () => ({ status: 200, body, receivedAt: '2026-10-21T00:00:00Z' }) },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getLineup('1035037');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const side of [result.data.home, result.data.away]) {
      expect(side.coach?.externalId).toMatch(/^coach:[1-9]\d*$/);
      for (const player of side.players) expect(player.externalId).toMatch(/^[1-9]\d*$/);
    }
  });
});

describe('the recorded coaches of Manchester City', () => {
  const coaches = mapCoaches(CITY.body.response);

  it('keeps every coach listed, in the coach id space', () => {
    expect(coaches.map((c) => [c.ref.externalId, c.ref.name])).toEqual([
      ['coach:4', 'Guardiola'],
      ['coach:12629', 'E. Maresca'],
    ]);
    expect(coaches[0]?.ref.imageUrl).toBe('https://media.api-sports.io/football/coachs/4.png');
  });

  it('leaves out what the provider did not say, and reads what it did', () => {
    const [guardiola, maresca] = coaches;
    expect(guardiola).toMatchObject({ name: null, dateOfBirth: null, nationality: null });
    expect(maresca).toMatchObject({
      name: { fullName: 'Vincenzo Maresca', givenName: 'Vincenzo', familyName: 'Maresca' },
      dateOfBirth: '1980-02-10',
      nationality: { name: 'Italy' },
    });
  });

  it('reads the career newest first, an open spell left open', () => {
    const maresca = coaches[1]!;
    expect(maresca.career.map((s) => [s.team.externalId, s.start, s.end])).toEqual([
      ['50', '2026-08-01', null],
      ['49', '2024-06-01', null],
      ['46', '2023-07-01', '2024-06-01'],
      ['523', '2021-05-01', '2021-11-01'],
      ['7197', '2020-09-01', '2021-05-01'],
      ['15637', '2020-08-01', '2021-05-01'],
    ]);
    expect(maresca.career[0]?.team).toMatchObject({ name: 'Manchester City' });
  });

  it('asks one request by team and maps the answer', async () => {
    const urls: string[] = [];
    const adapter = createApiFootballAdapter(
      {
        request: async (url): Promise<TransportResponse> => {
          urls.push(url);
          return { status: 200, body: CITY.body, receivedAt: '2026-10-21T00:00:00Z' };
        },
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getTeamCoaches?.('50');
    expect(urls).toEqual([CITY.url]);
    expect(result).toMatchObject({ ok: true, requests: 1, fetchedAt: '2026-10-21T00:00:00Z' });
    expect(result?.ok && result.data.length).toBe(2);
  });

  it('carries a refusal as a value', async () => {
    const adapter = createApiFootballAdapter(
      {
        request: async () => ({
          status: 200,
          body: {
            errors: { requests: 'You have reached the request limit for the day' },
            response: [],
          },
          receivedAt: '2026-10-21T00:00:00Z',
        }),
      },
      { apiKey: 'test-key' },
    );
    const result = await adapter.getTeamCoaches?.('50');
    expect(result?.ok).toBe(false);
    expect(result?.requests).toBe(1);
  });
});

describe('a coach answer read by id', () => {
  it('is the same shape', () => {
    expect(mapCoaches(ONE.body.response).map((c) => c.ref.externalId)).toEqual(['coach:4']);
  });
});

describe('what cannot be read', () => {
  it('drops a spell without a team or ending before it starts, and a repeated coach or spell', () => {
    const team = { id: 50, name: 'Manchester City' };
    const [coach, ...rest] = mapCoaches([
      {
        id: 7,
        name: 'A. Coach',
        firstname: 'Ann',
        lastname: null,
        birth: { date: '1980-02-30' },
        nationality: '  ',
        career: [
          { team, start: '2020-01-01', end: '2019-01-01' },
          { team: { id: null, name: 'Nobody' }, start: '2018-01-01', end: null },
          { team, start: null, end: null },
          { team, start: '2021-01-01', end: null },
          { team, start: '2021-01-01', end: null },
        ],
      },
      { id: 7, name: 'A. Coach', career: [] },
      { id: 8, name: null },
      'not an entry',
    ]);
    expect(rest).toEqual([]);
    expect(coach).toMatchObject({ name: null, dateOfBirth: null, nationality: null });
    expect(coach?.career.map((s) => [s.start, s.end])).toEqual([
      ['2021-01-01', null],
      [null, null],
    ]);
    expect(mapCoaches({ not: 'a list' })).toEqual([]);
  });
});
