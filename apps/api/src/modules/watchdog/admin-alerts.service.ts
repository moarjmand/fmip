import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminAlertsReport, AlertChannelOutcomes, WatchdogEvent } from '@fmip/contracts';
import { DeliveryService } from '../delivery/delivery.service';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AlertCursor } from './internal/alert-cursor';
import { WatchdogStore } from './internal/watchdog-store';

/** The cursor the delivery reads and moves; `PostgresAlertCursor` in the module. */
export const ALERT_CURSOR = Symbol('ALERT_CURSOR');

/** Alert events one delivery takes at most; the next tick takes the rest. */
export const ALERT_BATCH = 100;
const REPORT_ALERTS = 20;

/** What one delivery did. `stuck`: it stopped at an event whose notification could not be written. */
export interface AlertRun {
  delivered: number;
  administrators: number;
  stuck: boolean;
}

/** The notification's dedupe key: one per administrator per event, whatever runs twice. */
export function alertDedupeKey(eventId: number): string {
  return `watchdog_event:${eventId}`;
}

/**
 * The watchdog's alerts delivered to administrators (T-802, D-096).
 *
 * Each `raised` and `recovered` event (`WatchdogService.alertsAfter`) becomes
 * a `system_alert` notification for every active administrator, which the
 * inbox shows at once and the delivery port carries by Web Push and e-mail
 * where this deployment has them and the administrator has a device or an
 * address. The kind ignores quiet hours (`QUIET_HOURS_EXEMPT`).
 *
 * **Once, and none dropped.** A run holds the delivery's advisory lock, so a
 * second process or an overlapping tick skips rather than reading the same
 * cursor. It writes the notifications for each event in order, then moves
 * the cursor to the last event whose notifications all exist, in the same
 * transaction that held the lock. A run that dies between writing and
 * committing leaves the cursor behind; the next run writes those events
 * again and each notification's dedupe key (`watchdog_event:<id>`, unique per
 * administrator) makes the second write nothing. A write that fails stops
 * the run at that event, so nothing after it is skipped past. Push and
 * e-mail leave through `carry`, which claims each notification before
 * sending, so a device is not buzzed twice either.
 */
@Injectable()
export class AdminAlertsService {
  private readonly log = new Logger('WatchdogAlerts');

  constructor(
    private readonly store: WatchdogStore,
    private readonly notifications: NotificationsService,
    private readonly identity: IdentityService,
    private readonly delivery: DeliveryService,
    @Inject(ALERT_CURSOR) private readonly cursor: AlertCursor,
  ) {}

  /** Delivers every alert after the cursor. `null` when another delivery held the lock. */
  async deliver(): Promise<AlertRun | null> {
    const run = await this.cursor.withCursor(async (lastId, advance) => {
      const events = await this.store.alertsAfter(lastId, ALERT_BATCH);
      if (events.length === 0) return { delivered: 0, admins: [] as string[], stuck: false };
      const admins = await this.identity.holdersOf('admin');
      if (admins.length === 0) {
        // Nobody to tell is a state the System page shows; holding the cursor
        // would only replay the past into the first administrator's inbox.
        this.log.error('watchdog alerts with no administrator to deliver them to', {
          event: 'watchdog.alert_no_admin',
          events: events.length,
        });
      }
      let reached = lastId;
      let delivered = 0;
      let stuck = false;
      for (const event of events) {
        const outcomes = await this.notifications.emitMany(
          admins.map((userId) => ({
            userId,
            kind: 'system_alert' as const,
            subjectType: 'watchdog_event' as const,
            subjectId: String(event.id),
            dedupeKey: alertDedupeKey(event.id),
          })),
        );
        if (outcomes.includes('failed')) {
          stuck = true;
          this.log.error(`watchdog alert ${event.id} could not be written; delivery stops there`, {
            event: 'watchdog.alert_stuck',
            alert: event.id,
          });
          break;
        }
        reached = event.id;
        delivered += 1;
      }
      if (reached > lastId) await advance(reached);
      return { delivered, admins, stuck };
    });

    if (run === null) return null;
    // Out of the building now rather than on the five-minute timer: an outage
    // alert that waits for the timer is five minutes later than it needs to be.
    if (run.delivered > 0 && run.admins.length > 0) {
      await this.notifications.carry({ userIds: run.admins });
    }
    return { delivered: run.delivered, administrators: run.admins.length, stuck: run.stuck };
  }

  /** `GET /admin/health/alerts`: the channels, the cursor, and where each recent alert went. */
  async report(now: Date = new Date()): Promise<AdminAlertsReport> {
    const cursor = await this.cursor.read();
    const [admins, pending, events] = await Promise.all([
      this.identity.holdersOf('admin'),
      this.store.alertsPendingAfter(cursor.lastEventId),
      this.store.alertsUpTo(cursor.lastEventId, REPORT_ALERTS),
    ]);
    const outcomes = await this.notifications.outcomesFor(
      'system_alert',
      events.map((e) => String(e.id)),
    );
    const channels = this.delivery.describe();
    return {
      generated_at: now.toISOString(),
      channels: {
        push: channels.push.state,
        email: channels.email.state,
        in_product_only: channels.in_product_only,
      },
      administrators: admins.length,
      cursor: {
        last_event_id: cursor.lastEventId,
        advanced_at: cursor.advancedAt?.toISOString() ?? null,
      },
      pending,
      alerts: events.map((event: WatchdogEvent) => {
        const found = outcomes.get(String(event.id));
        return {
          event,
          inbox: found?.written ?? 0,
          push: found?.push ?? NONE,
          email: found?.email ?? NONE,
        };
      }),
    };
  }
}

const NONE: AlertChannelOutcomes = { sent: 0, failed: 0, skipped: 0, absent: 0, pending: 0 };
