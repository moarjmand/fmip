import { describe, expect, it } from 'vitest';
import { REQUEST_BUDGET_THRESHOLD, requestBudget } from '../watchdog/internal/conditions';
import {
  MAX_REFETCH_SHARE_PERCENT,
  REFETCH_BATCH,
  REFETCH_HEADROOM_PERCENT,
  REFETCH_SHARE_PERCENT,
  UNBUDGETED_REFETCHES_PER_DAY,
  refetchAllowance,
  refetchShare,
} from './ingestion-jobs.service';

/** T-913, D-110: the re-ask queue spends a stated share of the day's budget, and never the rest. */
describe('the re-ask share', () => {
  it('is 5 % unless the deployment says 0 to 10', () => {
    expect(REFETCH_SHARE_PERCENT).toBe(5);
    expect(refetchShare(undefined)).toBe(5);
    expect(refetchShare('')).toBe(5);
    expect(refetchShare(' 8 ')).toBe(8);
    expect(refetchShare('0')).toBe(0);
    for (const raw of ['-1', '2.5', 'lots', String(MAX_REFETCH_SHARE_PERCENT + 1)]) {
      expect(refetchShare(raw)).toBe(REFETCH_SHARE_PERCENT);
    }
  });

  it('carries at most a batch per run and the share per day, and nothing once it is spent', () => {
    const base = { budget: 7000, sharePercent: 5, requestsToday: 1000 };
    expect(refetchAllowance({ ...base, refetchedToday: 0 })).toBe(REFETCH_BATCH);
    expect(refetchAllowance({ ...base, refetchedToday: 345 })).toBe(5);
    expect(refetchAllowance({ ...base, refetchedToday: 350 })).toBe(0);
    expect(refetchAllowance({ ...base, sharePercent: 0, refetchedToday: 0 })).toBe(0);
  });

  it('waits while the day is already near its budget', () => {
    const at = (requestsToday: number) =>
      refetchAllowance({ budget: 7000, sharePercent: 5, requestsToday, refetchedToday: 0 });
    expect(at(4899)).toBe(REFETCH_BATCH);
    expect(at((7000 * REFETCH_HEADROOM_PERCENT) / 100)).toBe(0);
    expect(at(7000)).toBe(0);
  });

  it('without a budget of its own, a fixed number a day', () => {
    const none = { budget: null, sharePercent: 5, requestsToday: 0 };
    expect(refetchAllowance({ ...none, refetchedToday: 0 })).toBe(REFETCH_BATCH);
    expect(refetchAllowance({ ...none, refetchedToday: UNBUDGETED_REFETCHES_PER_DAY })).toBe(0);
  });

  /**
   * The acceptance: the day's budget is never exceeded, and the watchdog's
   * budget condition stays green. Whatever the other jobs spent, and whatever
   * the share, a run the queue is allowed never takes the day from `ok` to
   * `degraded`. It also never takes the day past the ceiling.
   */
  it('never moves the watchdog budget condition off ok, at any share and any budget', () => {
    expect(REFETCH_HEADROOM_PERCENT + MAX_REFETCH_SHARE_PERCENT).toBeLessThanOrEqual(
      REQUEST_BUDGET_THRESHOLD.degraded,
    );
    for (const budget of [100, 500, 7000, 7500]) {
      for (let share = 1; share <= MAX_REFETCH_SHARE_PERCENT; share += 1) {
        // A day of runs: the other jobs spend `step` a run, the queue its allowance.
        for (const step of [0, 7, 40, 150]) {
          let requestsToday = 0;
          let refetchedToday = 0;
          for (let run = 0; run < 48; run += 1) {
            const allowance = refetchAllowance({
              budget,
              sharePercent: share,
              requestsToday,
              refetchedToday,
            });
            const before = requestBudget({ requestsToday, budget }).level;
            requestsToday += allowance;
            refetchedToday += allowance;
            if (allowance > 0) {
              expect(before).toBe('ok');
              expect(requestBudget({ requestsToday, budget }).level).toBe('ok');
            }
            expect(refetchedToday).toBeLessThanOrEqual(Math.floor((budget * share) / 100));
            requestsToday += step;
          }
        }
      }
    }
  });
});
