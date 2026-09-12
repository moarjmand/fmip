import { describe, expect, it } from 'vitest';
import { NO_MODEL_SERVICE_REASON, modelClientFromEnv } from './forecast.module';

// How a deployment declares that it has no model service (T-086). The
// distinction that matters: forgetting to configure one is still a refusal to
// boot; saying `off` is a statement, and it turns every forecast into an honest
// `model_unreachable` rather than a page waiting for something that is not
// coming.
describe('the model client the environment asks for', () => {
  it('refuses to boot when MODEL_SERVICE_URL is missing or blank', () => {
    expect(() => modelClientFromEnv({})).toThrow('MODEL_SERVICE_URL is not set');
    expect(() => modelClientFromEnv({ MODEL_SERVICE_URL: '' })).toThrow(
      'MODEL_SERVICE_URL is not set',
    );
  });

  it('uses the URL it is given', () => {
    const client = modelClientFromEnv({ MODEL_SERVICE_URL: 'http://model:8000/' });
    expect(client.baseUrl).toBe('http://model:8000');
  });

  it('answers every call unreachable, with the reason, when set to off', async () => {
    const client = modelClientFromEnv({ MODEL_SERVICE_URL: 'OFF' });
    const health = await client.health();
    expect(health).toMatchObject({
      ok: false,
      kind: 'unreachable',
      message: NO_MODEL_SERVICE_REASON,
    });

    const forecast = await client.forecast({
      fixture_id: '00000000-0000-4000-8000-000000000901',
      home_team_id: '00000000-0000-4000-8000-000000000601',
      away_team_id: '00000000-0000-4000-8000-000000000602',
      division: 'E0',
      kickoff_at: '2026-01-05T20:00:00.000Z',
    });
    expect(forecast).toMatchObject({ ok: false, kind: 'unreachable' });
    // The forecast boundary turns an unreachable model into a recorded
    // `model_unreachable` version, so the reason reaches the page.
    expect(forecast.ok === false && forecast.message).toBe(NO_MODEL_SERVICE_REASON);
  });
});
