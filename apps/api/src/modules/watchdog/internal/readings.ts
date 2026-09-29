import {
  type Reading,
  backup,
  dataQuality,
  deliveryChannel,
  eloSource,
  type EloSourceSeen,
  ingestJob,
  liveFeed,
  modelService,
  queueFailures,
  requestBudget,
  restoreDrill,
  type RunRecord,
} from './conditions';
import type { StoredCondition } from './transition';

/** A section of the observations the tick could not read, and why. */
export interface Unreadable {
  unreadable: string;
}

const unreadable = (value: unknown): value is Unreadable =>
  typeof value === 'object' && value !== null && 'unreadable' in value;

/**
 * What one tick read from the health views, before any judgement. Every
 * section can be `Unreadable` on its own: one view that fails to answer makes
 * its conditions `unknown`, not the whole tick fail.
 */
export interface Observations {
  ingest:
    | {
        job: string;
        provider: string | null;
        reason: string | null;
        lastCompletedAt: Date | null;
        lastStartedAt: Date | null;
      }[]
    | Unreadable;
  live: { inProgress: number; oldestChangeAt: Date | null; behind: number } | Unreadable;
  budget: { requestsToday: number; budget: number | null } | Unreadable;
  queues: ({ queue: string; failedLastHour: number } | { queue: string; unreadable: string })[];
  model:
    | { configured: false }
    | { configured: true; ok: true }
    | { configured: true; ok: false; reason: string };
  /**
   * Club Elo as the model service reported it on the same health check
   * (T-920): unreadable when that check failed. Optional so a probe written
   * before it still type-checks; absent reads as not reported.
   */
  elo?: { configured: false } | Unreadable | { source: EloSourceSeen | null };
  delivery:
    | {
        email: { configured: false } | { configured: true; sent: number; failed: number };
        push: { configured: false } | { configured: true; sent: number; failed: number };
      }
    | Unreadable;
  /** What the backup and the restore drill recorded in `backup_run` (T-805). */
  backups: { backup: RunRecord; drill: RunRecord } | Unreadable;
  /** Open findings about live matches and the newest complete sweep (T-821). */
  dataQuality: { open: number; sweptAt: Date | null } | Unreadable;
}

/**
 * Observations to readings, one per condition. Pure: the previous state is an
 * argument because the model service's condition counts consecutive failures.
 * `jobs` names the ingestion jobs so each keeps its key when the ingestion
 * view could not be read.
 */
export function readingsOf(
  seen: Observations,
  previous: ReadonlyMap<string, StoredCondition>,
  now: Date,
  jobs: readonly string[],
): Reading[] {
  const out: Reading[] = [];

  if (unreadable(seen.ingest)) {
    const why = seen.ingest.unreadable;
    for (const job of jobs) {
      out.push({ ...ingestJob(job, noSource(why), now), note: why });
    }
  } else {
    for (const row of seen.ingest) out.push(ingestJob(row.job, row, now));
  }

  out.push(
    unreadable(seen.live)
      ? {
          ...liveFeed({ inProgress: 0, oldestChangeAt: null, behind: 0 }, now),
          level: 'unknown',
          note: seen.live.unreadable,
        }
      : liveFeed(seen.live, now),
  );

  out.push(
    unreadable(seen.budget)
      ? { ...requestBudget({ requestsToday: 0, budget: null }), note: seen.budget.unreadable }
      : requestBudget(seen.budget),
  );

  for (const q of seen.queues) {
    out.push(
      'unreadable' in q
        ? queueFailures(q.queue, { unreadable: q.unreadable })
        : queueFailures(q.queue, { failedLastHour: q.failedLastHour }),
    );
  }

  const model = previous.get('model_service');
  out.push(
    modelService(seen.model, model !== undefined && model.level !== 'ok' ? model.observed : null),
  );

  out.push(eloSource(seen.elo ?? { source: null }, now));

  if (unreadable(seen.delivery)) {
    const why = seen.delivery.unreadable;
    for (const channel of ['email', 'push'] as const) {
      out.push({ ...deliveryChannel(channel, { configured: false }), note: why });
    }
  } else {
    out.push(deliveryChannel('email', seen.delivery.email));
    out.push(deliveryChannel('push', seen.delivery.push));
  }

  out.push(
    unreadable(seen.dataQuality)
      ? {
          ...dataQuality({ open: 0, sweptAt: null }, now),
          note: seen.dataQuality.unreadable,
        }
      : dataQuality(seen.dataQuality, now),
  );

  if (unreadable(seen.backups)) {
    const why = seen.backups.unreadable;
    out.push({ ...backup(undefined, now), note: why });
    out.push({ ...restoreDrill(undefined, now), note: why });
  } else {
    out.push(backup(seen.backups.backup, now));
    out.push(restoreDrill(seen.backups.drill, now));
  }

  return out;
}

function noSource(reason: string) {
  return { provider: null, reason, lastCompletedAt: null, lastStartedAt: null };
}
