import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelForecastRequest } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ModelClient, contractProblems } from './internal/model-client';

// The golden examples the model service writes from its own test suite
// (apps/model/tests/test_service.py). Validating them here is the TypeScript
// half of the contract: what the service really emits must satisfy the types
// in @fmip/contracts, rule by rule.
const CONTRACT_DIR = join(__dirname, '..', '..', '..', '..', 'model', 'contract');
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8')) as unknown;

describe('the model service contract (golden examples)', () => {
  it('the available response satisfies every rule', () => {
    expect(contractProblems(example('forecast-response.example.json'))).toEqual([]);
  });

  it('the unavailable response satisfies every rule and carries a reason', () => {
    const body = example('forecast-unavailable.example.json') as Record<string, unknown>;
    expect(contractProblems(body)).toEqual([]);
    expect(body.reason).toBe('team_not_mapped');
    expect(body).not.toHaveProperty('probabilities');
  });

  it('the request example has exactly the fields the contract names', () => {
    const request = example('forecast-request.example.json') as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual([
      'away_team_id',
      'division',
      'fixture_id',
      'home_team_id',
      'kickoff_at',
    ]);
  });
});

describe('contractProblems', () => {
  const good = example('forecast-response.example.json') as Record<string, unknown>;

  it('names probabilities that do not total one', () => {
    const bad = { ...good, probabilities: { home: 0.5, draw: 0.3, away: 0.3 } };
    expect(contractProblems(bad)).toEqual([expect.stringMatching(/must total 1/)]);
  });

  it('rejects a leaked internal status, a missing reason, and junk', () => {
    expect(contractProblems({ ...good, status: 'pending' })).toContain(
      'status must be available or unavailable',
    );
    expect(
      contractProblems({
        fixture_id: good.fixture_id,
        status: 'unavailable',
        computed_at: good.computed_at,
        detail: 'x',
      }),
    ).toContain('reason must be one of the contract reasons');
    expect(contractProblems('nope')).toEqual(['response is not an object']);
  });

  it('rejects a model version that is not name@semver', () => {
    const inputs = { ...(good.inputs as Record<string, unknown>), model_version: 'v1' };
    expect(contractProblems({ ...good, inputs })).toContain('inputs is malformed');
  });
});

describe('ModelClient', () => {
  const request: ModelForecastRequest = {
    fixture_id: '00000000-0000-4000-8000-000000000901',
    home_team_id: '00000000-0000-4000-8000-000000000602',
    away_team_id: '00000000-0000-4000-8000-000000000601',
    division: 'E0',
    kickoff_at: '2025-03-02T16:30:00Z',
  };

  const clientWith = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
    new ModelClient({
      baseUrl: 'http://model.test/',
      fetchImpl: ((url: string, init?: RequestInit) =>
        Promise.resolve(handler(url, init))) as typeof fetch,
    });

  it('posts the request and returns a validated forecast', async () => {
    const client = clientWith((url, init) => {
      expect(url).toBe('http://model.test/forecast');
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return new Response(JSON.stringify(example('forecast-response.example.json')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await client.forecast(request);
    expect(result.ok).toBe(true);
    if (result.ok && result.data.status === 'available') {
      expect(result.data.inputs.model_version).toMatch(/^dixon-coles-elo@/);
    }
  });

  it('refuses a response that drifted from the contract', async () => {
    const drifted = { ...(example('forecast-response.example.json') as Record<string, unknown>) };
    delete drifted.expected_goals;
    const client = clientWith(() => new Response(JSON.stringify(drifted), { status: 200 }));

    const result = await client.forecast(request);
    expect(result).toEqual({
      ok: false,
      kind: 'contract',
      message: expect.stringContaining('expected_goals'),
    });
  });

  it('reports HTTP errors and an unreachable service as values', async () => {
    const http = clientWith(() => new Response('{"detail":"boom"}', { status: 500 }));
    expect(await http.forecast(request)).toMatchObject({ ok: false, kind: 'http', status: 500 });

    const down = new ModelClient({
      baseUrl: 'http://model.test',
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch,
    });
    expect(await down.forecast(request)).toMatchObject({ ok: false, kind: 'unreachable' });
  });
});

// The live half of the contract: a running model service, when there is one
// (CI starts it; locally: python -m fmip_model.service). Skipped, visibly,
// otherwise.
const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL;

describe.skipIf(MODEL_SERVICE_URL === undefined || MODEL_SERVICE_URL === '')(
  'the live model service',
  () => {
    const client = new ModelClient({ baseUrl: MODEL_SERVICE_URL ?? '' });

    it('answers /health with its model version', async () => {
      const health = await client.health();
      expect(health.ok).toBe(true);
      if (health.ok) expect(health.data.model_version).toMatch(/^[a-z0-9-]+@\d+\.\d+\.\d+$/);
    });

    it('answers /forecast for the seeded fixture with a contract-valid body', async () => {
      // Liverpool v Manchester United (seed 002) in E0: available once E0 is
      // loaded and aliased (seed 004), otherwise an honest unavailable. Both
      // are valid contract responses; neither is a guess.
      const result = await client.forecast({
        fixture_id: '00000000-0000-4000-8000-000000000901',
        home_team_id: '00000000-0000-4000-8000-000000000602',
        away_team_id: '00000000-0000-4000-8000-000000000601',
        division: 'E0',
        kickoff_at: '2025-01-05T16:30:00Z',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(['available', 'unavailable']).toContain(result.data.status);
        if (result.data.status === 'available') {
          const p = result.data.probabilities;
          expect(Math.abs(p.home + p.draw + p.away - 1)).toBeLessThan(0.0011);
          expect(result.data.inputs.fit_date).toBe('2025-01-04');
        }
      }
    });

    it('answers an unmapped team with unavailable and a reason', async () => {
      const result = await client.forecast({
        fixture_id: '00000000-0000-4000-8000-000000000901',
        home_team_id: '00000000-0000-4000-8000-000000000603',
        away_team_id: '00000000-0000-4000-8000-000000000601',
        division: 'E0',
        kickoff_at: '2025-01-05T16:30:00Z',
      });
      expect(result.ok && result.data.status === 'unavailable' && result.data.reason).toBe(
        'team_not_mapped',
      );
    });
  },
);
