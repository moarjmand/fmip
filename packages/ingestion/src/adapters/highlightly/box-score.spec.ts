import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Transport, TransportInit, TransportResponse } from '../_contract';
import {
  type NormalisedBoxScore,
  createHighlightlyBoxScores,
  mapBoxScore,
  mapBoxScoreMatch,
  mapBoxScorePlayer,
} from './box-score';

// Recorded read-only on the Pro plan, 2026-10-20 (T-1432): see the files' `note`.
const DIR = join(__dirname, '..', '_fixtures', 'highlightly-box-score');
function recorded(name: string): { url: string; body: unknown } {
  const file = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as {
    requests: { url: string; body: unknown }[];
  };
  return file.requests[0]!;
}
const BOX = recorded('box-score-juventus-lazio');
const MATCHES = recorded('matches-serie-a-2026-10-18');

class Scripted implements Transport {
  readonly urls: string[] = [];
  readonly headers: Record<string, string>[] = [];
  constructor(private readonly answers: TransportResponse[]) {}
  request(url: string, init?: TransportInit): Promise<TransportResponse> {
    this.urls.push(url);
    this.headers.push(init?.headers ?? {});
    const next = this.answers.shift();
    if (next === undefined) throw new Error(`unscripted request ${url}`);
    return Promise.resolve(next);
  }
}
const ok = (body: unknown): TransportResponse => ({
  status: 200,
  body,
  receivedAt: '2026-10-20T10:00:00.000Z',
});

function player(score: NormalisedBoxScore, team: string, name: string) {
  const side = score.sides.find((s) => s.team.name === team);
  return side?.players.find((p) => p.name === name);
}

describe('the recorded box score', () => {
  const score = mapBoxScore(BOX.body)!;

  it('reads both sides by team id, every player kept', () => {
    expect(score.sides.map((s) => [s.team.externalId, s.team.name, s.players.length])).toEqual([
      ['422880', 'Juventus', 23],
      ['415221', 'Lazio', 24],
    ]);
    expect(score.malformed).toBe(0);
  });

  it('keeps the figures the provider supplied, and leaves null out rather than zero', () => {
    expect(player(score, 'Juventus', 'R. Kolo Muani')).toEqual({
      externalId: expect.stringMatching(/^\d+$/),
      name: 'R. Kolo Muani',
      shirtNumber: 9,
      minutes: 90,
      expected: { xg: 0.38, xa: 0.12 },
    });
    // A shot on target, so xGOT too.
    expect(player(score, 'Lazio', 'O. Provstgaard')?.expected).toEqual({
      xg: 0.24,
      xa: 0.01,
      xgot: 0.55,
    });
    // An expected assist of 0 is a value; no shot is no xG.
    expect(player(score, 'Lazio', 'D. Frattesi')?.expected).toEqual({ xa: 0.06 });
  });

  it("reads a keeper's xGOT conceded and a negative goals prevented", () => {
    expect(player(score, 'Juventus', 'G. Vicario')?.expected).toEqual({
      xa: 0,
      xgot_conceded: 1.2,
      xgp: -1.75,
    });
    expect(player(score, 'Lazio', 'C. Mandas')?.expected).toEqual({
      xa: 0,
      xgot_conceded: 0.09,
      xgp: 0.09,
    });
  });

  it('gives an unused substitute no figures, even the copies the body carries', () => {
    // Rugani (0 minutes) carries Kolo Muani's 0.38 / 0.12 in the recording.
    expect(player(score, 'Juventus', 'D. Rugani')).toMatchObject({ minutes: 0, expected: {} });
    expect(player(score, 'Lazio', 'D. Doekhi')).toMatchObject({ minutes: 0, expected: {} });
    const unused = score.sides.flatMap((s) => s.players).filter((p) => p.minutes === 0);
    expect(unused.length).toBeGreaterThan(5);
    expect(unused.every((p) => Object.keys(p.expected).length === 0)).toBe(true);
  });

  it('never lets the provider rating, minutes counts or names of fields through', () => {
    const json = JSON.stringify(score);
    expect(json).not.toContain('matchRating');
    expect(json).not.toContain('expectedGoals');
    expect(json).not.toContain('logo');
  });
});

