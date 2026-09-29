import { describe, expect, it, vi } from 'vitest';
import type { DeliveryService } from '../delivery/delivery.service';
import type { PostgresNotificationsStore } from './internal/notifications-store';
import {
  CARRY_PAGE,
  type CarryReport,
  DRAIN_BOUNDS,
  NotificationsService,
} from './notifications.service';

/**
 * `drain()` (T-837): pages until nothing in scope is due, stops when another
 * carrier holds the rest, and yields at its bounds; the timer's tick never
 * runs two drains at once. The pages are scripted -- what one claim does is
 * `claimDue`'s, proven against the database in `carry.http.spec.ts`. Each
 * scripted pass is the page's size (`due`) and how many of it this carrier
 * won (`carried`).
 */
function serviceWith(passes: CarryReport[]): {
  service: NotificationsService;
  carry: ReturnType<typeof vi.fn>;
  events: string[];
} {
  const events: string[] = [];
  let next = 0;
  let sent = 0;
  const carry = vi.fn((page: number, userIds: string[] | null) => {
    const pass = passes[next++] ?? { due: 0, carried: 0 };
    events.push(`claim ${String(next)}`);
    void page;
    void userIds;
    const claimed = Array.from({ length: pass.carried }, (_, i) => ({
      id: `n${String(next)}-${String(i)}`,
      user_id: `u${String(i)}`,
      kind: 'friend_request',
      subject_type: 'member',
      subject_id: 'x',
      subject_label: 'x',
      source: 'x',
      headline: null,
      email: 'x@example.test',
      locale: 'en',
    }));
    return Promise.resolve({ due: pass.due, claimed });
  });
  const store = {
    claimDue: carry,
    recordOutcomes: () => Promise.resolve(),
  } as unknown as PostgresNotificationsStore;
  const delivery = {
    describe: () => ({ in_product_only: false }),
    deliver: async () => {
      sent += 1;
      if (sent % CARRY_PAGE === 1) events.push('send');
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { email: 'absent', push: 'sent' } as const;
    },
  } as unknown as DeliveryService;
  const service = new NotificationsService(store, delivery, 'http://web.test');
  return { service, carry, events };
}

const full: CarryReport = { due: CARRY_PAGE, carried: CARRY_PAGE };

describe('drain', () => {
  it('passes again while a pass found a full page, and stops at the first short one', async () => {
    const { service, carry } = serviceWith([full, full, { due: 37, carried: 37 }]);
    const scope = { userIds: ['a'] };
    expect(await service.drain(scope)).toEqual({ passes: 3, carried: 237, stopped: 'drained' });
    expect(carry).toHaveBeenCalledTimes(3);
    expect(carry).toHaveBeenCalledWith(CARRY_PAGE, ['a']);
  });

  it('claims the next page while this one sends, and never claims past a short page (T-901)', async () => {
    const { service, events } = serviceWith([full, full, { due: 37, carried: 37 }]);
    await service.drain();
    // Page 2 is claimed before page 1 is sent, page 3 before page 2; after
    // the short page 3 nothing more is claimed.
    expect(events).toEqual(['claim 1', 'claim 2', 'send', 'claim 3', 'send', 'send']);
  });

  it('takes the page size it is given', async () => {
    const { service, carry } = serviceWith([
      { due: 500, carried: 500 },
      { due: 12, carried: 12 },
    ]);
    expect(await service.drain(undefined, DRAIN_BOUNDS, Date.now, 500)).toEqual({
      passes: 2,
      carried: 512,
      stopped: 'drained',
    });
    expect(carry).toHaveBeenCalledWith(500, null);
  });

  it('stops when a full page claimed nothing: another carrier holds the rest', async () => {
    const { service } = serviceWith([full, { due: CARRY_PAGE, carried: 0 }, full]);
    expect(await service.drain()).toEqual({ passes: 2, carried: 100, stopped: 'contended' });
  });

  it('yields at the pass bound, leaving the rest due for the timer', async () => {
    const { service, carry } = serviceWith(Array.from({ length: 10 }, () => full));
    expect(await service.drain(undefined, { maxPasses: 4, maxMs: 60_000 })).toEqual({
      passes: 4,
      carried: 400,
      stopped: 'passes',
    });
    expect(carry).toHaveBeenCalledTimes(4);
  });

  it('yields at the time bound, checked between pages, after at least one page', async () => {
    const { service } = serviceWith(Array.from({ length: 10 }, () => full));
    let now = 0;
    // Each reading of the clock is 30 s later: the start, then before each later page.
    const clock = () => (now += 30_000) - 30_000;
    expect(await service.drain(undefined, { maxPasses: 100, maxMs: 60_000 }, clock)).toEqual({
      passes: 2,
      carried: 200,
      stopped: 'time',
    });
  });

  it('carries nothing and says drained when nothing is due', async () => {
    const { service } = serviceWith([]);
    expect(await service.drain()).toEqual({ passes: 1, carried: 0, stopped: 'drained' });
  });
});

describe('the timer tick', () => {
  it('never runs two drains at once, and a failed one does not stop the next', async () => {
    const { service } = serviceWith([]);
    let release: () => void = () => undefined;
    const drain = vi
      .spyOn(service, 'drain')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ passes: 1, carried: 0, stopped: 'drained' });
          }),
      )
      .mockRejectedValueOnce(new Error('database away'))
      .mockResolvedValueOnce({ passes: 1, carried: 5, stopped: 'drained' });
    const first = service.tick();
    expect(await service.tick()).toBeNull();
    release();
    expect(await first).toEqual({ passes: 1, carried: 0, stopped: 'drained' });
    expect(await service.tick()).toBeNull();
    expect(await service.tick()).toEqual({ passes: 1, carried: 5, stopped: 'drained' });
    expect(drain).toHaveBeenCalledTimes(3);
  });
});
