import type { Transport, TransportInit, TransportResponse } from '../adapters/_contract';

/** One recorded exchange. Stored under `adapters/_fixtures/<provider>/`. */
export interface RecordedRequest {
  method: 'GET';
  url: string;
  status: number;
  body: unknown;
}

/**
 * A `Transport` that answers only from recordings.
 *
 * It matches on method and exact URL. An adapter that asks for something not
 * recorded gets a synthetic 599 and the miss is kept in `unmatched`, which the
 * contract check reports: the recording is the specification of what the
 * adapter may request, so an unrecorded request is a contract problem, not a
 * test-environment problem.
 */
export class ReplayTransport implements Transport {
  readonly served: string[] = [];
  readonly unmatched: string[] = [];
  private readonly recordings = new Map<string, RecordedRequest>();

  constructor(
    recorded: readonly RecordedRequest[],
    private readonly recordedAt: string,
  ) {
    for (const entry of recorded) {
      this.recordings.set(ReplayTransport.key(entry.method, entry.url), entry);
    }
  }

  static key(method: string, url: string): string {
    return `${method} ${url}`;
  }

  async request(url: string, init: TransportInit = {}): Promise<TransportResponse> {
    const key = ReplayTransport.key(init.method ?? 'GET', url);
    const hit = this.recordings.get(key);

    if (hit === undefined) {
      this.unmatched.push(key);
      return {
        status: 599,
        body: { error: `no recording for ${key}` },
        receivedAt: this.recordedAt,
      };
    }

    this.served.push(key);
    return { status: hit.status, body: hit.body, receivedAt: this.recordedAt };
  }
}

/**
 * A `Transport` that performs real requests through `fetch` and remembers
 * them, so a run against a provider can be saved as a recording. This is how
 * the `_fixtures/` files are produced (T-021 onward); it needs a key and is
 * never used in tests.
 */
export class RecordingTransport implements Transport {
  readonly recorded: RecordedRequest[] = [];

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(url: string, init: TransportInit = {}): Promise<TransportResponse> {
    const method = init.method ?? 'GET';
    const response = await this.fetchImpl(url, { method, headers: init.headers });
    const text = await response.text();
    let body: unknown = text;

    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Not JSON; keep the text so the adapter can report it as malformed.
    }

    this.recorded.push({ method, url, status: response.status, body });

    return { status: response.status, body, receivedAt: new Date().toISOString() };
  }
}
