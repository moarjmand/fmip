import { Injectable } from '@nestjs/common';
import type { ConsoleMe } from '@fmip/contracts';
import { isoToDay, wallClock } from '@fmip/contracts/console';
import { type DueReminder, dueReminders } from './internal/calendar-rules';
import { type ConsolePushDevice, PostgresCalendarStore } from './internal/calendar-store';

export type { ConsolePushDevice, DueReminder };

/**
 * The calendar's public face (T-1788, D-391) for the `console-reminders`
 * module, which sends the reminders and keeps the browsers that take them:
 * which reminders are due, the claim that sends each once, and the push
 * devices. The tables stay this module's.
 */
@Injectable()
export class ConsoleCalendarService {
  constructor(private readonly store: PostgresCalendarStore) {}

  /** The reminders due at `now`, by the team's clock. */
  async due(now: Date): Promise<DueReminder[]> {
    const today = isoToDay(wallClock(now).date);
    if (today === null) return [];
    return dueReminders(await this.store.remindable(), now, today);
  }

  claim(eventId: string, day: string): Promise<boolean> {
    return this.store.claimReminder(eventId, day);
  }

  sent(eventId: string, day: string, devices: number, delivered: number): Promise<void> {
    return this.store.reminderSent(eventId, day, devices, delivered);
  }

  devices(userId?: string): Promise<ConsolePushDevice[]> {
    return this.store.devices(userId);
  }

  deviceCount(userId: string): Promise<number> {
    return this.store.deviceCount(userId);
  }

  addDevice(
    actor: ConsoleMe,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<void> {
    return this.store.addDevice(actor, subscription, userAgent);
  }

  removeDevice(actor: ConsoleMe, endpoint: string): Promise<boolean> {
    return this.store.removeDevice(actor, endpoint);
  }

  /** T-1832 (D-425): the browsers that take a new request's notification, never the filer's. */
  requestAlertDevices(filer: string): Promise<ConsolePushDevice[]> {
    return this.store.requestAlertDevices(filer);
  }

  requestAlerts(userId: string): Promise<boolean> {
    return this.store.requestAlerts(userId);
  }

  setRequestAlerts(actor: ConsoleMe, on: boolean): Promise<void> {
    return this.store.setRequestAlerts(actor, on);
  }

  deviceUsed(id: string): Promise<void> {
    return this.store.deviceUsed(id);
  }

  deviceGone(id: string): Promise<void> {
    return this.store.deviceGone(id);
  }
}
