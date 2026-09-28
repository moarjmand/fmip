import { Injectable } from '@nestjs/common';
import type { ActivityReport } from '@fmip/contracts';
import { ActivityStore } from './internal/activity-store';
import { assemble, sinceOf, utcDays } from './internal/series';

/**
 * Activity counts per UTC day (T-807, blueprint 19). Public surface:
 * `report(days, now)`, what `GET /admin/activity` answers. Counts only, from
 * rows the product already keeps; it records nothing of its own.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly store: ActivityStore) {}

  async report(days: number, now: Date = new Date()): Promise<ActivityReport> {
    const window = utcDays(now, days);
    const rows = await this.store.counts(sinceOf(window));
    return assemble(window, rows, now);
  }
}
