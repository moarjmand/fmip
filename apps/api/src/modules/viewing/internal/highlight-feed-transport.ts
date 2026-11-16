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
 * The daily ceiling the highlights feed and the box scores share
 * (`HIGHLIGHTS_DAILY_BUDGET`, one instance in `HighlightlyQuota`, T-1432), the
 * same pattern as ingestion's `BudgetedTransport` (D-049) and a separate count from it:
 * over budget it answers 429 rather than throwing, so the client reports a
 * `quota` refusal and the run stops where it is. The day is UTC, when the
 * provider's own count resets.
 *
 * It also remembers when the provider itself began to refuse (T-1855, D-440):
 * a 429 from the network, not this ceiling's own, sets `refusedSince`; an
 * answer under 400 clears it; anything else (a 403, a 5xx, a thrown timeout)
 * says nothing about the plan and leaves it as it was. `heard` is false until
 * the first 429 or answer under 400 since the process started. Both feeds stop
 * at their first refusal, so without this a plan the provider no longer
 * serves looks like a quiet day: from 2026-11-09 the box scores fell from
 * dozens a day to none while our count read 2 of 5000 and every condition
 * stayed `ok`.
 */
export class DailyBudgetTransport implements Transport {
  private day: string;
  private spent = 0;
  private refusingSince: Date | null = null;
  private heardFrom = false;

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
        body: { message: `the Highlightly daily budget of ${this.perDay} is spent` },
        receivedAt: this.now().toISOString(),
      };
    }
    this.spent += 1;
    const response = await this.inner.request(url, init);
    if (response.status === 429) {
      this.refusingSince ??= this.now();
      this.heardFrom = true;
    } else if (response.status < 400) {
      this.refusingSince = null;
      this.heardFrom = true;
    }
    return response;
  }

  /**
   * Whether the provider has said yet, since this process started, if it
   * serves us: false after a restart until the first feed run reaches it, so
   * the watchdog does not read a rollout as the refusal ending.
   */
  get heard(): boolean {
    return this.heardFrom;
  }

  /**
   * When the provider's own refusals began, or `null` while it answers. Not
   * reset at midnight: a refusal that lasts past the provider's daily reset
   * is the one worth seeing. This process's memory, like the count.
   */
  get refusedSince(): Date | null {
    return this.refusingSince;
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
