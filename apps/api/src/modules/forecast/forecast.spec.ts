import type { ForecastVersion, ModelForecastResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ForecastService, coverageOf, roundToTotalOne } from './forecast.service';
import type {
  FixtureForModel,
  NewForecast,
  PostgresForecastStore,
} from './internal/forecast-store';
import { ModelClient } from './internal/model-client';

const FIXTURE: FixtureForModel = {
  id: '00000000-0000-4000-8000-000000000901',
  kickoffAt: new Date('2025-01-05T16:30:00Z'),
  homeTeamId: '00000000-0000-4000-8000-000000000602',
  awayTeamId: '00000000-0000-4000-8000-000000000601',
  competitionId: '00000000-0000-4000-8000-000000000201',
  division: 'E0',
};

const AVAILABLE: ModelForecastResponse = {
  fixture_id: FIXTURE.id,
  status: 'available',
  computed_at: '2025-01-04T12:00:00Z',
  probabilities: { home: 0.46374, draw: 0.26221, away: 0.27405 },
  expected_goals: { home: 1.49, away: 1.084 },
  most_likely_scorelines: [{ home: 1, away: 1, probability: 0.1247 }],
  leading_factors: [
    { factor: 'team_strength', favours: 'home', magnitude: 0.263, note: 'net strength' },
  ],
  inputs: {
    model_version: 'dixon-coles-elo@0.1.0',
    fit_date: '2025-01-04',
    matches_used: 200,
    elo_used: false,
    history_from: '2024-08-16',
    data_completeness: 'limited',
  },
};

/** A store that remembers what it was asked to write and echoes it back. */
class FakeStore {
  readonly written: NewForecast[] = [];
  constructor(private readonly fixture: FixtureForModel | null) {}

  async fixtureForModel(): Promise<FixtureForModel | null> {
    return this.fixture;
  }

  async versions(): Promise<ForecastVersion[]> {
    return this.written.map((w, i) => this.toVersion(w, i + 1));
  }

  async record(input: NewForecast): Promise<ForecastVersion> {
    this.written.push(input);
    return this.toVersion(input, this.written.length);
  }

  private toVersion(w: NewForecast, n: number): ForecastVersion {
    return {
      id: `v${n}`,
      fixture_id: w.fixtureId,
      version_number: n,
      kind: w.kind,
      model_version: w.modelId,
      computed_at: w.computedAt.toISOString(),
      status: w.available === null ? 'unavailable' : 'available',
      probabilities: w.available?.probabilities ?? null,
      expected_goals: w.available?.expectedGoals ?? null,
      most_likely_scorelines: w.available?.mostLikely ?? null,
      leading_factors: w.available?.leadingFactors ?? null,
      data_completeness: w.available?.inputs.data_completeness ?? null,
      unavailable_reason: w.unavailable?.reason ?? null,
      unavailable_detail: w.unavailable?.detail ?? null,
    };
  }
}

