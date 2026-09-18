import type { Transport, TransportInit, TransportResponse } from '@fmip/ingestion';
import { NEWS_USER_AGENT } from './robots';

/** The injection token for the transport the news job reads feeds through. */
export const NEWS_TRANSPORT = Symbol('NEWS_TRANSPORT');

/** How long one feed may take before it is a `transport` failure rather than a wait. */
export const FEED_TIMEOUT_MS = 15_000;

/**
 * The one place the news module reaches the network (T-142).
 *
 * The same `Transport` shape every adapter uses, so the reader in
 * `@fmip/ingestion` is tested with a scripted transport and run with this one.
 * It identifies itself by name in the user agent, because a publisher who
 * wants to refuse us must be able to say so in their robots.txt -- and because
 * a fetcher that hides behind a browser's string is the kind of fetcher D-061
 * exists to rule out. A body is always returned as text: a feed is XML, and
 * turning it into JSON on the way in would be the transport deciding what a
 * feed is.
 */
export class FetchTransport implements Transport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(url: string, init: TransportInit = {}): Promise<TransportResponse> {
    const response = await this.fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: { 'user-agent': `${NEWS_USER_AGENT}/1.0`, ...init.headers },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      redirect: 'follow',
    });
    return {
      status: response.status,
      body: await response.text(),
      receivedAt: new Date().toISOString(),
    };
  }
}
