/**
 * New teammate requests by browser notification (T-1832, D-425): the same Web Push channel and console browsers as the calendar's reminders.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ConsolePushDevice,
  ConsoleCalendarService,
} from '../agents-console/console-calendar.service';
import {
  ConsoleRequestEvents,
  type FiledRequest,
} from '../agents-console/console-request-events.service';
import { DeliveryService } from '../delivery/delivery.service';

/** The notification's text is short: a lock screen shows one or two lines. */
export const ALERT_TITLE_MAX = 60;
export const ALERT_BODY_MAX = 120;

const cut = (text: string, max: number): string => {
  const line = text.split(/\r?\n/)[0]!.trim();
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line;
};

/**
 * What a new request's notification says: who filed it and its title's first
 * line, and where a click goes (the requests page at that card, relative to
 * the console's base like the reminders'). Never the details, the pictures or
 * anything else the request holds.
 */
export function alertOf(request: FiledRequest): { title: string; body: string; url: string } {
  return {
    title: cut(`درخواست تازه از ${request.filer.display_name}`, ALERT_TITLE_MAX),
    body: cut(request.title, ALERT_BODY_MAX),
    url: `requests#r-${request.id}`,
  };
}

/** What one request's notification did. */
export interface AlertRun {
  devices: number;
  delivered: number;
  gone: number;
}

/**
 * When a console person files a request, every OTHER console person who
 * switched «اعلان درخواست‌های تازه» on gets it on each browser they switched
 * on for reminders; the filer never does. Registered with `agents-console`'s
 * `ConsoleRequestEvents` at start, so it runs after the request is saved and
 * apart from its answer. A browser the push service says is gone is removed,
 * as for the reminders; any other failure is counted, never thrown.
 */
@Injectable()
export class ConsoleRequestAlerts implements OnModuleInit {
  private readonly log = new Logger('ConsoleRequestAlerts');

  constructor(
    private readonly calendar: ConsoleCalendarService,
    private readonly delivery: DeliveryService,
    private readonly events: ConsoleRequestEvents,
  ) {}

  onModuleInit(): void {
    this.events.listen((request) => this.send(request));
  }

  async send(request: FiledRequest): Promise<AlertRun> {
    if (this.delivery.pushKey() === null) return { devices: 0, delivered: 0, gone: 0 };
    const devices: ConsolePushDevice[] = await this.calendar.requestAlertDevices(request.filer.id);
    const message = alertOf(request);
    let delivered = 0;
    let gone = 0;
    for (const device of devices) {
      // The filer's own browsers are never among them; this is the second guard.
      if (device.user_id === request.filer.id) continue;
      try {
        const outcome = await this.delivery.pushTo(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          message,
        );
        if (outcome === 'sent') {
          delivered += 1;
          await this.calendar.deviceUsed(device.id);
        } else if (outcome === 'gone') {
          gone += 1;
          await this.calendar.deviceGone(device.id);
        }
      } catch {
        // One browser's failure does not stop the others.
      }
    }
    this.log.log('new-request notification sent', {
      event: 'console_request.alerted',
      request_id: request.id,
      devices: devices.length,
      delivered,
      gone,
    });
    return { devices: devices.length, delivered, gone };
  }
}
