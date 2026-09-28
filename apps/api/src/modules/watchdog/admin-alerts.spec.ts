import { describe, expect, it } from 'vitest';
import type { WatchdogEvent } from '@fmip/contracts';
import {
  ADMIN_ONLY_NOTIFICATION_KINDS,
  NOTIFICATION_DEFAULTS,
  QUIET_HOURS_EXEMPT,
  notificationPath,
} from '@fmip/contracts';
import type { DeliveryService } from '../delivery/delivery.service';
import type { IdentityService } from '../identity/identity.service';
import type {
  EmitOutcome,
  EmitRequest,
  NotificationsService,
} from '../notifications/notifications.service';
import { AdminAlertsService, alertDedupeKey } from './admin-alerts.service';
import type { AlertCursor } from './internal/alert-cursor';
import type { WatchdogStore } from './internal/watchdog-store';

// The once-only rule of the alert delivery (T-802), with the database's
// guarantees played by fakes that keep the same promises: a try-lock that a
// second caller cannot take, a cursor that moves only when the transaction
// commits, and a notification that is written once per dedupe key.

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function alert(id: number, kind: 'raised' | 'recovered' = 'raised'): WatchdogEvent {
  return {
    id,
    condition: 'ingest:live',
    at: '2026-09-28T12:00:00.000Z',
    from: kind === 'raised' ? 'ok' : 'failing',
    to: kind === 'raised' ? 'failing' : 'ok',
    kind,
    alert: true,
    incident: id,
    observed: 960,
    note: null,
  };
}

class FakeCursor implements AlertCursor {
  last = 0;
  advancedAt: Date | null = null;
  private held = false;
  /** Throw from the next `advance`, as a process dying before COMMIT would. */
  failNextAdvance = false;

  async withCursor<T>(
    work: (lastEventId: number, advance: (eventId: number) => Promise<void>) => Promise<T>,
  ): Promise<T | null> {
    if (this.held) return null;
    this.held = true;
    try {
      let staged: number | null = null;
      const result = await work(this.last, async (id) => {
        await tick();
        if (this.failNextAdvance) {
          this.failNextAdvance = false;
          throw new Error('connection lost before COMMIT');
        }
        staged = Math.max(this.last, id);
      });
      // COMMIT: only now does the cursor move.
      if (staged !== null) {
        this.last = staged;
        this.advancedAt = new Date();
      }
      return result;
    } finally {
      this.held = false;
    }
  }

  read(): Promise<{ lastEventId: number; advancedAt: Date | null }> {
    return Promise.resolve({ lastEventId: this.last, advancedAt: this.advancedAt });
  }
}

class FakeNotifications {
  /** `user:dedupe` of every notification written. */
  readonly written: string[] = [];
  readonly carried: string[][] = [];
  /** Fail the write for this user and event, once. */
  failOnce: { userId: string; eventId: number } | null = null;

  async emitMany(requests: EmitRequest[]): Promise<EmitOutcome[]> {
    const outcomes: EmitOutcome[] = [];
    for (const request of requests) {
      await tick();
      if (
        this.failOnce !== null &&
        this.failOnce.userId === request.userId &&
        request.dedupeKey === alertDedupeKey(this.failOnce.eventId)
      ) {
        this.failOnce = null;
        outcomes.push('failed');
        continue;
      }
      const key = `${request.userId}:${request.dedupeKey ?? ''}`;
      if (this.written.includes(key)) {
        outcomes.push('duplicate');
        continue;
      }
      this.written.push(key);
      outcomes.push('sent');
    }
    return outcomes;
  }

  carry(scope?: { userIds: string[] }): Promise<{ due: number; carried: number }> {
    this.carried.push(scope?.userIds ?? []);
    return Promise.resolve({ due: 0, carried: 0 });
  }
}

function setup(options: { events: WatchdogEvent[]; admins?: string[] }) {
  const cursor = new FakeCursor();
  const notifications = new FakeNotifications();
  const events = options.events;
  const store = {
    alertsAfter: async (after: number, limit: number) => {
      await tick();
      return events.filter((e) => e.id > after).slice(0, limit);
    },
  } as unknown as WatchdogStore;
  const identity = {
    holdersOf: () => Promise.resolve(options.admins ?? ['a1', 'a2']),
  } as unknown as IdentityService;
  const service = new AdminAlertsService(
    store,
    notifications as unknown as NotificationsService,
    identity,
    {} as DeliveryService,
    cursor,
  );
  return { service, cursor, notifications, events };
}

const each = (admins: string[], ids: number[]): string[] =>
  admins.flatMap((a) => ids.map((id) => `${a}:${alertDedupeKey(id)}`)).sort();

