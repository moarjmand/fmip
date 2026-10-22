import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Transport, TransportResponse } from '../_contract';
import { inTransferWindow, transfersRefreshDays } from '../../transfer-window';
import { createApiFootballAdapter } from './index';
import { mapTransfers, transferKind } from './transfers';

// Recorded read-only on the Ultra plan, 2026-10-21 (T-1440): see the files' `note`.
const DIR = join(__dirname, '..', '_fixtures', 'api-football-transfers');
function recorded(name: string): { url: string; body: { response: unknown } } {
  const file = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as {
    requests: { url: string; body: { response: unknown } }[];
  };
  return file.requests[0]!;
}
const CITY = recorded('transfers-man-city');
const HAALAND = recorded('transfers-haaland');

class Scripted implements Transport {
  readonly urls: string[] = [];
  constructor(private readonly answers: TransportResponse[]) {}
  request(url: string): Promise<TransportResponse> {
    this.urls.push(url);
    const next = this.answers.shift();
    if (next === undefined) throw new Error(`unscripted request ${url}`);
    return Promise.resolve(next);
  }
}
const ok = (body: unknown): TransportResponse => ({
  status: 200,
  body,
  receivedAt: '2026-10-21T16:47:30.000Z',
});

describe('transferKind', () => {
  it.each([
    ['Loan', 'loan', null],
    ['Return from loan', 'loan_return', null],
    ['Back from Loan', 'loan_return', null],
    ['Free', 'free', null],
    ['Free Transfer', 'free', null],
    ['Free agent', 'free', null],
    ['Transfer', 'transfer', null],
    ['€ 75M', 'fee', '€ 75M'],
    ['7M €', 'fee', '7M €'],
    ['&pound; 1.5M', 'fee', '£ 1.5M'],
    ['€ 900K', 'fee', '€ 900K'],
    ['N/A', 'unknown', null],
    ['-', 'unknown', null],
    ['Raise', 'unknown', null],
    [null, 'unknown', null],
  ])('reads %j as %s', (raw, kind, fee) => {
    expect(transferKind(raw)).toEqual({ kind, fee });
  });
});

describe('the recorded club answer (Manchester City)', () => {
  const moves = mapTransfers(CITY.body.response);

  it('keeps every dated move between two clubs, newest first', () => {
    expect(moves.length).toBeGreaterThan(200);
    const dates = moves.map((m) => m.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const m of moves) {
      expect(m.from !== null || m.to !== null).toBe(true);
      expect(m.kind === 'fee').toBe(m.fee !== null);
    }
  });

  it('keeps the provider fee as written, entities decoded', () => {
    const aguilar = moves.find((m) => m.player.name === 'K. Aguilar' && m.kind === 'fee');
    expect(aguilar).toMatchObject({
      date: '2021-07-01',
      fee: '£ 1.5M',
      from: { externalId: '2553', name: 'Alianza Lima' },
      to: { externalId: '50', name: 'Manchester City' },
    });
  });

  it('keeps a club named without an id as a name alone', () => {
    const akanji = moves.find((m) => m.player.externalId === '5' && m.date === '2025-09-01');
    expect(akanji).toMatchObject({
      kind: 'loan',
      from: { externalId: '50' },
      to: { externalId: null, name: 'Internazionale' },
    });
  });

  it('reads a free agent named as his own club as a player without one', () => {
    const stones = moves.filter((m) => m.player.externalId === '626' && m.date === '2026-06-29');
    expect(stones.map((m) => m.to)).toEqual(
      expect.arrayContaining([null, { externalId: '505', name: 'Inter' }]),
    );
    expect(moves.some((m) => m.to?.name === 'Stones John')).toBe(false);
    expect(moves.some((m) => m.to?.name === 'Braithwaite Kaden')).toBe(false);
  });

  it('leaves out a move from a club to itself', () => {
    expect(moves.some((m) => m.from?.externalId === '50' && m.to?.externalId === '50')).toBe(false);
  });
});

describe('the adapter', () => {
  it('asks /transfers by team and by player, one request each', async () => {
    const transport = new Scripted([ok(CITY.body), ok(HAALAND.body)]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'test' });
    const team = await adapter.getTeamTransfers!('50');
    const player = await adapter.getPlayerTransfers!('1100');
    expect(transport.urls).toEqual([CITY.url, HAALAND.url]);
    expect(team).toMatchObject({ ok: true, requests: 1, fetchedAt: '2026-10-21T16:47:30.000Z' });
    expect(player.ok && player.data.map((m) => [m.date, m.kind, m.fee, m.to?.name])).toEqual([
      ['2022-07-01', 'fee', '€ 75M', 'Manchester City'],
      ['2020-01-01', 'fee', '€ 20M', 'Borussia Dortmund'],
      ['2019-01-01', 'fee', '€ 5M', 'Red Bull Salzburg'],
      ['2017-02-01', 'unknown', null, 'Molde'],
    ]);
  });

  it('says what the provider refused', async () => {
    const transport = new Scripted([
      { status: 200, body: { errors: { requests: 'limit reached for the day' } }, receivedAt: 'x' },
    ]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'test' });
    const result = await adapter.getTeamTransfers!('50');
    expect(result.ok).toBe(false);
    expect(result.requests).toBe(1);
  });
});

describe('the transfer windows', () => {
  it.each([
    ['2026-06-01', true],
    ['2026-09-15', true],
    ['2026-09-16', false],
    ['2026-10-21', false],
    ['2027-01-01', true],
    ['2027-02-15', true],
    ['2027-02-16', false],
  ])('%s is in a window: %s', (iso, open) => {
    const at = new Date(`${iso}T12:00:00Z`);
    expect(inTransferWindow(at)).toBe(open);
    expect(transfersRefreshDays(at)).toBe(open ? 7 : 30);
  });
});
