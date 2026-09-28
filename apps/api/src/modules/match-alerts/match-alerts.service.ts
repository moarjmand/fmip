import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MATCH_ALERT_KINDS, notificationLine, notificationPath } from '@fmip/contracts';
import {
  type DueNotification,
  NotificationsService,
  type OutboundMessages,
} from '../notifications/notifications.service';
import { MatchAlertsStore, type MatchReading } from './internal/match-alerts-store';
import { batchBody, deriveMatchEvents, eventLine, keyEvents } from './internal/match-events';

/** The push's title, as every notification's is. */
const PUSH_TITLE = 'FMIP';

/**
 * Match alerts (blueprint 12.2, T-830, D-098).
 *
 * The live ingestion hands over two readings of a match -- before and after
 * one write -- and this turns the difference into events (`match-events.ts`),
 * records each once in `match_alert`, and tells every member who follows
 * either team or the competition through `NotificationsService.emit`, which
 * applies their kind preference, their team, competition and category mutes,
 * and their quiet hours. The event key is the notification's dedupe key, so a
 * retry, a replay or a second process reaches nobody twice.
 *
 * **A disallowed goal is a correction, and only to those told.** It goes to
 * the members who hold a notification for the goal it withdraws; a member
 * who never heard of the goal is not told it did not happen.
 *
 * **It never fails the ingestion.** Every public method catches and logs:
 * a match's score is the product, and an alert about it is a consequence.
 */
@Injectable()
export class MatchAlertsService implements OnModuleInit {
  private readonly log = new Logger(MatchAlertsService.name);

  constructor(
    private readonly store: MatchAlertsStore,
    private readonly notifications: NotificationsService,
  ) {}

  /** A member's alerts of one pass leave as one push (T-830's burst rule). */
  onModuleInit(): void {
    this.notifications.registerBatch(MATCH_ALERT_KINDS, (due) => composeBatch(due));
  }

  /** The match as it stands before a write; null when it cannot be read, and then nothing is derived. */
  async before(fixtureId: string): Promise<MatchReading | null> {
    try {
      return await this.store.reading(fixtureId);
    } catch (error) {
      this.fault('read', fixtureId, error);
      return null;
    }
  }

  /**
   * After the write: the events between the two readings, recorded and
   * emitted. Returns the members whose notification was written for now
   * (not held by quiet hours), for the caller to carry at the end of its run.
   */
  async after(before: MatchReading, hints: { halfTimeBreak?: boolean } = {}): Promise<string[]> {
    try {
      const after = await this.store.reading(before.fixtureId);
      if (after === null) return [];
      const events = deriveMatchEvents(before.state, after.state, hints);
      if (events.length === 0) return [];
      const keyed = keyEvents(before.fixtureId, events, await this.store.history(before.fixtureId));

      const told = new Set<string>();
      let followers: string[] | null = null;
      for (const entry of keyed) {
        const line = eventLine(entry.event, after.teams, after.state);
        // Recorded before anyone is told, so a second process racing this
        // one loses here rather than at every member's dedupe index.
        const recorded = await this.store.record({
          key: entry.key,
          fixtureId: before.fixtureId,
          kind: entry.kind,
          withdraws: entry.withdraws,
          line,
        });
        if (!recorded) continue;
        const audience =
          entry.withdraws === null
            ? (followers ??= await this.store.followers(before.fixtureId))
            : await this.store.toldOf(entry.withdraws);
        const outcomes = await this.notifications.emitMany(
          audience.map((userId) => ({
            userId,
            kind: entry.kind,
            subjectType: 'fixture' as const,
            subjectId: before.fixtureId,
            dedupeKey: entry.key,
          })),
        );
        outcomes.forEach((outcome, index) => {
          const userId = audience[index];
          if (outcome === 'sent' && userId !== undefined) told.add(userId);
        });
      }
      return [...told];
    } catch (error) {
      this.fault('derive', before.fixtureId, error);
      return [];
    }
  }

  /**
   * Carry what a run emitted now, scoped to those members, rather than on
   * the five-minute timer: a goal that arrives five minutes late has been
   * seen on television. One push per member per run (the batch).
   */
  async deliver(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.notifications.carry({ userIds });
    } catch (error) {
      this.log.error(
        `match_alert.deliver_failed members=${String(userIds.length)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private fault(step: string, fixtureId: string, error: unknown): void {
    this.log.error(
      `match_alert.${step}_failed fixture=${fixtureId}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

/**
 * One member's due match alerts as one message: a single alert is its own
 * line and opens its match; several are the first lines and a count, and
 * open the match when they are all about one, the inbox otherwise.
 */
export function composeBatch(due: DueNotification[]): OutboundMessages | null {
  const first = due[0];
  if (first === undefined) return null;
  const lines = due.map((item) =>
    notificationLine({
      kind: item.kind as (typeof MATCH_ALERT_KINDS)[number],
      source: null,
      headline: item.headline,
    }),
  );
  const oneMatch = due.every((item) => item.subject_id === first.subject_id);
  const path = oneMatch
    ? notificationPath(first.locale, {
        subject_type: 'fixture',
        subject_id: first.subject_id,
        subject_label: null,
      })
    : null;
  const body = batchBody(lines);
  return {
    // E-mail is not for a minute-by-minute stream: a match alert is a push
    // and an inbox row (D-098).
    email: null,
    push: {
      userId: first.user_id,
      title: PUSH_TITLE,
      body,
      url: path ?? `/${first.locale}/notifications`,
    },
  };
}
