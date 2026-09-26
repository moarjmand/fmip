import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transport, TransportInit, TransportResponse } from '@fmip/ingestion';

/**
 * How many requests an ingest run sent to its provider (T-501).
 *
 * The provider counts every request against the plan's day and nothing on our
 * side did, so the first overrun would have been the provider's refusal in the
 * middle of a match day. Each run now carries its own tally: the transport
 * every real adapter sends through adds one to whichever run it is sending
 * for. `AsyncLocalStorage` is what makes "whichever run" exact while the live
 * job and a post-match sweep overlap on the same adapter: each run's tally
 * travels with its own awaits and never sees the other's.
 */
export interface RequestTally {
  requests: number;
}

const current = new AsyncLocalStorage<RequestTally>();

/** Runs `work` with every request sent inside it added to `tally`. */
export function withRequestTally<T>(tally: RequestTally, work: () => Promise<T>): Promise<T> {
  return current.run(tally, work);
}

/**
 * Counts what is actually sent. It sits inside any budget, so a request the
 * budget refused -- never sent -- is not counted, and outside the timeout, so
 * one that timed out still was.
 */
export class CountingTransport implements Transport {
  constructor(private readonly inner: Transport) {}

  request(url: string, init?: TransportInit): Promise<TransportResponse> {
    const tally = current.getStore();
    if (tally !== undefined) tally.requests += 1;
    return this.inner.request(url, init);
  }
}