function modelAnswering(body: unknown, status = 200): ModelClient {
  return new ModelClient({
    baseUrl: 'http://model.test',
    fetchImpl: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

function service(store: FakeStore, model: ModelClient): ForecastService {
  return new ForecastService(store as unknown as PostgresForecastStore, model);
}

describe('roundToTotalOne', () => {
  it('rounds to four decimals and makes the three total exactly 1', () => {
    const p = roundToTotalOne({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });
    expect(p).toEqual({ home: 0.3334, draw: 0.3333, away: 0.3333 });
    expect(Math.round((p.home + p.draw + p.away) * 10_000)).toBe(10_000);
  });

  it('leaves values that already total 1 alone', () => {
    expect(roundToTotalOne({ home: 0.4637, draw: 0.2622, away: 0.2741 })).toEqual({
      home: 0.4637,
      draw: 0.2622,
      away: 0.2741,
    });
  });

  it('gives the gap to the largest value, whichever side that is', () => {
    expect(roundToTotalOne({ home: 0.1, draw: 0.1, away: 0.79995 })).toEqual({
      home: 0.1,
      draw: 0.1,
      away: 0.8,
    });
  });
});

describe('coverageOf', () => {
  const base: ForecastVersion = {
    id: 'v1',
    fixture_id: FIXTURE.id,
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles-elo@0.1.0',
    computed_at: '2025-01-04T12:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.5, draw: 0.25, away: 0.25 },
    expected_goals: { home: 1.5, away: 1 },
    most_likely_scorelines: [],
    leading_factors: [],
    data_completeness: 'available',
    unavailable_reason: null,
    unavailable_detail: null,
  };

  it('is not_supplied with no version or an unavailable latest version', () => {
    expect(coverageOf(null)).toBe('not_supplied');
    expect(coverageOf({ ...base, status: 'unavailable', data_completeness: null })).toBe(
      'not_supplied',
    );
  });

  it("follows the latest version's data completeness", () => {
    expect(coverageOf(base)).toBe('available');
    expect(coverageOf({ ...base, data_completeness: 'limited' })).toBe('limited');
  });
});

describe('ForecastService.compute', () => {
  it('stores an available answer with rounded probabilities, the request and the inputs', async () => {
    const store = new FakeStore(FIXTURE);
    const outcome = await service(store, modelAnswering(AVAILABLE)).compute(FIXTURE.id, 'early');

    expect(outcome.kind).toBe('recorded');
    const written = store.written[0];
    expect(written?.modelId).toBe('dixon-coles-elo@0.1.0');
    expect(written?.request).toEqual({
      fixture_id: FIXTURE.id,
      home_team_id: FIXTURE.homeTeamId,
      away_team_id: FIXTURE.awayTeamId,
      division: 'E0',
      kickoff_at: '2025-01-05T16:30:00.000Z',
    });
    expect(written?.computedAt.toISOString()).toBe('2025-01-04T12:00:00.000Z');
    expect(written?.available?.probabilities).toEqual({ home: 0.4637, draw: 0.2622, away: 0.2741 });
    expect(written?.available?.inputs.matches_used).toBe(200);
    expect(written?.unavailable).toBeNull();
  });

  it("stores the model's own unavailable answer with its reason", async () => {
    const store = new FakeStore(FIXTURE);
    const unavailable: ModelForecastResponse = {
      fixture_id: FIXTURE.id,
      status: 'unavailable',
      computed_at: '2025-01-04T12:00:00Z',
      reason: 'no_history',
      detail: 'only 3 matches for Liverpool',
    };
    await service(store, modelAnswering(unavailable)).compute(FIXTURE.id, 'early');

    expect(store.written[0]?.available).toBeNull();
    expect(store.written[0]?.unavailable).toEqual({
      reason: 'no_history',
      detail: 'only 3 matches for Liverpool',
    });
    expect(store.written[0]?.modelId).toBe('none@0.0.0');
  });

  it('records model_unreachable when the service cannot be reached', async () => {
    const store = new FakeStore(FIXTURE);
    const down = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await service(store, down).compute(FIXTURE.id, 'manual');

    expect(store.written[0]?.unavailable?.reason).toBe('model_unreachable');
    expect(store.written[0]?.kind).toBe('manual');
  });

  it('records contract_violation when the answer drifted from the contract', async () => {
    const store = new FakeStore(FIXTURE);
    const drifted = { ...AVAILABLE, probabilities: { home: 0.5, draw: 0.5 } };
    await service(store, modelAnswering(drifted)).compute(FIXTURE.id, 'early');

    expect(store.written[0]?.unavailable?.reason).toBe('contract_violation');
  });

  it('does not ask the model about a competition with no division', async () => {
    const store = new FakeStore({ ...FIXTURE, division: null });
    let asked = 0;
    const model = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async () => {
        asked += 1;
        return new Response('{}');
      },
    });
    await service(store, model).compute(FIXTURE.id, 'early');

    expect(asked).toBe(0);
    expect(store.written[0]?.unavailable?.reason).toBe('competition_not_mapped');
  });

  it('reports an unknown fixture instead of writing anything', async () => {
    const store = new FakeStore(null);
    const outcome = await service(store, modelAnswering(AVAILABLE)).compute(FIXTURE.id, 'early');

    expect(outcome).toEqual({ kind: 'unknown_fixture' });
    expect(store.written).toHaveLength(0);
  });
});

describe('ForecastService.versions', () => {
  it('serves the versions oldest first with coverage and last_updated_at from the latest', async () => {
    const store = new FakeStore(FIXTURE);
    const svc = service(store, modelAnswering(AVAILABLE));
    await svc.compute(FIXTURE.id, 'early');
    await svc.compute(FIXTURE.id, 'lineups_confirmed');

    const response = await svc.versions(FIXTURE.id);
    expect(response?.versions.map((v) => v.version_number)).toEqual([1, 2]);
    expect(response?.latest?.kind).toBe('lineups_confirmed');
    expect(response?.coverage).toBe('limited');
    expect(response?.last_updated_at).toBe('2025-01-04T12:00:00.000Z');
  });

  it('is empty but honest for a fixture with no version yet', async () => {
    const response = await service(new FakeStore(FIXTURE), modelAnswering(AVAILABLE)).versions(
      FIXTURE.id,
    );
    expect(response).toEqual({
      fixture_id: FIXTURE.id,
      coverage: 'not_supplied',
      last_updated_at: null,
      latest: null,
      versions: [],
    });
  });

  it('is null for an unknown fixture', async () => {
    expect(await service(new FakeStore(null), modelAnswering(AVAILABLE)).versions('x')).toBeNull();
  });
});
