import type { CandidateShadowHealth, WatchdogLevel, WatchdogThreshold } from '@fmip/contracts';

/**
 * The watchdog's conditions (T-801), each a pure function from what the
 * health views say to a level. No clock and no I/O here: `now` and every
 * observation are arguments, so each condition is tested on its own.
 *
 * The thresholds are the numbers an administrator is woken for. Each is
 * stated with its reason beside it; changing one is a one-line change here,
 * and the endpoint shows the value in force.
 */

/** One condition as this tick saw it. */
export interface Reading {
  key: string;
  level: WatchdogLevel;
  observed: number | null;
  threshold: WatchdogThreshold;
  note: string | null;
}

/** `failing` at or above `failing`, `degraded` at or above `degraded`, else `ok`. */
export function levelOf(observed: number, threshold: WatchdogThreshold): WatchdogLevel {
  if (observed >= threshold.failing) return 'failing';
  if (observed >= threshold.degraded) return 'degraded';
  return 'ok';
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Seconds since an ingestion job last completed. Set against each job's
 * schedule (`ingestion-scheduler.service.ts`): `degraded` after a handful of
 * missed ticks, `failing` when the data it keeps is plainly out of date.
 *
 * - live, every minute: 5 and 15 minutes. Five missed ticks is not a slow
 *   provider; fifteen minutes is a match's worth of goals not shown.
 * - lineups, every five minutes: 20 minutes and an hour (a line-up lands about
 *   an hour before kick-off).
 * - post_match, every thirty minutes: 90 minutes and 4 hours.
 * - fixtures and standings, hourly: 3 and 12 hours.
 */
export const INGEST_THRESHOLDS: Record<string, WatchdogThreshold> = {
  live: { unit: 'seconds', degraded: 5 * MINUTE, failing: 15 * MINUTE },
  lineups: { unit: 'seconds', degraded: 20 * MINUTE, failing: HOUR },
  post_match: { unit: 'seconds', degraded: 90 * MINUTE, failing: 4 * HOUR },
  fixtures: { unit: 'seconds', degraded: 3 * HOUR, failing: 12 * HOUR },
  standings: { unit: 'seconds', degraded: 3 * HOUR, failing: 12 * HOUR },
};

const DEFAULT_INGEST_THRESHOLD: WatchdogThreshold = {
  unit: 'seconds',
  degraded: 3 * HOUR,
  failing: 12 * HOUR,
};

export function ingestJob(
  job: string,
  seen: {
    provider: string | null;
    reason: string | null;
    lastCompletedAt: Date | null;
    lastStartedAt: Date | null;
  },
  now: Date,
): Reading {
  const key = `ingest:${job}`;
  const threshold = INGEST_THRESHOLDS[job] ?? DEFAULT_INGEST_THRESHOLD;
  if (seen.provider === null) {
    return { key, level: 'unknown', observed: null, threshold, note: seen.reason };
  }
  if (seen.lastCompletedAt === null) {
    return seen.lastStartedAt === null
      ? {
          key,
          level: 'unknown',
          observed: null,
          threshold,
          note: `no ${job} run on record for ${seen.provider}`,
        }
      : {
          key,
          level: 'failing',
          observed: null,
          threshold,
          note: `${job} has runs on record for ${seen.provider} and none completed`,
        };
  }
  const observed = Math.max(0, Math.round((now.getTime() - seen.lastCompletedAt.getTime()) / 1000));
  return {
    key,
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: `seconds since the newest completed ${job} run (${seen.provider})`,
  };
}

/**
 * Seconds since the longest-unchanged match in progress last changed.
 *
 * Not D-045's two minutes: that rule is right for a page ("the last known,
 * not the current") and wrong for waking somebody, because half-time is a
 * match in progress whose data does not change for fifteen minutes. So:
 * `degraded` at 20 minutes (longer than any half-time), `failing` at 40. A
 * feed that stops for every match at once is caught sooner by `ingest:live`.
 */
export const LIVE_FEED_THRESHOLD: WatchdogThreshold = {
  unit: 'seconds',
  degraded: 20 * MINUTE,
  failing: 40 * MINUTE,
};

export function liveFeed(
  seen: { inProgress: number; oldestChangeAt: Date | null; behind: number },
  now: Date,
): Reading {
  const threshold = LIVE_FEED_THRESHOLD;
  if (seen.inProgress === 0 || seen.oldestChangeAt === null) {
    return {
      key: 'live_feed',
      level: 'ok',
      observed: null,
      threshold,
      note: 'no match in progress',
    };
  }
  const observed = Math.max(0, Math.round((now.getTime() - seen.oldestChangeAt.getTime()) / 1000));
  return {
    key: 'live_feed',
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: `${seen.inProgress} in progress, ${seen.behind} unchanged for ${threshold.degraded / MINUTE} minutes or more`,
  };
}

/**
 * The day's provider requests as a percentage of the budget T-501 set
 * (`API_FOOTBALL_DAILY_BUDGET`): `degraded` at 80 % (the day will run out if
 * the afternoon is like the morning), `failing` at 95 % (it is about to).
 */
export const REQUEST_BUDGET_THRESHOLD: WatchdogThreshold = {
  unit: 'percent',
  degraded: 80,
  failing: 95,
};

export function requestBudget(seen: { requestsToday: number; budget: number | null }): Reading {
  const threshold = REQUEST_BUDGET_THRESHOLD;
  if (seen.budget === null || seen.budget <= 0) {
    return {
      key: 'request_budget',
      level: 'unknown',
      observed: null,
      threshold,
      note: 'no daily request budget is set for this deployment',
    };
  }
  const observed = Math.round((1000 * seen.requestsToday) / seen.budget) / 10;
  return {
    key: 'request_budget',
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: `${seen.requestsToday} of ${seen.budget} requests since 00:00 UTC`,
  };
}

/**
 * Failed jobs on one BullMQ queue in the last hour: one is worth a look, three
 * is a job that keeps failing. An hour's window is also the hysteresis: the
 * condition recovers an hour after the last failure, not on the next tick.
 */
export const QUEUE_FAILURE_THRESHOLD: WatchdogThreshold = {
  unit: 'count',
  degraded: 1,
  failing: 3,
};

export function queueFailures(
  queue: string,
  seen: { failedLastHour: number } | { unreadable: string },
): Reading {
  const key = `jobs:${queue}`;
  const threshold = QUEUE_FAILURE_THRESHOLD;
  if ('unreadable' in seen) {
    return { key, level: 'unknown', observed: null, threshold, note: seen.unreadable };
  }
  return {
    key,
    level: levelOf(seen.failedLastHour, threshold),
    observed: seen.failedLastHour,
    threshold,
    note: `failed ${queue} jobs in the last hour`,
  };
}

/**
 * Consecutive failed health checks of the model service, one a tick:
 * `degraded` at the first, `failing` at three in a row. The count is carried
 * from the previous tick's reading, so a single timeout is not an outage.
 */
export const MODEL_SERVICE_THRESHOLD: WatchdogThreshold = {
  unit: 'count',
  degraded: 1,
  failing: 3,
};

export function modelService(
  seen:
    | { configured: false }
    | { configured: true; ok: true }
    | { configured: true; ok: false; reason: string },
  previousObserved: number | null,
): Reading {
  const threshold = MODEL_SERVICE_THRESHOLD;
  if (!seen.configured) {
    return {
      key: 'model_service',
      level: 'unknown',
      observed: null,
      threshold,
      note: 'no model service is configured for this deployment',
    };
  }
  if (seen.ok) {
    return {
      key: 'model_service',
      level: 'ok',
      observed: 0,
      threshold,
      note: 'health check answered',
    };
  }
  const observed = (previousObserved ?? 0) + 1;
  return {
    key: 'model_service',
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: seen.reason,
  };
}

/**
 * Seconds since Club Elo last answered (T-920, D-111): since the newest
 * snapshot that loaded, or, when none ever has, since the first failed ask.
 * The model service asks for yesterday's snapshot at most every six hours.
 *
 * `degraded` after three days: the forecasts are still made, from results
 * alone, and say so ("no Elo prior this time"), so this is worth a look, not
 * a wake-up. `failing` after fourteen, when the published model has gone a
 * fortnight without its long-term prior and D-111's own-records Elo (T-921)
 * or N-4's retirement of the source is the week's question.
 *
 * `ok` when the service is told not to ask (`MODEL_CLUBELO_REFRESH=off`):
 * a source retired on purpose is not a fault. `unknown` when the model service
 * does not answer (that is `model_service`'s condition), does not report the
 * source, or never asked it.
 */
export const ELO_SOURCE_THRESHOLD: WatchdogThreshold = {
  unit: 'seconds',
  degraded: 3 * 24 * HOUR,
  failing: 14 * 24 * HOUR,
};

export interface EloSourceSeen {
  refresh: boolean;
  /** D-162: no served version reads Club Elo; see `eloSourceRetired`. Absent from an older service. */
  retired?: boolean;
  state: 'recorded' | 'unreadable';
  last_succeeded_day: string | null;
  last_error: string | null;
  last_error_at: string | null;
  unanswered_since: string | null;
  detail: string | null;
}

export function eloSource(
  seen: { configured: false } | { unreadable: string } | { source: EloSourceSeen | null },
  now: Date,
): Reading {
  const key = 'elo_source';
  const threshold = ELO_SOURCE_THRESHOLD;
  const unknown = (note: string): Reading => ({
    key,
    level: 'unknown',
    observed: null,
    threshold,
    note,
  });
  if ('configured' in seen) return unknown('no model service is configured for this deployment');
  if ('unreadable' in seen) {
    return unknown(`the model service did not answer, so Club Elo's state is not known`);
  }
  const source = seen.source;
  if (source === null) return unknown('the model service does not report Club Elo');
  if (!source.refresh) {
    return {
      key,
      level: 'ok',
      observed: null,
      threshold,
      note: 'Club Elo is not asked on this deployment (MODEL_CLUBELO_REFRESH=off)',
    };
  }
  if (source.state === 'unreadable') {
    return unknown(`the training store did not answer: ${source.detail ?? 'no detail'}`);
  }
  if (source.unanswered_since === null) return unknown('Club Elo has not been asked yet');

  const observed = Math.max(
    0,
    Math.round((now.getTime() - new Date(source.unanswered_since).getTime()) / 1000),
  );
  const answered =
    source.last_succeeded_day === null
      ? 'Club Elo has never answered here'
      : `Club Elo last answered for ${source.last_succeeded_day}`;
  const error =
    source.last_error === null
      ? ''
      : `; last error${source.last_error_at === null ? '' : ` ${source.last_error_at.slice(0, 16).replace('T', ' ')} UTC`}${detailOf(source.last_error)}`;
  return { key, level: levelOf(observed, threshold), observed, threshold, note: answered + error };
}

/**
 * Club Elo retired (D-162, T-947): from the promotion that replaces
 * `dixon-coles-elo@0.1.0`, no version the model service serves reads it and
 * the service says `retired`. The condition then goes: an incident still open
 * is closed by this one `ok`, and a condition with none is removed from the
 * watchdog (`retiredConditions` in `readings.ts`), so the System page's line
 * goes with it.
 */
export function eloSourceRetired(): Reading {
  return {
    key: 'elo_source',
    level: 'ok',
    observed: null,
    threshold: ELO_SOURCE_THRESHOLD,
    note: 'Club Elo is retired (D-162): no model version reads it any more',
  };
}

/**
 * How many ranges differ between the list Caddy enforces
 * (`deploy/cloudflare-ranges.caddy`) and the one Cloudflare publishes
 * (T-930, D-112), compared once a week. Any difference is `failing`, like
 * T-1165's candidate: a range Cloudflare added and we lack refuses real
 * readers, and a range it dropped and we still allow is an address that can
 * reach the origin without Cloudflare again. The note names every range.
 *
 * `ok` when the check is off on this deployment (`CLOUDFLARE_RANGES_CHECK`,
 * on only in production, where Caddy enforces the list). `unknown` when
 * Cloudflare's lists did not answer, or answered something that is not a list.
 */
export const CLOUDFLARE_RANGES_THRESHOLD: WatchdogThreshold = {
  unit: 'count',
  degraded: 1,
  failing: 1,
};

export type CloudflareRangesSeen =
  | { configured: false }
  | { unreadable: string; at: Date }
  | { notCommitted: string[]; noLongerPublished: string[]; at: Date };

export function cloudflareRanges(seen: CloudflareRangesSeen): Reading {
  const key = 'cloudflare_ranges';
  const threshold = CLOUDFLARE_RANGES_THRESHOLD;
  if ('configured' in seen) {
    return {
      key,
      level: 'ok',
      observed: null,
      threshold,
      note: 'not compared on this deployment (CLOUDFLARE_RANGES_CHECK=off)',
    };
  }
  const when = seen.at.toISOString().slice(0, 16).replace('T', ' ');
  if ('unreadable' in seen) {
    return {
      key,
      level: 'unknown',
      observed: null,
      threshold,
      note: `Cloudflare's published ranges could not be read at ${when} UTC${detailOf(seen.unreadable)}`,
    };
  }
  const observed = seen.notCommitted.length + seen.noLongerPublished.length;
  const parts: string[] = [];
  if (seen.notCommitted.length > 0) {
    parts.push(
      `published and not in deploy/cloudflare-ranges.caddy: ${seen.notCommitted.join(' ')}`,
    );
  }
  if (seen.noLongerPublished.length > 0) {
    parts.push(
      `in deploy/cloudflare-ranges.caddy and no longer published: ${seen.noLongerPublished.join(' ')}`,
    );
  }
  return {
    key,
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note:
      observed === 0
        ? `the committed list matches Cloudflare's (compared ${when} UTC)`
        : `${parts.join('; ')} (compared ${when} UTC)`,
  };
}

/**
 * The share of the last 24 hours' forecasts a candidate in shadow stored
 * nothing for (T-1165): the call to it failed, which is logged as
 * `forecast.shadow_failed` with the reason. A refusal is an answer and is not
 * counted. Raised only when it failed on every forecast of the day -- one
 * failed call among answers is a timeout, and a candidate is off the
 * critical path by construction (D-140) -- so `degraded` and `failing` are
 * both 100 %. It recovers on the first forecast it answers.
 *
 * `unknown` when it has never answered: nothing is stored, so there is no day
 * to judge and "zero failures" would be a lie; the System page says so. `ok`
 * with no forecast asked of it in the day, and when it has left shadow (so an
 * incident open for it closes).
 */
export const CANDIDATE_SHADOW_THRESHOLD: WatchdogThreshold = {
  unit: 'percent',
  degraded: 100,
  failing: 100,
};

export function candidateShadow(
  version: string,
  seen:
    | { state: 'in_shadow'; health: CandidateShadowHealth | undefined }
    | { state: 'left' }
    | { state: 'unreadable'; reason: string },
): Reading {
  const key = `candidate:${version}`;
  const threshold = CANDIDATE_SHADOW_THRESHOLD;
  if (seen.state === 'left') {
    return { key, level: 'ok', observed: null, threshold, note: 'no longer in shadow' };
  }
  if (seen.state === 'unreadable') {
    return { key, level: 'unknown', observed: null, threshold, note: seen.reason };
  }
  const health = seen.health;
  if (health === undefined || health.first_answered_at === null) {
    return {
      key,
      level: 'unknown',
      observed: null,
      threshold,
      note: 'in shadow and has never answered: no shadow forecast is stored for it',
    };
  }
  const { asked, failed } = health.day;
  if (asked === 0) {
    return {
      key,
      level: 'ok',
      observed: null,
      threshold,
      note: 'no forecast was asked of it in the last 24 hours',
    };
  }
  // Floored, so 99.6 % is not read as every forecast.
  const observed = Math.floor((failed * 100) / asked);
  return {
    key,
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: `${String(failed)} of ${String(asked)} forecasts in the last 24 hours stored nothing for it (the reason is logged as forecast.shadow_failed)`,
  };
}

/**
 * The share of one channel's deliveries in the last hour that failed, once
 * there are at least `DELIVERY_MIN_ATTEMPTS` to judge: `degraded` at 25 %,
 * `failing` at 75 %. A push that fails because a member's browser dropped its
 * subscription is ordinary; a quarter of them failing is not.
 */
export const DELIVERY_THRESHOLD: WatchdogThreshold = {
  unit: 'percent',
  degraded: 25,
  failing: 75,
};
export const DELIVERY_MIN_ATTEMPTS = 3;

export function deliveryChannel(
  channel: 'email' | 'push',
  seen: { configured: false } | { configured: true; sent: number; failed: number },
): Reading {
  const key = `delivery:${channel}`;
  const threshold = DELIVERY_THRESHOLD;
  if (!seen.configured) {
    return {
      key,
      level: 'unknown',
      observed: null,
      threshold,
      note: `no ${channel} provider is configured; notifications stay in the product`,
    };
  }
  const attempts = seen.sent + seen.failed;
  if (attempts < DELIVERY_MIN_ATTEMPTS) {
    return {
      key,
      level: 'ok',
      observed: null,
      threshold,
      note: `${attempts} deliveries in the last hour, too few to judge`,
    };
  }
  const observed = Math.round((1000 * seen.failed) / attempts) / 10;
  return {
    key,
    level: levelOf(observed, threshold),
    observed,
    threshold,
    note: `${seen.failed} of ${attempts} deliveries failed in the last hour`,
  };
}

/**
 * Data-quality findings about a live match (T-821, D-097): open, unreviewed
 * findings about a match live or kicked off in the last six hours, open for
 * ten minutes or more (the data-quality boundary counts them). One is a match
 * whose page contradicts itself right now; three is a feed doing it widely.
 *
 * `unknown` when the sweep has never run or its newest run is older than
 * three of its five-minute intervals: no findings from a sweep that stopped is
 * not a clean bill (rule 4). A sweep that keeps failing is `jobs:data-quality`.
 */
export const DATA_QUALITY_THRESHOLD: WatchdogThreshold = {
  unit: 'count',
  degraded: 1,
  failing: 3,
};
export const DATA_QUALITY_STALE_SECONDS = 15 * MINUTE;

export function dataQuality(seen: { open: number; sweptAt: Date | null }, now: Date): Reading {
  const threshold = DATA_QUALITY_THRESHOLD;
  if (seen.sweptAt === null) {
    return {
      key: 'data_quality',
      level: 'unknown',
      observed: null,
      threshold,
      note: 'the data-quality checks have not run yet',
    };
  }
  const age = Math.round((now.getTime() - seen.sweptAt.getTime()) / 1000);
  if (age > DATA_QUALITY_STALE_SECONDS) {
    return {
      key: 'data_quality',
      level: 'unknown',
      observed: null,
      threshold,
      note: `the newest data-quality sweep is ${Math.floor(age / MINUTE)} minutes old`,
    };
  }
  return {
    key: 'data_quality',
    level: levelOf(seen.open, threshold),
    observed: seen.open,
    threshold,
    note: 'open, unreviewed findings about a match live or kicked off in the last six hours',
  };
}

/**
 * What `backup_run` says about one kind of run (T-805): the newest successful
 * one, and the newest of any outcome. `newest: null` means nothing was ever
 * recorded on this deployment.
 */
export interface RunRecord {
  lastSucceededAt: Date | null;
  newest: { at: Date; ok: boolean; detail: string | null } | null;
}

const DAY = 24 * HOUR;
const NOTE_DETAIL = 300;

function detailOf(detail: string | null): string {
  if (detail === null || detail === '') return '';
  return `: ${detail.length > NOTE_DETAIL ? `${detail.slice(0, NOTE_DETAIL)}...` : detail}`;
}

/**
 * Seconds since the newest successful backup. The backup runs daily
 * (D-032), so `degraded` at 26 hours (one missed day, with slack for a slow
 * one) and `failing` at 50 (two). A newest run that failed is at least
 * `degraded` at once (T-805, D-101): a failed backup reaches an administrator
 * within minutes, not a day later when the age catches up.
 *
 * `unknown` when nothing was ever recorded here -- a development machine, or a
 * server whose timer is not installed -- rather than `ok` because nothing
 * said otherwise; `undefined` when the record itself could not be read.
 */
export const BACKUP_THRESHOLD: WatchdogThreshold = {
  unit: 'seconds',
  degraded: 26 * HOUR,
  failing: 50 * HOUR,
};

export function backup(seen: RunRecord | undefined, now: Date): Reading {
  const threshold = BACKUP_THRESHOLD;
  if (seen === undefined) {
    return {
      key: 'backup',
      level: 'unknown',
      observed: null,
      threshold,
      note: 'the backup record could not be read',
    };
  }
  if (seen.newest === null) {
    return {
      key: 'backup',
      level: 'unknown',
      observed: null,
      threshold,
      note: 'no backup has recorded a result on this deployment (is fmip-backup.timer installed? docs/07-backups.md)',
    };
  }
  if (seen.lastSucceededAt === null) {
    return {
      key: 'backup',
      level: 'failing',
      observed: null,
      threshold,
      note: `no successful backup on record; the newest run failed${detailOf(seen.newest.detail)}`,
    };
  }
  const observed = Math.max(0, Math.round((now.getTime() - seen.lastSucceededAt.getTime()) / 1000));
  const level = levelOf(observed, threshold);
  if (!seen.newest.ok) {
    return {
      key: 'backup',
      level: level === 'failing' ? 'failing' : 'degraded',
      observed,
      threshold,
      note: `the newest backup failed${detailOf(seen.newest.detail)}`,
    };
  }
  return {
    key: 'backup',
    level,
    observed,
    threshold,
    note: 'seconds since the newest successful backup',
  };
}

/**
 * Seconds since the newest restore drill that passed (T-805, D-101). The
 * drill runs on the first Monday of each month (`fmip-restore-drill.timer`),
 * so at most five weeks apart: `degraded` past 35 days (one drill missed),
 * `failing` past 70 (two). A newest drill that failed is `failing` whatever
 * its age: the off-provider copy did not restore, and that is the week's
 * first task (docs/07-backups.md).
 */
export const RESTORE_DRILL_THRESHOLD: WatchdogThreshold = {
  unit: 'seconds',
  degraded: 35 * DAY,
  failing: 70 * DAY,
};

export function restoreDrill(seen: RunRecord | undefined, now: Date): Reading {
  const threshold = RESTORE_DRILL_THRESHOLD;
  const key = 'restore_drill';
  if (seen === undefined) {
    return {
      key,
      level: 'unknown',
      observed: null,
      threshold,
      note: 'the restore drill record could not be read',
    };
  }
  if (seen.newest === null) {
    return {
      key,
      level: 'unknown',
      observed: null,
      threshold,
      note: 'no restore drill has recorded a result on this deployment (is fmip-restore-drill.timer installed? docs/07-backups.md)',
    };
  }
  const observed =
    seen.lastSucceededAt === null
      ? null
      : Math.max(0, Math.round((now.getTime() - seen.lastSucceededAt.getTime()) / 1000));
  if (!seen.newest.ok) {
    return {
      key,
      level: 'failing',
      observed,
      threshold,
      note: `the newest restore drill failed${detailOf(seen.newest.detail)}`,
    };
  }
  return {
    key,
    level: levelOf(observed ?? 0, threshold),
    observed,
    threshold,
    note: 'seconds since the newest restore drill that passed',
  };
}
