import type { Transport, TransportInit, TransportResponse } from '@fmip/ingestion';

/** The injection token for the transport the highlights feed reaches the provider through. */
export const HIGHLIGHT_FEED_TRANSPORT = Symbol('HIGHLIGHT_FEED_TRANSPORT');

/** How long one request may take before it is a `transport` failure rather than a wait. */
export const FEED_REQUEST_TIMEOUT_MS = 15_000;

/** The network, as JSON when the body is JSON (T-1366). */
export class FetchJsonTransport implements Transport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(url: string, init: TransportInit = {}): Promise<TransportResponse> {
    const response = await this.fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      signal: AbortSignal.timeout(FEED_REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // not JSON; the client reports it as malformed
    }
    return { status: response.status, body, receivedAt: new Date().toISOString() };
  }
}

/**
 * The feed's own daily ceiling (`HIGHLIGHTS_DAILY_BUDGET`), the same pattern
 * as ingestion's `BudgetedTransport` (D-049) and a separate count from it:
 * over budget it answers 429 rather than throwing, so the client reports a
 * `quota` refusal and the run stops where it is. The day is UTC, when the
 * provider's own count resets.
 */
export class DailyBudgetTransport implements Transport {
  private day: string;
  private spent = 0;

  constructor(
    private readonly inner: Transport,
    readonly perDay: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.day = this.today();
  }

  /** Requests sent today. */
  get used(): number {
    this.roll();
    return this.spent;
  }

  async request(url: string, init?: TransportInit): Promise<TransportResponse> {
    this.roll();
    if (this.spent >= this.perDay) {
      return {
        status: 429,
        body: { message: `the highlights feed's daily budget of ${this.perDay} is spent` },
        receivedAt: this.now().toISOString(),
      };
    }
    this.spent += 1;
    return this.inner.request(url, init);
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private roll(): void {
    const today = this.today();
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }
}
