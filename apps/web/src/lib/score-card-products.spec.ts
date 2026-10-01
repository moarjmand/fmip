import type {
  CommunityConsensusResponse,
  ForecastSummary,
  MatchViewing,
  ScoresResponse,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  batches,
  cardCommunity,
  cardForecast,
  cardIds,
  cardViewing,
  loadScoreCardProducts,
  type ProductFetchers,
} from './score-card-products';

const summary = (over: Partial<ForecastSummary> = {}): ForecastSummary => ({
  version_number: 3,
  kind: 'lineups_confirmed',
  model_version: 'dixon-coles-elo@0.3.0',
  computed_at: '2025-01-05T15:30:00.000Z',
  status: 'available',
  probabilities: { home: 0.4637, draw: 0.2622, away: 0.2741 },
  unavailable_reason: null,
  ...over,
});

const consensus = (sample: number | null): CommunityConsensusResponse =>
  sample === null
    ? { coverage: 'not_supplied', last_updated_at: '2025-01-05T12:00:00.000Z', data: null }
    : {
        coverage: 'limited',
        last_updated_at: '2025-01-05T12:00:00.000Z',
        data: {
          fixture_id: 'f',
          sample,
          crowd: {
            counts: { home: 4, draw: 1, away: 2 },
            shares: { home: 0.571, draw: 0.143, away: 0.286 },
          },
          weighted: null,
          last_submitted_at: '2025-01-05T12:00:00.000Z',
          computed_at: '2025-01-05T12:01:00.000Z',
        },
      };

const viewing = (over: Partial<MatchViewing> = {}): MatchViewing => ({
  fixture_id: 'f',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: { coverage: 'available', last_updated_at: null, data: [] },
  highlights: { coverage: 'not_supplied', last_updated_at: null, data: null },
  ...over,
});

describe('the model line (D-114)', () => {
  it('is the pre-kick-off version as percentages totalling 100.0, with its version', () => {
    const line = cardForecast(summary());
    expect(line).toMatchObject({
      state: 'available',
      version: 3,
      home: 46.4,
      draw: 26.2,
      away: 27.4,
    });
    if (line.state !== 'available') throw new Error('unreachable');
    expect(line.home + line.draw + line.away).toBeCloseTo(100, 5);
  });

  it('says why an unavailable version has no figure, and that none was made', () => {
    expect(
      cardForecast(
        summary({ status: 'unavailable', probabilities: null, unavailable_reason: 'no_history' }),
      ),
    ).toMatchObject({
      state: 'unavailable',
      version: 3,
      reason: 'no_history',
    });
    expect(cardForecast(null)).toEqual({ state: 'none' });
  });
});

describe('the community line (D-052)', () => {
  it('shows the crowd totals only at the floor, and says so below it', () => {
    expect(cardCommunity(consensus(7))).toEqual({
      state: 'available',
      sample: 7,
      home: 4,
      draw: 1,
      away: 2,
    });
    expect(cardCommunity(consensus(null))).toEqual({ state: 'below_floor' });
    expect(cardCommunity(undefined)).toEqual({ state: 'below_floor' });
  });
});

describe('the viewing line', () => {
  it('asks when no territory is chosen and separates not supplied from nothing listed', () => {
    expect(cardViewing(viewing({ territory: { state: 'not_chosen' } }))).toEqual({ state: 'ask' });
    expect(cardViewing(viewing())).toEqual({ state: 'nothing_listed', territory: 'Iran' });
    expect(
      cardViewing(
        viewing({ options: { coverage: 'not_supplied', last_updated_at: null, data: null } }),
      ),
    ).toEqual({ state: 'not_supplied', territory: 'Iran' });
  });
});

describe('loading the lines for a page', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);

  it('asks once per product per 50 matches, never once per card', async () => {
    const calls: Record<string, number[]> = { forecasts: [], consensus: [], viewing: [] };
    const fetchers: ProductFetchers = {
      forecasts: async (group) => {
        calls.forecasts?.push(group.length);
        return {
          ok: true,
          data: { fixtures: group.map((id) => ({ fixture_id: id, pre_kickoff: summary() })) },
        };
      },
      consensus: async (group) => {
        calls.consensus?.push(group.length);
        return {
          ok: true,
          data: { fixtures: group.map((id) => ({ fixture_id: id, consensus: consensus(5) })) },
        };
      },
      viewing: async (group) => {
        calls.viewing?.push(group.length);
        return { ok: true, data: { fixtures: group.map((id) => viewing({ fixture_id: id })) } };
      },
    };
    const products = await loadScoreCardProducts(ids, fetchers);
    expect(calls).toEqual({
      forecasts: [50, 50, 20],
      consensus: [50, 50, 20],
      viewing: [50, 50, 20],
    });
    expect(Object.keys(products.forecast)).toHaveLength(120);
    expect(products.community['id-119']).toMatchObject({ state: 'available' });
  });

  it('marks only the failed product unreachable, and a guest is asked for a territory without a request', async () => {
    const products = await loadScoreCardProducts(['a', 'b'], {
      forecasts: async () => ({ ok: false }),
      consensus: async () => ({
        ok: true,
        data: { fixtures: [{ fixture_id: 'a', consensus: consensus(9) }] },
      }),
      viewing: null,
    });
    expect(products.forecast).toEqual({ a: { state: 'unreachable' }, b: { state: 'unreachable' } });
    expect(products.community.a).toMatchObject({ state: 'available', sample: 9 });
    expect(products.community.b).toEqual({ state: 'below_floor' });
    expect(products.viewing).toEqual({ a: { state: 'ask' }, b: { state: 'ask' } });
  });

  it('takes the ids once, pinned first', () => {
    const card = (id: string) => ({ id }) as ScoresResponse['pinned'][number];
    const scores = {
      pinned: [card('p')],
      groups: [{ fixtures: [card('x'), card('p')] }],
    } as unknown as ScoresResponse;
    expect(cardIds(scores)).toEqual(['p', 'x']);
    expect(batches(['1', '2', '3'], 2)).toEqual([['1', '2'], ['3']]);
  });
});
