import { describe, expect, it } from 'vitest';
import { REQUEST_TIMEOUT_MS, TimedTransport } from './run';

// A provider request that stalls is a transport failure after a bound
// (T-1471), not a five-minute wait that holds the job's lock.

/** A `fetch` that never answers until its signal aborts. */
const stalled: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

describe('TimedTransport', () => {
  it('gives up on a request that does not answer within its timeout', async () => {
    const transport = new TimedTransport(stalled, 50);
    const started = Date.now();
    await expect(transport.request('https://provider.test/fixtures')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('passes an answer through, parsed, when it arrives in time', async () => {
    const answer: typeof fetch = async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('{"response":[]}', { status: 200 });
    };
    const response = await new TimedTransport(answer).request('https://provider.test/fixtures');
    expect(response).toMatchObject({ status: 200, body: { response: [] } });
  });

  it('allows a provider thirty seconds by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});
