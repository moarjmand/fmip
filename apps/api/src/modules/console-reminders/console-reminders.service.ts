/**
 * The calendar's reminder run (T-1788, D-391): each due reminder claimed once and sent by Web Push to every console browser switched on.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ConsoleMe } from '@fmip/contracts';
import {
  type ConsolePushDevice,
  ConsoleCalendarService,
} from '../agents-console/console-calendar.service';
import { DeliveryService } from '../delivery/delivery.service';

/** What one reminder run did. */
export interface ReminderRun {
  due: number;
  sent: number;
  devices: number;
}

const TIME_WORDS: Record<number, string> = {
  0: 'همین حالا',
  15: '۱۵ دقیقهٔ دیگر',
  60: 'یک ساعت دیگر',
  1440: 'فردا',
};

/**
 * The calendar's reminders (T-1788, D-391): every minute, each reminder whose
 * time has come is claimed once (`console_reminder_sent`) and sent by Web
 * Push to every device a console person switched reminders on in. A device
 * whose push service says it is gone is removed. The page also lists what
 * went out, so a reminder nobody received is seen, not assumed.
 */
@Injectable()
export class ConsoleReminders {
  private readonly log = new Logger('ConsoleReminders');

  constructor(
    private readonly store: ConsoleCalendarService,
    private readonly delivery: DeliveryService,
  ) {}

  async run(now: Date = new Date()): Promise<ReminderRun> {
    const due = await this.store.due(now);
    if (due.length === 0) return { due: 0, sent: 0, devices: 0 };
    const devices = await this.store.devices();
    let sent = 0;
    for (const reminder of due) {
      if (!(await this.store.claim(reminder.event.id, reminder.day))) continue;
      const when = TIME_WORDS[reminder.event.remind_minutes ?? 0] ?? '';
      const time = reminder.event.time === null ? '' : ` ساعت ${reminder.event.time}`;
      const delivered = await this.send(devices, {
        title: reminder.event.title,
        body: `${when}${time} · یادآور تقویم کنسول`,
        url: `calendar?day=${reminder.day}`,
      });
      await this.store.sent(reminder.event.id, reminder.day, devices.length, delivered);
      sent += 1;
      this.log.log('calendar reminder sent', {
        event: 'console_reminder.sent',
        event_id: reminder.event.id,
        day: reminder.day,
        devices: devices.length,
        delivered,
      });
    }
    return { due: due.length, sent, devices: devices.length };
  }

  /** A test message to the caller's own devices: how many took it. */
  async test(actor: ConsoleMe): Promise<{ devices: number; delivered: number }> {
    const devices = await this.store.devices(actor.id);
    const delivered = await this.send(devices, {
      title: 'یادآور آزمایشی',
      body: 'یادآورهای تقویم کنسول روی این دستگاه می‌رسند.',
      url: 'calendar',
    });
    return { devices: devices.length, delivered };
  }

  private async send(
    devices: readonly ConsolePushDevice[],
    message: { title: string; body: string; url: string },
  ): Promise<number> {
    let delivered = 0;
    for (const device of devices) {
      const outcome = await this.delivery.pushTo(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        message,
      );
      if (outcome === 'sent') {
        delivered += 1;
        await this.store.deviceUsed(device.id);
      } else if (outcome === 'gone') {
        await this.store.deviceGone(device.id);
      }
    }
    return delivered;
  }
}
