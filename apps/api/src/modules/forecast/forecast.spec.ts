import type { ForecastVersion, ModelForecastResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  CROSS_LEAGUE_DIVISION,
  ForecastService,
  coverageOf,
  roundToTotalOne,
} from './forecast.service';
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
  mixesLeagues: false,
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

  /** Published versions only, numbered within their role, as the real store does (T-531). */
  get published(): NewForecast[] {
    return this.written.filter((w) => (w.role ?? 'published') === 'published');
  }

  get shadows(): NewForecast[] {
    return this.written.filter((w) => w.role === 'shadow');
  }

  async versions(): Promise<ForecastVersion[]> {
    return this.published.map((w, i) => this.toVersion(w, i + 1));
  }

  async record(input: NewForecast): Promise<ForecastVersion> {
    this.written.push(input);
    const sameRole = this.written.filter(
      (w) => (w.role ?? 'published') === (input.role ?? 'published'),
    );
    return this.toVersion(input, sameRole.length);
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
      inputs: w.available?.inputs ?? null,
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
    inputs: {
      model_version: 'dixon-coles-elo@0.1.0',
      fit_date: '2025-01-01',
      matches_used: 380,
      elo_used: true,
      history_from: '2024-08-01',
      data_completeness: 'available',
    },
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

  it('says a cup match mixes leagues rather than that it is not mapped (T-503)', async () => {
    const store = new FakeStore({ ...FIXTURE, division: null, mixesLeagues: true });
    const asked: string[] = [];
    const model = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async (url) => {
        asked.push(String(url));
        return new Response(JSON.stringify({ detail: 'no candidate' }), { status: 404 });
      },
    });
    await service(store, model).compute(FIXTURE.id, 'early');

    // The published version is never asked; only the candidates are (T-533).
    expect(asked).toEqual(['http://model.test/candidates']);
    expect(store.published[0]?.unavailable).toMatchObject({ reason: 'cross_competition' });
    expect(store.shadows).toHaveLength(0);
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

describe('XI strength in the question (T-534)', () => {
  const XI = { home: 6.91, away: 6.62, confirmed: false };
  const recording = () => {
    const bodies: unknown[] = [];
    const model = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(AVAILABLE), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    return { bodies, model };
  };

  it('asks with both XIs and stores them with the forecast', async () => {
    const store = new FakeStore(FIXTURE);
    const { bodies, model } = recording();
    const squads = { xiStrengths: async () => XI };
    await new ForecastService(store as unknown as PostgresForecastStore, model, squads).compute(
      FIXTURE.id,
      'early',
    );

    expect(bodies[0]).toMatchObject({ xi_strength: XI });
    expect(store.published[0]?.request.xi_strength).toEqual(XI);
  });

  it('asks without them when they cannot be measured, and never fails for it', async () => {
    const store = new FakeStore(FIXTURE);
    const { bodies, model } = recording();
    const squads = {
      xiStrengths: async (): Promise<null> => {
        throw new Error('database gone');
      },
    };
    const outcome = await new ForecastService(
      store as unknown as PostgresForecastStore,
      model,
      squads,
    ).compute(FIXTURE.id, 'early');

    expect(outcome.kind).toBe('recorded');
    expect(bodies[0]).not.toHaveProperty('xi_strength');
    expect(store.published[0]?.available).not.toBeNull();
  });
});

describe('shadow forecasts (T-531, T-1102)', () => {
  const V05 = { name: 'dixon-coles-elo-0.5.0', model_version: 'dixon-coles-elo@0.5.0' };
  const V06 = { name: 'dixon-coles-elo-0.6.0', model_version: 'dixon-coles-elo@0.6.0' };

  /** A model service with these candidates; a candidate named in `failing` answers that status. */
  const answering = (
    listed: { name: string; model_version: string }[] | number,
    failing: Record<string, number> = {},
  ) =>
    new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async (url) => {
        const path = String(url).replace('http://model.test', '');
        if (path === '/candidates') {
          return typeof listed === 'number'
            ? new Response(JSON.stringify({ detail: 'Not Found' }), { status: listed })
            : new Response(JSON.stringify({ candidates: listed }));
        }
        const name = path.startsWith('/forecast/candidate/')
          ? decodeURIComponent(path.slice('/forecast/candidate/'.length))
          : null;
        const status = name === null ? undefined : failing[name];
        if (status !== undefined) {
          return new Response(JSON.stringify({ detail: 'broken' }), { status });
        }
        const candidate =
          typeof listed === 'number' ? undefined : listed.find((c) => c.name === name);
        return new Response(
          JSON.stringify({
            ...AVAILABLE,
            inputs: {
              ...AVAILABLE.inputs,
              model_version: candidate?.model_version ?? AVAILABLE.inputs.model_version,
            },
          }),
        );
      },
    });

  it('records the candidate beside the published version, and never shows it', async () => {
    const store = new FakeStore(FIXTURE);
    await service(store, answering([V05])).compute(FIXTURE.id, 'early');

    expect(store.published).toHaveLength(1);
    expect(store.shadows).toHaveLength(1);
    expect(store.shadows[0]?.modelId).toBe('dixon-coles-elo@0.5.0');
    const served = await service(store, answering([V05])).versions(FIXTURE.id);
    expect(served?.versions.map((v) => v.model_version)).not.toContain('dixon-coles-elo@0.5.0');
  });

  it('records one shadow version per candidate, each under its own model version', async () => {
    const store = new FakeStore(FIXTURE);
    await service(store, answering([V05, V06])).compute(FIXTURE.id, 'early');

    expect(store.published).toHaveLength(1);
    expect(store.shadows.map((s) => s.modelId)).toEqual([
      'dixon-coles-elo@0.5.0',
      'dixon-coles-elo@0.6.0',
    ]);
  });

  it('asks the candidates about a cup match on the scale across leagues, in shadow (T-533)', async () => {
    const store = new FakeStore({ ...FIXTURE, division: null, mixesLeagues: true });
    await service(store, answering([V05, V06])).compute(FIXTURE.id, 'early');

    expect(store.published).toHaveLength(1);
    expect(store.published[0]?.unavailable).toMatchObject({ reason: 'cross_competition' });
    expect(store.shadows).toHaveLength(2);
    expect(store.shadows.every((s) => s.request.division === CROSS_LEAGUE_DIVISION)).toBe(true);
  });

  it('records nothing when there is no candidate, and the published version stands if it fails', async () => {
    const none = new FakeStore(FIXTURE);
    await service(none, answering([])).compute(FIXTURE.id, 'early');
    expect(none.shadows).toHaveLength(0);
    expect(none.published).toHaveLength(1);

    const older = new FakeStore(FIXTURE);
    await service(older, answering(404)).compute(FIXTURE.id, 'early');
    expect(older.shadows).toHaveLength(0);
    expect(older.published).toHaveLength(1);

    const failing = new FakeStore(FIXTURE);
    const outcome = await service(failing, answering(500)).compute(FIXTURE.id, 'early');
    expect(outcome.kind).toBe('recorded');
    expect(failing.shadows).toHaveLength(0);
    expect(failing.published[0]?.available).not.toBeNull();
  });

  it('logs a failing candidate while the others and the published version stand', async () => {
    const store = new FakeStore(FIXTURE);
    const outcome = await service(store, answering([V05, V06], { [V05.name]: 500 })).compute(
      FIXTURE.id,
      'early',
    );
    expect(outcome.kind).toBe('recorded');
    expect(store.published[0]?.available).not.toBeNull();
    expect(store.shadows.map((s) => s.modelId)).toEqual(['dixon-coles-elo@0.6.0']);
  });

  it("stores a candidate's own refusal under its version, not under none", async () => {
    const store = new FakeStore(FIXTURE);
    const refusing = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: async (url) =>
        String(url).endsWith('/candidates')
          ? new Response(JSON.stringify({ candidates: [V06] }))
          : String(url).endsWith(`/forecast/candidate/${V06.name}`)
            ? new Response(
                JSON.stringify({
                  status: 'unavailable',
                  fixture_id: FIXTURE.id,
                  reason: 'no_history',
                  detail: 'a test refusal',
                  computed_at: AVAILABLE.computed_at,
                }),
              )
            : new Response(JSON.stringify(AVAILABLE)),
    });
    await service(store, refusing).compute(FIXTURE.id, 'early');
    expect(store.shadows).toHaveLength(1);
    expect(store.shadows[0]?.modelId).toBe('dixon-coles-elo@0.6.0');
    expect(store.shadows[0]?.unavailable).toMatchObject({ reason: 'no_history' });
  });
});
