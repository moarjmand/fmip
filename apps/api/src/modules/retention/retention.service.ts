/** Retention periods (D-345), their cut-offs, the batching loop and the daily purge service (T-1715). */
import { Injectable, Logger } from '@nestjs/common';
import { RetentionStore } from './internal/retention-store';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long each kind of record is kept once its job is done (D-345, the
 * maintainer's option A of 2026-11-02). The privacy text on `/rules` states
 * the same periods (`rules.retention.*`); change both together.
 */
export const RETENTION_DAYS = {
  /** A member's or a console user's session, counted from `expires_at`. */
  expiredSession: 30,
  /** A verify-email or reset-password token, counted from `expires_at`. */
  expiredEmailToken: 7,
  /** A notification's delivery record, counted from `claimed_at`; then only anonymous counts. */
  notificationDelivery: 90,
} as const;

/**
 * Rows per statement (D-345). Each statement commits on its own, so its row
 * locks are held for one batch only, and the first run over months of rows
 * does not stall the carrier or a sign-in behind one long delete.
 */
export const PURGE_BATCH_SIZE = 5_000;

/**
 * Statements per table per run: 2,000 batches is ten million rows, more than
 * any table holds today. A run that reaches it stops, logs that it did, and
 * the next day's run carries on, so one run can never hold the worker for
 * hours.
 */
export const PURGE_MAX_BATCHES = 2_000;

export interface PurgeCutoffs {
  sessions: Date;
  emailTokens: Date;
  deliveries: Date;
}

/** The instant before which each kind of record is purged, for a run at `now`. */
export function purgeCutoffs(now: Date): PurgeCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    sessions: before(RETENTION_DAYS.expiredSession),
    emailTokens: before(RETENTION_DAYS.expiredEmailToken),
    deliveries: before(RETENTION_DAYS.notificationDelivery),
  };
}

export interface BatchedOutcome {
  deleted: number;
  batches: number;
  /** True when the run stopped at `maxBatches` with rows possibly left. */
  capped: boolean;
}

/**
 * Runs `step` (one bounded statement deleting at most `batchSize` rows) until
 * a batch comes back short, which means nothing older is left, or until
 * `maxBatches` statements have run.
 */
export async function purgeInBatches(
  step: (limit: number) => Promise<number>,
  batchSize: number = PURGE_BATCH_SIZE,
  maxBatches: number = PURGE_MAX_BATCHES,
): Promise<BatchedOutcome> {
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const n = await step(batchSize);
    batches += 1;
    deleted += n;
    if (n < batchSize) return { deleted, batches, capped: false };
  }
  return { deleted, batches, capped: true };
}

export interface PurgeReport {
  ran_at: string;
  sessions: BatchedOutcome;
  console_sessions: BatchedOutcome;
  email_tokens: BatchedOutcome;
  notification_deliveries: BatchedOutcome;
}

/**
 * The daily retention purge (T-1715, D-345): expired sessions 30 days after
 * they expire, one-time e-mail tokens 7 days after they expire, and
 * notification delivery records after 90 days, reduced to anonymous daily
 * counts. Backups keep what they hold for up to `BACKUP_KEEP_REMOTE_DAYS`
 * (docs/07-backups.md) and are not touched here.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger('Retention');

  constructor(private readonly store: RetentionStore) {}

  async purge(now: Date = new Date()): Promise<PurgeReport> {
    const cutoff = purgeCutoffs(now);
    const report: PurgeReport = {
      ran_at: now.toISOString(),
      sessions: await purgeInBatches((limit) => this.store.deleteSessions(cutoff.sessions, limit)),
      console_sessions: await purgeInBatches((limit) =>
        this.store.deleteConsoleSessions(cutoff.sessions, limit),
      ),
      email_tokens: await purgeInBatches((limit) =>
        this.store.deleteEmailTokens(cutoff.emailTokens, limit),
      ),
      notification_deliveries: await purgeInBatches((limit) =>
        this.store.rollUpDeliveries(cutoff.deliveries, limit),
      ),
    };
    const capped = [
      report.sessions,
      report.console_sessions,
      report.email_tokens,
      report.notification_deliveries,
    ].some((outcome) => outcome.capped);
    this.log.log('retention purge ran', {
      event: 'retention.purged',
      sessions: report.sessions.deleted,
      console_sessions: report.console_sessions.deleted,
      email_tokens: report.email_tokens.deleted,
      notification_deliveries: report.notification_deliveries.deleted,
      capped,
    });
    return report;
  }
}
