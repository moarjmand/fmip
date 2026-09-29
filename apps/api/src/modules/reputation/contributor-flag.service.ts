import { Injectable, Logger } from '@nestjs/common';
import type {
  ContributorFlag,
  ContributorFlagClosure,
  ContributorFlagListResponse,
  GrantStanding,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CONTRIBUTOR_FLAG_RULES,
  flagKey,
  flagPeriodDays,
  planFlags,
} from './internal/contributor-flag';
import { PostgresContributorFlagStore, type FlagRow } from './internal/contributor-flag-store';
import { ELIGIBILITY_V1 } from './internal/eligibility';

/**
 * Contributors below the threshold for a sustained period (blueprint 9.4,
 * T-1031, D-137).
 *
 * **It flags and tells; it never pauses.** There is no call from here to
 * `ContributorService.change`, and there must never be one: a pause is a
 * person's audited act with a reason the member is told (T-250), and a pause
 * the platform performed on arithmetic would be exactly the automatic
 * judgement blueprint 10.2 keeps out.
 */

function flagOf(row: FlagRow): ContributorFlag {
  return {
    id: row.id,
    username: row.username,
    below_since: row.below_since.toISOString(),
    rating_at_flag: Number(row.rating),
    rating_now: row.rating_now === null ? null : Number(row.rating_now),
    threshold: Number(row.threshold),
    period_days: row.period_days,
    rules_version: row.rules_version,
    raised_at: row.raised_at.toISOString(),
    standing: row.standing as GrantStanding,
    closed:
      row.closed_at === null || row.closed_reason === null
        ? null
        : {
            reason: row.closed_reason as ContributorFlagClosure,
            at: row.closed_at.toISOString(),
            by: row.closed_by,
            note: row.close_note,
          },
  };
}

export interface FlagCheckResult {
  raised: number;
  closed: number;
}

@Injectable()
export class ContributorFlagService {
  private readonly log = new Logger(ContributorFlagService.name);
  /** Read once at boot, like every other setting; see `flagPeriodDays`. */
  readonly periodDays = flagPeriodDays();

  constructor(
    private readonly store: PostgresContributorFlagStore,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The daily check: close the flags whose stretch is over, raise one for
   * every live contributor whose current stretch below the threshold has
   * lasted the period, and tell every administrator once per new flag.
   * Recomputable: it reads only the stored ratings and grants (rule 8).
   */
  async check(now: Date, periodDays = this.periodDays): Promise<FlagCheckResult> {
    const threshold = ELIGIBILITY_V1.minRating;
    const [holders, open] = await Promise.all([this.store.liveHolders(), this.store.openFlags()]);
    const ratings = await this.store.ratings([
      ...new Set([...holders.map((h) => h.userId), ...open.map((f) => f.userId)]),
    ]);
    const plan = planFlags(holders, open, ratings, threshold, periodDays, now);

    for (const closure of plan.close) await this.store.close(closure.id, closure.reason);

    let raised = 0;
    const admins = plan.raise.length > 0 ? await this.identity.holdersOf('admin') : [];
    for (const flag of plan.raise) {
      const id = await this.store.raise(flag, threshold, periodDays, CONTRIBUTOR_FLAG_RULES);
      if (id === null) continue;
      raised += 1;
      await this.notifications.emitMany(
        admins
          .filter((admin) => admin !== flag.userId)
          .map((admin) => ({
            userId: admin,
            kind: 'contributor_below_threshold' as const,
            subjectType: 'member' as const,
            subjectId: flag.userId,
            dedupeKey: flagKey(id),
          })),
      );
    }
    if (raised > 0 || plan.close.length > 0) {
      this.log.log('contributor flags checked', {
        event: 'contributor_flag.checked',
        raised,
        closed: plan.close.length,
        period_days: periodDays,
      });
    }
    return { raised, closed: plan.close.length };
  }

  async listOpen(): Promise<ContributorFlagListResponse> {
    return {
      period_days: this.periodDays,
      threshold: ELIGIBILITY_V1.minRating,
      flags: (await this.store.listOpen()).map(flagOf),
    };
  }

  /** Null when there is no open flag with that id. */
  async dismiss(flagId: string, actorId: string, reason: string): Promise<ContributorFlag | null> {
    if (!(await this.store.dismiss(flagId, actorId, reason))) return null;
    const row = await this.store.byId(flagId);
    return row === null ? null : flagOf(row);
  }
}
