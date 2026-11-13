/** Retention periods (D-345), their cut-offs, the batching loop and the daily purge service (T-1715). */
import { Injectable, Logger } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
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
  /**
   * A pick saved before the e-mail address was confirmed (T-1740, D-361),
   * counted from its match's kick-off. One that became a prediction goes at
   * the next run: the prediction is what is kept.
   */
  pendingPick: 30,
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
  /** Compared with the match's kick-off, not with a column of the pick's own. */
  pendingPicks: Date;
}

/** The instant before which each kind of record is purged, for a run at `now`. */
export function purgeCutoffs(now: Date): PurgeCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    sessions: before(RETENTION_DAYS.expiredSession),
    emailTokens: before(RETENTION_DAYS.expiredEmailToken),
    deliveries: before(RETENTION_DAYS.notificationDelivery),
    pendingPicks: before(RETENTION_DAYS.pendingPick),
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
  /** Days of sign-ins and active members kept in `activity_daily` before the sessions went (D-353). */
  activity_days_kept: number;
  sessions: BatchedOutcome;
  console_sessions: BatchedOutcome;
  email_tokens: BatchedOutcome;
  notification_deliveries: BatchedOutcome;
  pending_picks: BatchedOutcome;
  /** Rows of `signup_source_monthly` rewritten in one transaction (T-1821, D-415). */
  signup_sources_restamped: number;
}

/**
 * The daily retention purge (T-1715, D-345): expired sessions 30 days after
 * they expire, one-time e-mail tokens 7 days after they expire, and
 * notification delivery records after 90 days, reduced to anonymous daily
 * counts; and (T-1740, D-361) picks saved before an e-mail address was
 * confirmed, 30 days after their match's kick-off, or at once when they
 * became a prediction; and (T-1821, D-415) it rewrites the sign-up source
 * counts in one transaction, unchanged. Backups keep what they hold for up to `BACKUP_KEEP_REMOTE_DAYS`
 * (docs/07-backups.md) and are not touched here.
 *
 * First of all it has the Activity report keep the sign-ins and active
 * members of the days whose sessions are about to go (T-1727, D-353); if that
 * throws, the run fails before anything is deleted and the next day's run
 * tries again.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger('Retention');

  constructor(
    private readonly store: RetentionStore,
    private readonly activity: ActivityService,
  ) {}

  async purge(now: Date = new Date()): Promise<PurgeReport> {
    const cutoff = purgeCutoffs(now);
    const activityDaysKept = await this.activity.keepDailyCounts(cutoff.sessions);
    const report: PurgeReport = {
      ran_at: now.toISOString(),
      activity_days_kept: activityDaysKept,
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
      pending_picks: await purgeInBatches((limit) =>
        this.store.deletePendingPicks(cutoff.pendingPicks, limit, now),
      ),
      // Last: no sign-up count's live version keeps a transaction id near its account's.
      signup_sources_restamped: await this.store.restampSignupSources(),
    };
    const capped = [
      report.sessions,
      report.console_sessions,
      report.email_tokens,
      report.notification_deliveries,
      report.pending_picks,
    ].some((outcome) => outcome.capped);
    this.log.log('retention purge ran', {
      event: 'retention.purged',
      activity_days_kept: report.activity_days_kept,
      sessions: report.sessions.deleted,
      console_sessions: report.console_sessions.deleted,
      email_tokens: report.email_tokens.deleted,
      notification_deliveries: report.notification_deliveries.deleted,
      pending_picks: report.pending_picks.deleted,
      signup_sources_restamped: report.signup_sources_restamped,
      capped,
    });
    return report;
  }
}
