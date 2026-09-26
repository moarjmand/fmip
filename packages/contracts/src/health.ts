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
  /**
   * Requests this run sent to its provider (T-501); `null` for a run recorded
   * before they were counted, which is unknown rather than none.
   */
  requests: number | null;
}

/**
 * What the fixtures job can ask its provider for, which is not the same thing
 * as the job being switched on. A deployment that has just been migrated holds
 * no competition at all, so the schedule runs, asks for nothing, and writes
 * nothing -- and every other line of a health report still reads well. Rule 3
 * applies to the operator's view as much as to a member's.
 */
export interface PollableCatalogue {
  /** The provider the fixtures job is configured to ask, `null` when none is. */
  provider: string | null;
  /**
   * Why no provider serves the fixtures job, when `provider` is `null`; `null`
   * otherwise. The environment and the resolved source can disagree --
   * `INGESTION_SOURCE=replay` in a build carrying no recordings resolves to
   * nothing at all -- and without this the only honest thing a reader could
   * say is that the switch is on.
   */
  reason: string | null;
  /** Competitions with a mapping for that provider. */
  competitions: number;
  /** Of those, the ones with a current season: what is actually polled. */
  with_current_season: number;
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
  /** What there is to poll; zero means the jobs fetch nothing. */
  pollable: PollableCatalogue;
  /**
   * Requests the jobs have sent the fixtures job's provider since 00:00 UTC,
   * the moment every plan's day resets (T-501).
   */
  requests_today: number;
  /** This deployment's own daily ceiling for that provider, or `null` for none. */
  request_budget: number | null;
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

/** Where one day's post stands (T-525). */
export type ChannelPostState =
  /** Claimed and being carried; nothing else will post this day. */
  | 'sending'
  /** Every message of the day's post was accepted by the channel. */
  | 'sent'
  /** The channel refused before anything was posted; a later tick that day may try again. */
  | 'refused'
  /** Something went wrong after the claim; the day is not tried again, so nothing is posted twice. */
  | 'failed';

/**
 * `GET /health/channel` (T-525): the public channel the day's matches and the
 * statistical model's forecast are posted to. `absent` is the state of every
 * deployment until someone configures a channel, and is reported as that.
 */
export interface ChannelPostHealth {
  checked_at: string;
  channel: DeliveryChannelState;
  /**
   * Whether this instance runs the daily post: a channel, the job schedule on
   * (`INGESTION_SCHEDULE=on`) and Redis. A channel with no schedule posts nothing.
   */
  scheduled: boolean;
  /** The hour (UTC) from which the day's post goes out. */
  post_hour_utc: number;
  /** The newest day on record, or null when nothing was ever posted. */
  last: {
    day: string;
    state: ChannelPostState;
    messages: number;
    delivered: number;
    finished_at: string | null;
  } | null;
}
