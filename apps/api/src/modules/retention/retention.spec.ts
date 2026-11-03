/** Unit tests of the retention purge: periods, cut-offs, batching and the schedule (T-1715, D-345). */
import { describe, expect, it } from 'vitest';
import type { ActivityService } from '../activity/activity.service';
import type { RetentionStore } from './internal/retention-store';
import { RetentionSchedulerService, RETENTION_SCHEDULE } from './retention-scheduler.service';
import {
  PURGE_BATCH_SIZE,
  PURGE_MAX_BATCHES,
  RETENTION_DAYS,
  RetentionService,
  purgeCutoffs,
  purgeInBatches,
} from './retention.service';

const NOW = new Date('2026-11-02T03:23:00Z');

describe('retention periods (D-345)', () => {
  it('are the maintainer’s option A', () => {
    expect(RETENTION_DAYS).toEqual({
      expiredSession: 30,
      expiredEmailToken: 7,
      notificationDelivery: 90,
    });
    expect(PURGE_BATCH_SIZE).toBe(5_000);
  });

  it('puts each cut-off that many whole days before the run', () => {
    expect(purgeCutoffs(NOW)).toEqual({
      sessions: new Date('2026-10-03T03:23:00Z'),
      emailTokens: new Date('2026-10-26T03:23:00Z'),
      deliveries: new Date('2026-08-04T03:23:00Z'),
    });
  });
});

describe('purgeInBatches', () => {
  /** A step over `total` rows that deletes up to `limit` per call. */
  function table(total: number) {
    let left = total;
    const limits: number[] = [];
    const step = async (limit: number) => {
      limits.push(limit);
      const n = Math.min(left, limit);
      left -= n;
      return n;
    };
    return { step, limits, left: () => left };
  }

  it('stops after one statement when there is nothing to delete', async () => {
    const t = table(0);
    expect(await purgeInBatches(t.step, 5)).toEqual({ deleted: 0, batches: 1, capped: false });
  });

  it('deletes in batches of the given size until a batch comes back short', async () => {
    const t = table(12);
    expect(await purgeInBatches(t.step, 5)).toEqual({ deleted: 12, batches: 3, capped: false });
    expect(t.limits).toEqual([5, 5, 5]);
    expect(t.left()).toBe(0);
  });

  it('runs one empty statement after an exact multiple, to know nothing is left', async () => {
    const t = table(10);
    expect(await purgeInBatches(t.step, 5)).toEqual({ deleted: 10, batches: 3, capped: false });
  });

  it('stops at the batch cap and says so, leaving the rest for the next run', async () => {
    const t = table(100);
    expect(await purgeInBatches(t.step, 5, 4)).toEqual({ deleted: 20, batches: 4, capped: true });
    expect(t.left()).toBe(80);
  });

  it('uses the production batch size and cap by default', async () => {
    const t = table(PURGE_BATCH_SIZE + 1);
    const outcome = await purgeInBatches(t.step);
    expect(t.limits).toEqual([PURGE_BATCH_SIZE, PURGE_BATCH_SIZE]);
    expect(outcome).toEqual({ deleted: PURGE_BATCH_SIZE + 1, batches: 2, capped: false });
    expect(PURGE_MAX_BATCHES * PURGE_BATCH_SIZE).toBeGreaterThanOrEqual(10_000_000);
  });

  it('lets a failing statement fail the run rather than report a partial count as whole', async () => {
    const step = async () => {
      throw new Error('deadlock detected');
    };
    await expect(purgeInBatches(step, 5)).rejects.toThrow('deadlock detected');
  });
});

describe('RetentionService.purge', () => {
  it('hands each table its own cut-off and batch size, and reports every count', async () => {
    const calls: { method: string; cutoff: string; limit: number }[] = [];
    const rows: Record<string, number> = {
      deleteSessions: 7,
      deleteConsoleSessions: 1,
      deleteEmailTokens: 0,
      rollUpDeliveries: PURGE_BATCH_SIZE + 3,
    };
    const store = Object.fromEntries(
      Object.keys(rows).map((method) => [
        method,
        async (cutoff: Date, limit: number) => {
          calls.push({ method, cutoff: cutoff.toISOString(), limit });
          const n = Math.min(rows[method] ?? 0, limit);
          rows[method] = (rows[method] ?? 0) - n;
          return n;
        },
      ]),
    ) as unknown as RetentionStore;

    const activity = {
      keepDailyCounts: async (sessionsBefore: Date) => {
        calls.push({ method: 'keepDailyCounts', cutoff: sessionsBefore.toISOString(), limit: 0 });
        return 2;
      },
    } as unknown as ActivityService;

    const report = await new RetentionService(store, activity).purge(NOW);

    expect(report.ran_at).toBe(NOW.toISOString());
    expect(report.activity_days_kept).toBe(2);
    expect(report.sessions).toEqual({ deleted: 7, batches: 1, capped: false });
    expect(report.console_sessions).toEqual({ deleted: 1, batches: 1, capped: false });
    expect(report.email_tokens).toEqual({ deleted: 0, batches: 1, capped: false });
    expect(report.notification_deliveries).toEqual({
      deleted: PURGE_BATCH_SIZE + 3,
      batches: 2,
      capped: false,
    });
    expect(calls).toEqual([
      // The day counts are kept first, with the sessions' own cut-off (D-353).
      { method: 'keepDailyCounts', cutoff: '2026-10-03T03:23:00.000Z', limit: 0 },
      { method: 'deleteSessions', cutoff: '2026-10-03T03:23:00.000Z', limit: PURGE_BATCH_SIZE },
      {
        method: 'deleteConsoleSessions',
        cutoff: '2026-10-03T03:23:00.000Z',
        limit: PURGE_BATCH_SIZE,
      },
      { method: 'deleteEmailTokens', cutoff: '2026-10-26T03:23:00.000Z', limit: PURGE_BATCH_SIZE },
      { method: 'rollUpDeliveries', cutoff: '2026-08-04T03:23:00.000Z', limit: PURGE_BATCH_SIZE },
      { method: 'rollUpDeliveries', cutoff: '2026-08-04T03:23:00.000Z', limit: PURGE_BATCH_SIZE },
    ]);
  });
});

describe('RetentionService.purge and the day counts (D-353)', () => {
  it('deletes nothing when keeping the day counts fails', async () => {
    const called: string[] = [];
    const store = new Proxy(
      {},
      {
        get: (_target, method) => async () => {
          called.push(String(method));
          return 0;
        },
      },
    ) as unknown as RetentionStore;
    const activity = {
      keepDailyCounts: async () => {
        throw new Error('connection terminated');
      },
    } as unknown as ActivityService;
    await expect(new RetentionService(store, activity).purge(NOW)).rejects.toThrow(
      'connection terminated',
    );
    expect(called).toEqual([]);
  });
});

describe('the retention schedule', () => {
  it('runs once a day, in UTC, only where INGESTION_SCHEDULE is on', () => {
    expect(RETENTION_SCHEDULE).toBe('23 3 * * *');
    expect(RetentionSchedulerService.enabled({})).toBe(false);
    expect(RetentionSchedulerService.enabled({ INGESTION_SCHEDULE: 'off' })).toBe(false);
    expect(RetentionSchedulerService.enabled({ INGESTION_SCHEDULE: ' ON ' })).toBe(true);
  });
});