describe('box-score reading rules', () => {
  const base = { id: 7, name: 'A. Player', shirtNumber: 10, minutesPlayed: 80 };

  it('refuses an entry with no id or no name', () => {
    expect(mapBoxScorePlayer({ ...base, id: null })).toBeNull();
    expect(mapBoxScorePlayer({ ...base, name: '', fullName: null })).toBeNull();
    expect(mapBoxScorePlayer({ ...base, name: '', fullName: 'Anna Player' })?.name).toBe(
      'Anna Player',
    );
  });

  it('drops a value it cannot trust: negative counts, strings, absurd sizes', () => {
    const read = mapBoxScorePlayer({
      ...base,
      statistics: {
        expectedGoals: -0.2,
        expectedAssists: '0.3',
        expectedGoalsOnTarget: 1000,
        expectedGoalsOnTargetConceded: Number.NaN,
        expectedGoalsPrevented: -0.004,
      },
    });
    expect(read?.expected).toEqual({ xgp: 0 });
  });

  it('rounds to the two decimals stored', () => {
    expect(mapBoxScorePlayer({ ...base, statistics: { expectedGoals: 0.126 } })?.expected).toEqual({
      xg: 0.13,
    });
  });

  it('reads an unknown minutes as no figures, never a guess', () => {
    expect(
      mapBoxScorePlayer({ ...base, minutesPlayed: null, statistics: { expectedGoals: 0.4 } }),
    ).toMatchObject({ minutes: null, expected: {} });
  });

  it('answers an empty box score as no sides, and a non-array as unreadable', () => {
    expect(mapBoxScore([])).toEqual({ sides: [], malformed: 0 });
    expect(mapBoxScore({ data: [] })).toBeNull();
    expect(mapBoxScore([{ team: { id: 1, name: 'X' } }])).toBeNull();
  });
});

describe('the recorded match list', () => {
  it('reads each match with its sides and whether it finished', () => {
    const body = MATCHES.body as { data: unknown[] };
    const matches = body.data.map(mapBoxScoreMatch);
    expect(matches[0]).toEqual({
      externalId: '1319180136',
      kickoffAt: '2026-10-18T18:45:00.000Z',
      finished: true,
      home: { externalId: '422880', name: 'Juventus' },
      away: { externalId: '415221', name: 'Lazio' },
    });
    expect(matches.every((m) => m !== null)).toBe(true);
  });

  it('refuses an item without a parseable kick-off', () => {
    expect(
      mapBoxScoreMatch({
        id: 1,
        date: 'soon',
        homeTeam: { id: 2, name: 'A' },
        awayTeam: { id: 3, name: 'B' },
      }),
    ).toBeNull();
  });
});

describe('the box-score client', () => {
  it('asks one league on one UTC day, one request, with the headers', async () => {
    const transport = new Scripted([ok(MATCHES.body)]);
    const client = createHighlightlyBoxScores(transport, 'test-key');
    const result = await client.matches({ date: '2026-10-18', leagueExternalId: '115669' });
    expect(result.ok && result.data.length).toBe(4);
    expect(result.requests).toBe(1);
    expect(transport.urls).toEqual([`${MATCHES.url}&limit=100`]);
    expect(transport.headers[0]).toEqual({
      'x-rapidapi-host': 'soccer.highlightly.net',
      'x-rapidapi-key': 'test-key',
    });
  });

  it('asks a box score by the match id, one request', async () => {
    const transport = new Scripted([ok(BOX.body)]);
    const result = await createHighlightlyBoxScores(transport, 'k').boxScore('1319180136');
    expect(transport.urls).toEqual([BOX.url]);
    expect(result.ok && result.data.sides.length).toBe(2);
    expect(result.requests).toBe(1);
  });

  it('reports a spent budget as quota and a strange body as malformed', async () => {
    const quota = await createHighlightlyBoxScores(
      new Scripted([{ status: 429, body: { message: 'spent' }, receivedAt: 'x' }]),
      'k',
    ).boxScore('1');
    expect(!quota.ok && quota.error.kind).toBe('quota');
    const odd = await createHighlightlyBoxScores(new Scripted([ok({ nope: 1 })]), 'k').boxScore(
      '1',
    );
    expect(!odd.ok && odd.error.kind).toBe('malformed');
  });

  it('spends nothing on an id that is not one', async () => {
    const transport = new Scripted([]);
    const result = await createHighlightlyBoxScores(transport, 'k').boxScore('../x');
    expect(result).toMatchObject({ ok: false, requests: 0 });
    expect(transport.urls).toEqual([]);
  });
});