describe('alert delivery (T-802)', () => {
  it('writes each alert once for every administrator and moves the cursor past it', async () => {
    const { service, cursor, notifications } = setup({ events: [alert(3), alert(7, 'recovered')] });
    expect(await service.deliver()).toEqual({ delivered: 2, administrators: 2, stuck: false });
    expect([...notifications.written].sort()).toEqual(each(['a1', 'a2'], [3, 7]));
    expect(cursor.last).toBe(7);
    // Out of the building at once, to the administrators only.
    expect(notifications.carried).toEqual([['a1', 'a2']]);

    // The next tick has nothing new: nothing written, nothing carried.
    expect(await service.deliver()).toEqual({ delivered: 0, administrators: 0, stuck: false });
    expect(notifications.written).toHaveLength(4);
    expect(notifications.carried).toHaveLength(1);
  });

  it('two ticks at once: one delivers, the other skips, and nothing is written twice', async () => {
    const { service, cursor, notifications } = setup({
      events: [alert(1), alert(2, 'recovered'), alert(5)],
    });
    const [first, second] = await Promise.all([service.deliver(), service.deliver()]);
    expect([first, second].filter((run) => run === null)).toHaveLength(1);
    expect(notifications.written).toHaveLength(6);
    expect([...notifications.written].sort()).toEqual(each(['a1', 'a2'], [1, 2, 5]));
    expect(cursor.last).toBe(5);
  });

  it('many overlapping ticks across processes still write each alert once per administrator', async () => {
    const { service, events, notifications } = setup({ events: [alert(1)] });
    const runs: Promise<unknown>[] = [];
    for (let i = 0; i < 8; i += 1) {
      // A new alert arrives between ticks, as the watchdog writes them.
      events.push(alert(10 + i));
      runs.push(service.deliver());
      await tick();
    }
    await Promise.all(runs);
    await service.deliver();
    const ids = events.map((e) => e.id);
    expect([...notifications.written].sort()).toEqual(each(['a1', 'a2'], ids));
    expect(new Set(notifications.written).size).toBe(notifications.written.length);
  });

  it('a run that dies before its commit is repeated without a second notification', async () => {
    const { service, cursor, notifications } = setup({ events: [alert(4), alert(6)] });
    cursor.failNextAdvance = true;
    await expect(service.deliver()).rejects.toThrow('before COMMIT');
    // The notifications exist, the cursor did not move.
    expect(notifications.written).toHaveLength(4);
    expect(cursor.last).toBe(0);

    expect(await service.deliver()).toEqual({ delivered: 2, administrators: 2, stuck: false });
    expect(notifications.written).toHaveLength(4);
    expect(cursor.last).toBe(6);
  });

  it('a write that fails stops the run there, and the next run drops nothing', async () => {
    const { service, cursor, notifications } = setup({ events: [alert(1), alert(2), alert(3)] });
    notifications.failOnce = { userId: 'a2', eventId: 2 };
    expect(await service.deliver()).toEqual({ delivered: 1, administrators: 2, stuck: true });
    // Not past event 2: a later event must never jump the cursor over it.
    expect(cursor.last).toBe(1);

    expect(await service.deliver()).toEqual({ delivered: 2, administrators: 2, stuck: false });
    expect([...notifications.written].sort()).toEqual(each(['a1', 'a2'], [1, 2, 3]));
    expect(cursor.last).toBe(3);
  });

  it('with no administrator it writes nothing and does not hold the past for the first one', async () => {
    const { service, cursor, notifications } = setup({ events: [alert(9)], admins: [] });
    expect(await service.deliver()).toEqual({ delivered: 1, administrators: 0, stuck: false });
    expect(notifications.written).toEqual([]);
    expect(notifications.carried).toEqual([]);
    expect(cursor.last).toBe(9);
  });

  it('takes at most a batch per run and the rest on the next', async () => {
    const events = Array.from({ length: 130 }, (_, i) => alert(i + 1));
    const { service, cursor } = setup({ events, admins: ['a1'] });
    expect((await service.deliver())?.delivered).toBe(100);
    expect(cursor.last).toBe(100);
    expect((await service.deliver())?.delivered).toBe(30);
    expect(cursor.last).toBe(130);
  });
});

describe('the system_alert kind (T-802, D-096)', () => {
  it('is on by default, for administrators only, and ignores quiet hours', () => {
    expect(NOTIFICATION_DEFAULTS.system_alert).toBe(true);
    expect(ADMIN_ONLY_NOTIFICATION_KINDS).toEqual(['system_alert']);
    // The only exemption: every other kind still waits for quiet hours to end.
    expect(QUIET_HOURS_EXEMPT).toEqual(['system_alert']);
  });

  it('opens the System page', () => {
    expect(
      notificationPath('fa', {
        subject_type: 'watchdog_event',
        subject_id: '12',
        subject_label: null,
      }),
    ).toBe('/fa/admin/system');
  });
});
