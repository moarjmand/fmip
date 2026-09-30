import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_DEFAULTS, type NotificationKind, type StoryType } from '@fmip/contracts';
import { NotificationsService } from '../notifications/notifications.service';
import { PostgresStoryLabelStore } from './internal/story-label-store';

/** How many delivery passes an alert's carry may take before the timer has the rest. */
const MAX_DELIVERY_PASSES = 20;

/**
 * Which story types raise which alert (T-1032, D-166). Every other type
 * raises none: a type says what a story is, and only these two families are
 * what blueprint 12.2 names ("transfers, injuries and suspensions").
 */
export const STORY_TYPE_ALERT_KIND: Partial<Record<StoryType, NotificationKind>> = {
  transfer: 'transfer_news',
  injury: 'availability_news',
  suspension: 'availability_news',
};

/**
 * Transfer and availability alerts (blueprint 12.2, T-1032, D-166). When a
 * story's current type becomes `transfer`, or `injury` or `suspension` --
 * from the publisher's category or an editor, whichever wrote it (D-123) --
 * the members who follow a team or person the story links and switched the
 * kind on are told, set-based as the breaking alert is (D-125): one audience
 * query and one `emitToAudience` statement, so the switch, the category, team
 * and competition mutes, quiet hours and the dedupe key apply as to every
 * kind. The dedupe key is the kind and the story, so a story is told once per
 * kind however often its label is rewritten; a story typed `injury` then
 * `suspension` is told once. The licensed feed's transfer and injury
 * endpoints are never read here (D-166).
 *
 * Nothing here throws into its caller: the label is committed before this
 * runs, and an alert that could not be written is logged.
 */
@Injectable()
export class StoryTypeAlertsService {
  private readonly log = new Logger('StoryTypeAlerts');

  constructor(
    private readonly labels: PostgresStoryLabelStore,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Tells the story's audience once if its current type raises an alert;
   * returns who was written (now or held), an empty result when the type
   * raises none, or null on failure.
   */
  async tell(storyId: string): Promise<{ now: string[]; delayed: string[] } | null> {
    try {
      const label = await this.labels.current(storyId);
      const kind = label === null ? undefined : STORY_TYPE_ALERT_KIND[label.story_type];
      if (kind === undefined) return { now: [], delayed: [] };
      const audience = await this.labels.audience(storyId, kind, NOTIFICATION_DEFAULTS[kind]);
      const told = await this.notifications.emitToAudience(
        { kind, subjectType: 'story', subjectId: storyId, dedupeKey: `${kind}:${storyId}` },
        audience,
      );
      if (told !== null && told.now.length > 0) void this.deliver(told.now);
      return told;
    } catch (error) {
      this.log.error(
        `story_type.alert_failed story=${storyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /** Carries what was written now rather than on the five-minute timer. */
  private async deliver(userIds: string[]): Promise<void> {
    try {
      await this.notifications.drain(
        { userIds },
        { maxPasses: MAX_DELIVERY_PASSES, maxMs: Number.POSITIVE_INFINITY },
      );
    } catch (error) {
      this.log.error(
        `story_type.deliver_failed members=${String(userIds.length)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
