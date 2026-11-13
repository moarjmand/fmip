import type { ConsoleMe } from '@fmip/contracts';
import { describe, expect, it, vi } from 'vitest';
import type {
  ConsoleCalendarService,
  ConsolePushDevice,
} from '../agents-console/console-calendar.service';
import {
  ConsoleRequestEvents,
  type FiledRequest,
} from '../agents-console/console-request-events.service';
import type { DeliveryService } from '../delivery/delivery.service';
import { ALERT_BODY_MAX, ConsoleRequestAlerts, alertOf } from './console-request-alerts.service';

/**
 * New-request notifications (T-1832, D-425), without a database: what the
 * notification says and where it opens, that the filer is never sent one,
 * that a gone browser is removed and a failing one does not stop the rest,
 * that nothing goes without push configured, and that a listener's failure
 * never reaches the request.
 */

const filer: ConsoleMe = { id: 'u-filer', username: 'mostafa', display_name: 'مصطفی' };
const filed = (overrides: Partial<FiledRequest> = {}): FiledRequest => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  title: 'جدول لیگ آمریکا دو کنفرانس شود',
  filer,
  ...overrides,
});
const device = (id: string, user: string): ConsolePushDevice => ({
  id,
  user_id: user,
  endpoint: `https://push.example/${id}`,
  p256dh: 'B'.repeat(87),
  auth: 'a'.repeat(22),
});

function harness(
  devices: ConsolePushDevice[],
  outcomes: Record<string, 'sent' | 'gone' | 'failed' | 'throw'> = {},
  key: string | null = 'BKEY',
) {
  const calendar = {
    requestAlertDevices: vi.fn(async (_filer: string) => devices),
    deviceUsed: vi.fn(async () => undefined),
    deviceGone: vi.fn(async () => undefined),
  };
  const pushTo = vi.fn(async (subscription: { endpoint: string }, _message: unknown) => {
    const outcome = outcomes[subscription.endpoint.split('/').pop()!] ?? 'sent';
    if (outcome === 'throw') throw new Error('network');
    return outcome;
  });
  const delivery = { pushKey: () => key, pushTo };
  const events = new ConsoleRequestEvents();
  const alerts = new ConsoleRequestAlerts(
    calendar as unknown as ConsoleCalendarService,
    delivery as unknown as DeliveryService,
    events,
  );
  alerts.onModuleInit();
  return { alerts, calendar, pushTo, events };
}

describe('the notification', () => {
  it("names the filer, carries the title's first line, and opens the request's card", () => {
    expect(alertOf(filed({ title: 'خط اول\nخط دوم' }))).toEqual({
      title: 'درخواست تازه از مصطفی',
      body: 'خط اول',
      url: 'requests#r-0f8fad5b-d9cb-469f-a165-70867728950e',
    });
  });

  it('keeps a long title short', () => {
    const body = alertOf(filed({ title: 'ب'.repeat(300) })).body;
    expect([...body]).toHaveLength(ALERT_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('sending', () => {
  it('asks for the browsers of everyone but the filer, and never sends to the filer', async () => {
    const { alerts, calendar, pushTo } = harness([
      device('d1', 'u-mate'),
      // Even if a filer's browser came back, it is skipped.
      device('d2', filer.id),
    ]);
    const run = await alerts.send(filed());
    expect(calendar.requestAlertDevices).toHaveBeenCalledWith(filer.id);
    expect(pushTo).toHaveBeenCalledTimes(1);
    expect(pushTo.mock.calls[0]![0].endpoint).toBe('https://push.example/d1');
    expect(pushTo.mock.calls[0]![1]).toEqual(alertOf(filed()));
    expect(run).toEqual({ devices: 2, delivered: 1, gone: 0 });
    expect(calendar.deviceUsed).toHaveBeenCalledWith('d1');
  });

  it('removes a gone browser and goes on past a failing one', async () => {
    const { alerts, calendar, pushTo } = harness(
      [device('d1', 'u-a'), device('d2', 'u-b'), device('d3', 'u-c')],
      { d1: 'gone', d2: 'throw' },
    );
    const run = await alerts.send(filed());
    expect(pushTo).toHaveBeenCalledTimes(3);
    expect(calendar.deviceGone).toHaveBeenCalledWith('d1');
    expect(calendar.deviceUsed).toHaveBeenCalledWith('d3');
    expect(run).toEqual({ devices: 3, delivered: 1, gone: 1 });
  });

  it('sends nothing when push is not configured', async () => {
    const { alerts, calendar, pushTo } = harness([device('d1', 'u-a')], {}, null);
    expect(await alerts.send(filed())).toEqual({ devices: 0, delivered: 0, gone: 0 });
    expect(calendar.requestAlertDevices).not.toHaveBeenCalled();
    expect(pushTo).not.toHaveBeenCalled();
  });

  it('is what a filed request triggers, through the events', async () => {
    const { events, pushTo } = harness([device('d1', 'u-a')]);
    await events.filed(filed());
    expect(pushTo).toHaveBeenCalledTimes(1);
  });
});

describe('the events', () => {
  it('does nothing with no listener (the command line)', async () => {
    await expect(new ConsoleRequestEvents().filed(filed())).resolves.toBeUndefined();
  });

  it("returns before the listener's work and swallows its failure", async () => {
    const events = new ConsoleRequestEvents();
    let started = false;
    events.listen(async () => {
      started = true;
      throw new Error('push service down');
    });
    const done = events.filed(filed());
    // Nothing has run yet: the caller is answered first.
    expect(started).toBe(false);
    await expect(done).resolves.toBeUndefined();
    expect(started).toBe(true);
  });
});
