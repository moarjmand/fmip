import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport, TransportResponse } from '../_contract';
import { RATE_LIMIT_RETRY_MS, createApiFootballAdapter } from './index';

// A per-minute refusal is asked again after a pause; the day's quota is not
// (T-1473).

const answer = (errors: Record<string, string> | [], response: unknown[] = []) =>
  ({
    status: 200,
    body: { errors, response },
    receivedAt: new Date().toISOString(),
  }) as TransportResponse;

const RATE = {
  rateLimit:
    'Too many requests. You have exceeded the limit of requests per minute of your subscription.',
};

function scripted(answers: TransportResponse[]): Transport & { asked: number } {
  const transport = {
    asked: 0,
    async request() {
      const next = answers[Math.min(transport.asked, answers.length - 1)]!;
      transport.asked += 1;
      return next;
    },
  };
  return transport;
}

describe('the API-Football adapter on a per-minute refusal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks again after a pause, and answers with what the next ask got', async () => {
    const transport = scripted([answer(RATE), answer([])]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'k' });
    const pending = adapter.getStandings({ competitionExternalId: '39', seasonLabel: '2026/27' });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS[0]!);
    const result = await pending;
    expect(transport.asked).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('gives up after its pauses, with the refusal', async () => {
    const transport = scripted([answer(RATE)]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'k' });
    const pending = adapter.getStandings({ competitionExternalId: '39', seasonLabel: '2026/27' });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS.reduce((a, b) => a + b, 0));
    const result = await pending;
    expect(transport.asked).toBe(1 + RATE_LIMIT_RETRY_MS.length);
    expect(result).toMatchObject({ ok: false, error: { kind: 'quota' } });
  });

  it('does not ask again when the day’s quota is spent', async () => {
    const transport = scripted([
      answer({ requests: 'You have reached the request limit for the day' }),
    ]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'k' });
    const result = await adapter.getStandings({
      competitionExternalId: '39',
      seasonLabel: '2026/27',
    });
    expect(transport.asked).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { kind: 'quota' } });
  });
});
