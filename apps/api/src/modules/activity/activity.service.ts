import { Injectable } from '@nestjs/common';
import type { ActivityReport } from '@fmip/contracts';
import { ActivityStore } from './internal/activity-store';
import { dayStart, daysToRollUp, nextDay } from './internal/daily';
import { assemble, sinceOf, utcDays } from './internal/series';

/**
 * Activity counts per UTC day (T-807, blueprint 19). Public surface:
 * `report(days, now)`, what `GET /admin/activity` answers, and
 * `keepDailyCounts(sessionsBefore)`, which the retention purge calls first.
 * Counts only, from rows the product already keeps; the one thing it records
 * is `activity_daily`, two anonymous numbers per day (T-1727, D-353).
 */
@Injectable()
export class ActivityService {
  constructor(private readonly store: ActivityStore) {}

  async report(days: number, now: Date = new Date()): Promise<ActivityReport> {
    const window = utcDays(now, days);
    const rows = await this.store.counts(sinceOf(window));
    return assemble(window, rows, now);
  }

  /**
   * Before the retention purge deletes the sessions that expired before
   * `sessionsBefore` (T-1727, D-353): keeps the sign-ins and active members
   * of every day up to the latest creation day among them, while all their
   * sessions still exist, so the report reads the same after they go. Returns
   * the days written; a failure throws, and the purge then deletes nothing.
   */
  async keepDailyCounts(sessionsBefore: Date): Promise<number> {
    const days = daysToRollUp(await this.store.rollUpState(sessionsBefore));
    if (days === null) return 0;
    return this.store.rollUp(dayStart(days.from), dayStart(nextDay(days.through)));
  }
}
