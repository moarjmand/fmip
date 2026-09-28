import { describe, expect, it, vi } from 'vitest';
import type { DeliveryService } from '../delivery/delivery.service';
import type { PostgresNotificationsStore } from './internal/notifications-store';
import { CARRY_PAGE, type CarryReport, NotificationsService } from './notifications.service';

/**
 * `drain()` (T-837): pages until nothing in scope is due, stops when another
 * carrier holds the rest, and yields at its bounds; the timer's tick never
 * runs two drains at once. The passes are scripted -- what one pass does is
 * `carry()`'s, proven against the database in `carry.http.spec.ts`.
 */
function serviceWith(passes: CarryReport[]): {
  service: NotificationsService;
  carry: ReturnType<typeof vi.fn>;
} {
  const service = new NotificationsService(
    {} as PostgresNotificationsStore,
    {} as DeliveryService,
    'http://web.test',
  );
  let next = 0;
  const carry = vi.fn(() => Promise.resolve(passes[next++] ?? { due: 0, carried: 0 }));
  service.carry = carry;
  return { service, carry };
}

const full: CarryReport = { due: CARRY_PAGE, carried: CARRY_PAGE };

describe('drain', () => {
  it('passes again while a pass found a full page, and stops at the first short one', async () => {
    const { service, carry } = serviceWith([full, full, { due: 37, carried: 37 }]);
    const scope = { userIds: ['a'] };
    expect(await service.drain(scope)).toEqual({ passes: 3, carried: 237, stopped: 'drained' });
    expect(carry).toHaveBeenCalledTimes(3);
    expect(carry).toHaveBeenCalledWith(scope);
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
