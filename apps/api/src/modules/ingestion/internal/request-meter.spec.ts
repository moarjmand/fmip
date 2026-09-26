import { describe, expect, it } from 'vitest';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { CountingTransport, withRequestTally } from './request-meter';

/**
 * T-501: each ingest run counts the requests it sent, and only its own, even
 * while two runs share one adapter.
 */

const answered: Transport = {
  async request(): Promise<TransportResponse> {
    // A real transport yields to the event loop; so does this one, so two runs
    // interleave here the way the live job and a post-match sweep do.
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { status: 200, body: {}, receivedAt: new Date().toISOString() };
  },
};

describe('the request tally', () => {
  it('counts the requests sent inside a run', async () => {
    const transport = new CountingTransport(answered);
    const tally = { requests: 0 };
    await withRequestTally(tally, async () => {
      await transport.request('https://provider/a');
      await transport.request('https://provider/b');
    });
    expect(tally.requests).toBe(2);
  });

  it('keeps two overlapping runs apart on one transport', async () => {
    const transport = new CountingTransport(answered);
    const live = { requests: 0 };
    const sweep = { requests: 0 };
    await Promise.all([
      withRequestTally(live, async () => {
        for (let i = 0; i < 3; i += 1) await transport.request(`https://provider/live/${i}`);
      }),
      withRequestTally(sweep, async () => {
        await Promise.all(
          Array.from({ length: 5 }, (_, i) => transport.request(`https://provider/detail/${i}`)),
        );
      }),
    ]);
    expect(live.requests).toBe(3);
    expect(sweep.requests).toBe(5);
  });

  it('still counts what a run sent before it failed', async () => {
    const transport = new CountingTransport(answered);
    const tally = { requests: 0 };
    await expect(
      withRequestTally(tally, async () => {
        await transport.request('https://provider/a');
        throw new Error('provider answered 502');
      }),
    ).rejects.toThrow('502');
    expect(tally.requests).toBe(1);
  });

  it('counts nothing outside a run, and does not fail for it', async () => {
    const transport = new CountingTransport(answered);
    await expect(transport.request('https://provider/a')).resolves.toMatchObject({ status: 200 });
  });
});
