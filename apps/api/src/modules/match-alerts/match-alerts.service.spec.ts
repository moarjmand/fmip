import { describe, expect, it } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service';
import type { MatchAlertsStore, PendingAlert } from './internal/match-alerts-store';
import { MatchAlertsService } from './match-alerts.service';

/**
 * Carrying a run's alerts (T-834): a pass reads a page (500 for match
 * alerts), so a run that told more members than that passes again until they
 * have nothing due. Since T-901 that loop is the notifications' `drain`
 * (its passes are proven in `drain.spec.ts`); here, that the run hands it
 * its members, its page and its bound, and that a failed drain stays inside
 * the run.
 */
function service(drain: () => Promise<unknown> = () => Promise.resolve()) {
  const calls: unknown[][] = [];
  const notifications = {
    drain: (...args: unknown[]) => {
      calls.push(args);
      return drain();
    },
  } as unknown as NotificationsService;
  return { alerts: new MatchAlertsService({} as MatchAlertsStore, notifications), calls };
}

describe('delivering what a run raised', () => {
  it('drains those members in pages of 500, bounded by passes rather than time', async () => {
    const { alerts, calls } = service();
    await alerts.deliver(['a', 'b']);
    expect(calls).toHaveLength(1);
    const [scope, bounds, , page] = calls[0]!;
    expect(scope).toEqual({ userIds: ['a', 'b'] });
    expect(bounds).toEqual({ maxPasses: 200, maxMs: Number.POSITIVE_INFINITY });
    expect(page).toBe(500);
  });

  it('a drain that fails is logged, not thrown into the run', async () => {
    const { alerts } = service(() => Promise.reject(new Error('database away')));
    await expect(alerts.deliver(['a'])).resolves.toBeUndefined();
  });

  it('carries nothing for nobody', async () => {
    const { alerts, calls } = service();
    await alerts.deliver([]);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Expanding pending events (T-835), with a scripted store: what is claimed,
 * who each event goes to, what is marked done, and what a failure leaves.
 */
function expansion(pending: PendingAlert[], options: { failOn?: string } = {}) {
  const queue = [...pending];
  const log = {
    claimedWith: [] as string[][],
    emitted: [] as { key: string; audience: string[] }[],
    expanded: [] as string[],
    released: [] as string[],
    followersAsked: 0,
    carried: [] as string[][],
  };
  const store = {
    claimPending: (keys: string[]) => {
      log.claimedWith.push(keys);
      return Promise.resolve(queue.shift() ?? null);
    },
    followers: () => {
      log.followersAsked += 1;
      return Promise.resolve(['f1', 'f2', 'f3']);
    },
    toldOf: () => Promise.resolve(['f1']),
    markExpanded: (key: string) => {
      log.expanded.push(key);
      return Promise.resolve();
    },
    release: (key: string) => {
      log.released.push(key);
      return Promise.resolve();
    },
  } as unknown as MatchAlertsStore;
  const notifications = {
    emitToAudience: (request: { dedupeKey: string }, audience: string[]) => {
      if (request.dedupeKey === options.failOn) return Promise.resolve(null);
      log.emitted.push({ key: request.dedupeKey, audience });
      // f3 is in their quiet hours: written, held.
      return Promise.resolve({
        now: audience.filter((id) => id !== 'f3'),
        delayed: audience.filter((id) => id === 'f3'),
      });
    },
    drain: (scope: { userIds: string[] }) => {
      log.carried.push(scope.userIds);
      return Promise.resolve({ passes: 1, carried: 0, stopped: 'drained' });
    },
  } as unknown as NotificationsService;
  return { alerts: new MatchAlertsService(store, notifications), log };
}

const goal: PendingAlert = {
  key: 'x:goal',
  fixtureId: 'x',
  kind: 'match_goal',
  withdraws: null,
  retried: false,
};
const red: PendingAlert = {
  key: 'x:red',
  fixtureId: 'x',
  kind: 'match_red_card',
  withdraws: null,
  retried: false,
};
const voided: PendingAlert = {
  key: 'x:goal-void',
  fixtureId: 'x',
  kind: 'match_goal',
  withdraws: 'x:goal',
  retried: false,
};

describe('expanding pending events', () => {
  it('writes each event to its audience, marks it done, and carries those told now once', async () => {
    const { alerts, log } = expansion([goal, red, voided]);
    const result = await alerts.expandPending(['x:goal', 'x:red', 'x:goal-void'], true);
    expect(result).toEqual({ events: 3, told: 2 });
    expect(log.emitted).toEqual([
      { key: 'x:goal', audience: ['f1', 'f2', 'f3'] },
      { key: 'x:red', audience: ['f1', 'f2', 'f3'] },
      // A correction goes to those told of the goal, not the followers.
      { key: 'x:goal-void', audience: ['f1'] },
    ]);
    // The followers of one match are read once per expansion.
    expect(log.followersAsked).toBe(1);
    expect(log.expanded).toEqual(['x:goal', 'x:red', 'x:goal-void']);
    // One drain, after every event: one push per member, not per event.
    expect(log.carried).toEqual([['f1', 'f2']]);
    expect(log.claimedWith.every((keys) => keys.length === 3)).toBe(true);
  });

  it('an event that cannot be written is released, what was written still carried, and the job fails', async () => {
    const { alerts, log } = expansion([goal, red], { failOn: 'x:red' });
    await expect(alerts.expandPending(['x:goal', 'x:red'], true)).rejects.toThrow(/x:red/);
    expect(log.expanded).toEqual(['x:goal']);
    expect(log.released).toEqual(['x:red']);
    expect(log.carried).toEqual([['f1', 'f2']]);
  });

  it('an event a stopped worker had claimed carries its whole audience, since some may be written already', async () => {
    const { alerts, log } = expansion([{ ...goal, retried: true }]);
    await alerts.expandPending(['x:goal'], true);
    // f3's is held by quiet hours; the drain sends only what is due and unclaimed.
    expect(log.carried).toEqual([['f1', 'f2', 'f3']]);
  });

  it('in a job run, the same failure is logged and not thrown', async () => {
    const { alerts, log } = expansion([red], { failOn: 'x:red' });
    await expect(alerts.expandPending(['x:red'], false)).resolves.toEqual({ events: 0, told: 0 });
    expect(log.released).toEqual(['x:red']);
  });
});

describe('dispatching a run', () => {
  it('without a queue, the run expands its own events', async () => {
    const { alerts, log } = expansion([goal]);
    await alerts.dispatch(['x:goal']);
    expect(log.expanded).toEqual(['x:goal']);
    expect(log.claimedWith[0]).toEqual(['x:goal']);
  });

  it('with a queue, the run only hands over the keys', async () => {
    const { alerts, log } = expansion([goal]);
    const added: unknown[] = [];
    (alerts as unknown as { queue: unknown }).queue = {
      add: (_name: string, data: unknown) => {
        added.push(data);
        return Promise.resolve();
      },
    };
    await alerts.dispatch(['x:goal']);
    expect(added).toEqual([{ events: ['x:goal'] }]);
    expect(log.claimedWith).toEqual([]);
  });

  it('a queue that refuses the job: the run expands its events itself', async () => {
    const { alerts, log } = expansion([goal]);
    (alerts as unknown as { queue: unknown }).queue = {
      add: () => Promise.reject(new Error('redis is down')),
    };
    await alerts.dispatch(['x:goal']);
    expect(log.expanded).toEqual(['x:goal']);
  });

  it('a run that recorded nothing hands over nothing', async () => {
    const { alerts, log } = expansion([goal]);
    await alerts.dispatch([]);
    expect(log.claimedWith).toEqual([]);
  });
});
