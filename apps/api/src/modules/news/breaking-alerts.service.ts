import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_DEFAULTS } from '@fmip/contracts';
import { NotificationsService } from '../notifications/notifications.service';
import { PostgresBreakingAdminStore } from './internal/breaking-admin-store';

/** How many delivery passes a breaking alert's carry may take before the timer has the rest. */
const MAX_DELIVERY_PASSES = 20;

/**
 * The breaking alert (blueprint 12.2, T-1005, D-125). When an editor marks a
 * story breaking, the members who follow a team, competition or person the
 * story links and switched `breaking_news` on are told, **set-based** as the
 * match alerts are since T-835: the audience is one query and the write is
 * one statement (`NotificationsService.emitToAudience`), which applies the
 * switch, the category, team and competition mutes, quiet hours and the
 * dedupe key to everyone at once. The dedupe key is the story, so a story
 * marked, cleared and marked again is told once. It deep-links to the story.
 *
 * Nothing here throws into the editor's request: the mark is committed
 * before this runs, and an alert that could not be written is logged.
 */
@Injectable()
export class BreakingAlertsService {
  private readonly log = new Logger('BreakingAlerts');

  constructor(
    private readonly store: PostgresBreakingAdminStore,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tells the story's audience once; returns who was written (now or held), or null on failure. */
  async tell(storyId: string): Promise<{ now: string[]; delayed: string[] } | null> {
    try {
      const audience = await this.store.audience(storyId, NOTIFICATION_DEFAULTS.breaking_news);
      const told = await this.notifications.emitToAudience(
        {
          kind: 'breaking_news',
          subjectType: 'story',
          subjectId: storyId,
          dedupeKey: `breaking:${storyId}`,
        },
        audience,
      );
      if (told !== null && told.now.length > 0) void this.deliver(told.now);
      return told;
    } catch (error) {
      this.log.error(
        `breaking.alert_failed story=${storyId}`,
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
        `breaking.deliver_failed members=${String(userIds.length)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
