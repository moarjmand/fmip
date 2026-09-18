/**
 * `GET /health` on `apps/api`.
 *
 * Liveness only: it says the process is serving HTTP. It reports nothing about
 * Postgres or Redis, because the API checks neither in this answer. The
 * ingestion and live-path views below are separate shapes (T-071), not a
 * quiet widening of this one.
 */
export interface HealthReport {
  status: 'ok';
  service: 'api';
  /** Seconds since the process started. */
  uptime_seconds: number;
  /** ISO 8601. */
  started_at: string;
  /** ISO 8601, the moment this report was produced. */
  checked_at: string;
}

export type IngestRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

/** One provider job run, as `ingest_run` records it (T-071). */
export interface IngestRun {
  id: string;
  provider: string;
  job: string;
  scope: string | null;
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  items_written: number;
  /** What went wrong, for a failed or partial run. */
  error: string | null;
}

/** `GET /health/ingestion`: an ingest failure, visible without SSH. */
export interface IngestionHealth {
  checked_at: string;
  last_run: IngestRun | null;
  /** The newest failed or partial run among the recent ones. */
  last_failure: IngestRun | null;
  failed_last_24h: number;
  running: number;
  /** Newest first. */
  recent: IngestRun[];
}

/** `GET /health/live`: the live path's gateway in numbers. */
export interface LiveHealth {
  checked_at: string;
  /** Server-sent-event clients attached to the change feed right now. */
  stream_subscribers: number;
}

/**
 * Whether the channel between API instances can carry anything (T-233).
 *
 * `absent` is not a failure of the bus; it is the deployment having no
 * `REDIS_URL`, which means live chat delivery is off. It is reported as its own
 * state rather than as `down` so that "we never configured it" and "it broke"
 * are never the same line in a dashboard.
 */
export type ChatBusState = 'connected' | 'down' | 'absent';

/**
 * `GET /health/chat`: the socket layer in numbers (T-233).
 *
 * **Every number here belongs to one instance.** Sockets live on the process
 * that accepted them, so a deployment behind a load balancer answers this from
 * whichever instance took the request, and `instance` is how an operator can
 * tell one answer from another. A total across the fleet is a question for
 * whatever scrapes this, not a number this endpoint can honestly invent.
 */
export interface ChatHealth {
  checked_at: string;
  /** A short id generated at boot. Two different values are two processes. */
  instance: string;
  bus: ChatBusState;
  /** Sockets open on this instance right now. */
  connections: number;
  /** Conversations subscribed across those sockets. */
  subscriptions: number;
  /** Events handed to a socket since this process started. */
  delivered: number;
  /**
   * Subscriptions ended at delivery because the member was no longer a
   * participant. A number that climbs is members leaving conversations with a
   * socket still open, which is ordinary; a number that climbs fast is not.
   */
  dropped: number;
  /** Handshakes answered before they became a socket, by reason. */
  refused: { unauthenticated: number; origin: number };
  /**
   * Milliseconds from publish to delivery, over the last hundred events.
   *
   * `null` until something has been delivered. Measured against the clock of
   * the instance that published, so two instances whose clocks disagree will
   * show that disagreement here rather than hide it.
   */
  latency_ms: { p50: number; p95: number; samples: number } | null;
}

/**
 * One outbound channel (T-330): present with the provider chosen at
 * deployment, or absent. Never a default that looks like a provider.
 */
export type DeliveryChannelState = { state: 'absent' } | { state: 'configured'; provider: string };

/** `GET /health/delivery`. */
export interface DeliveryHealth {
  checked_at: string;
  email: DeliveryChannelState;
  push: DeliveryChannelState;
  /**
   * True when no channel exists: notifications stay in the product, and every
   * surface that shows them says so rather than letting a member wait for an
   * e-mail that no deployment sent.
   */
  in_product_only: boolean;
}
