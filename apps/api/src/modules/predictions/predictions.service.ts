import { Injectable, Logger } from '@nestjs/common';
import {
  FRIEND_PREDICTIONS_DAYS,
  FRIEND_PREDICTIONS_LIMIT,
  type FriendPredictionsResponse,
  type GroupPredictionCall,
  type Prediction,
  type PredictionHistoryItem,
} from '@fmip/contracts';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileService } from '../profile/profile.service';
import { SocialService } from '../social/social.service';
import { friendAlerts } from './internal/friend-alerts';
import type { HistoryQuery } from './internal/history-query';
import { PostgresPredictionStore, PredictionLockedError } from './internal/prediction-store';
import { validateSubmission } from './internal/validation';

// The module's public surface. Other modules import from this file only.
export { validateSubmission, type PredictionInput, type Validated } from './internal/validation';
export {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  parseHistoryQuery,
  type HistoryQuery,
} from './internal/history-query';
export {
  SettlementService,
  type MemberSettledRecord,
  type SettleOutcome,
  type SettledRecord,
} from './settlement.service';
export { outcomeOf, settleOne, verdictFor, type Verdict } from './internal/settle';

export interface Submitter {
  id: string;
  emailVerified: boolean;
}

export type SubmitOutcome =
  | { kind: 'submitted'; prediction: Prediction }
  | { kind: 'unknown_fixture' }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'email_unverified' }
  | { kind: 'locked'; locksAt: string };

/**
 * The predictions boundary (T-050): a member's stance on a fixture as a
 * series of immutable versions. Blueprint 6.6: only verified members
 * submit; predictions lock at kick-off, checked here against this clock and
 * again in the database against its own (T-051), so a skewed server cannot
 * let a late write through; the final version, its time and its settlement
 * (T-052) remain visible.
 */
@Injectable()
export class PredictionsService {
  /** Replaceable so the lock can be tested at a chosen instant (T-051). */
  clock: () => Date = () => new Date();

  private readonly log = new Logger(PredictionsService.name);

  constructor(
    private readonly store: PostgresPredictionStore,
    private readonly notifications: NotificationsService,
    private readonly social: SocialService,
    private readonly profiles: ProfileService,
  ) {}

  /** A member's predictions, newest kick-off first, with versions and settlement (T-056). */
  history(
    userId: string,
    query: HistoryQuery,
  ): Promise<{ total: number; items: PredictionHistoryItem[] }> {
    return this.store.history(userId, query.limit, query.offset);
  }

  /**
   * What a set of members called one fixture (T-246). Null when there is no
   * such fixture.
   *
   * It takes ids rather than a group, the same way the leaderboard does
   * (D-060): this boundary is handed the members and reads their calls, and
   * never learns what a group is.
   */
  callsOn(
    fixtureId: string,
    userIds: string[],
  ): Promise<{ kickoffAt: Date; locked: boolean; calls: GroupPredictionCall[] } | null> {
    return this.store.callsOn(fixtureId, userIds);
  }

  /**
   * The viewer's friends' recent calls for the homepage (blueprint 2.3, T-942,
   * D-115). Whose calls may be shown is `prediction_history_visibility`,
   * asked of the profile boundary for the whole set at once -- exactly the
   * rule of each friend's own history page (D-063), and no second one. A
   * friend who keeps their history private is never in the answer.
   */
  async friendsRecent(
    viewerId: string,
    now: Date = this.clock(),
  ): Promise<FriendPredictionsResponse> {
    const since = new Date(now.getTime() - FRIEND_PREDICTIONS_DAYS * 86_400_000);
    const friends = await this.social.friendIds(viewerId);
    const visible =
      friends.length === 0
        ? []
        : [...(await this.profiles.predictionHistoryAudience(friends, viewerId)).keys()];
    return {
      predictions: await this.store.recentCalls(
        visible.filter((id) => id !== viewerId),
        since,
        FRIEND_PREDICTIONS_LIMIT,
      ),
      since: since.toISOString(),
    };
  }

  async submit(who: Submitter, fixtureId: string, body: unknown): Promise<SubmitOutcome> {
    if (!who.emailVerified) return { kind: 'email_unverified' };
    const fixture = await this.store.fixtureLock(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };
    if (fixture.kickoffAt.getTime() <= this.clock().getTime()) {
      return { kind: 'locked', locksAt: fixture.kickoffAt.toISOString() };
    }
    const validated = validateSubmission(body);
    if (!validated.ok) return { kind: 'invalid', fields: validated.fields };
    try {
      const prediction = await this.store.submit(who.id, fixtureId, validated.value);
      // A first prediction only: a revision is the same news (T-832).
      if (prediction.versions.length === 1) await this.tellFriends(who.id, fixtureId);
      return { kind: 'submitted', prediction };
    } catch (error: unknown) {
      // The database clock is the authority (T-051): a request that crossed
      // the kick-off instant, or an API clock running behind, ends here.
      if (error instanceof PredictionLockedError) {
        return { kind: 'locked', locksAt: fixture.kickoffAt.toISOString() };
      }
      throw error;
    }
  }

  /**
   * "A friend predicted a match you follow" (blueprint 8.1, T-832, D-100):
   * to each friend who follows the match or predicted it, and may read this
   * member's predictions by the member's own setting (D-063). Never the pick.
   * Never fails the prediction: it is already written.
   */
  private async tellFriends(predictorId: string, fixtureId: string): Promise<void> {
    try {
      const alerts = await friendAlerts(
        {
          friendIds: (userId) => this.social.friendIds(userId),
          interested: (fixture, userIds) => this.store.interested(fixture, userIds),
          mayRead: async (predictor, viewer) =>
            (await this.profiles.predictionHistoryAudience([predictor], viewer)).has(predictor),
        },
        predictorId,
        fixtureId,
      );
      await this.notifications.emitMany(alerts);
    } catch (error) {
      this.log.error(
        `friend_predicted.failed fixture=${fixtureId} member=${predictorId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  own(userId: string, fixtureId: string): Promise<Prediction | null> {
    return this.store.find(userId, fixtureId);
  }
}
