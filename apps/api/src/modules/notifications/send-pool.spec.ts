import { afterEach, describe, expect, it } from 'vitest';
import type { OutboundEmail, OutboundPush } from '../delivery/delivery.port';
import type { DeliveryService } from '../delivery/delivery.service';
import type {
  CarriedRecord,
  DeliveryRecord,
  DueNotification,
  PostgresNotificationsStore,
} from './internal/notifications-store';
import { DEFAULT_SEND_CONCURRENCY, inPool, sendConcurrencyFromEnv } from './internal/send-pool';
import { NotificationsService } from './notifications.service';

/**
 * Sending concurrently with a bounded pool (T-836): the pool's arithmetic,
 * the setting, and `carry()` over it with a scripted store and a push
 * channel that takes time -- at most N in flight, each notification claimed
 * and sent once, a member's batch one message, and one failure not stopping
 * the pass.
 */
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the pool', () => {
  it('keeps at most the limit in flight and returns results in order', async () => {
    let inFlight = 0;
    let most = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await tick(5 + (i % 3));
      inFlight -= 1;
      return i;
    });
    expect(await inPool(tasks, 4)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(most).toBe(4);
  });

  it('runs fewer lanes than the limit when there are fewer tasks, and nothing for none', async () => {
    expect(await inPool([() => Promise.resolve('a')], 16)).toEqual(['a']);
    expect(await inPool([], 16)).toEqual([]);
  });

  it('a task that throws stops new tasks and is rethrown once the rest settle', async () => {
    const started: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started.push(i);
      await tick(2);
      if (i === 1) throw new Error('boom');
      return i;
    });
    await expect(inPool(tasks, 2)).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(10);
  });
});

describe('the setting', () => {
  it('defaults to 16 and takes a whole number from 1 to 256', () => {
    expect(sendConcurrencyFromEnv({})).toBe(DEFAULT_SEND_CONCURRENCY);
    expect(DEFAULT_SEND_CONCURRENCY).toBe(16);
    expect(sendConcurrencyFromEnv({ NOTIFICATION_SEND_CONCURRENCY: ' 4 ' })).toBe(4);
    expect(sendConcurrencyFromEnv({ NOTIFICATION_SEND_CONCURRENCY: '1' })).toBe(1);
    expect(sendConcurrencyFromEnv({ NOTIFICATION_SEND_CONCURRENCY: '' })).toBe(16);
  });

  it('refuses anything else rather than quietly sending one at a time', () => {
    for (const bad of ['0', '-3', '2.5', 'sixteen', '257']) {
      expect(() => sendConcurrencyFromEnv({ NOTIFICATION_SEND_CONCURRENCY: bad })).toThrow(
        /NOTIFICATION_SEND_CONCURRENCY/,
      );
    }
  });
});

function due(id: string, userId: string, kind = 'friend_request'): DueNotification {
  return {
    id,
    user_id: userId,
    kind,
    subject_type: 'member',
    subject_id: userId,
    subject_label: 'someone',
    source: 'someone',
    headline: kind === 'match_goal' ? `Goal ${id}` : null,
    email: `${userId}@example.test`,
    locale: 'en',
  };
}

function carrier(rows: DueNotification[], options: { failRecordOf?: string } = {}) {
  const claims = new Set<string>();
  const recorded = new Map<string, DeliveryRecord>();
  const sent: OutboundPush[] = [];
  let inFlight = 0;
  let most = 0;
  const claim = (id: string): boolean => {
    if (claims.has(id)) return false;
    claims.add(id);
    return true;
  };
  const statements = { claims: 0, records: 0 };
  const store = {
    // One statement: the page, and the claims this carrier won on it (T-901).
    claimDue: (limit: number) => {
      statements.claims += 1;
      const page = rows.filter((row) => !claims.has(row.id)).slice(0, limit);
      return Promise.resolve({ due: page.length, claimed: page.filter((row) => claim(row.id)) });
    },
    // One statement: refused whole when one row is refused, as Postgres would.
    recordOutcomes: (records: CarriedRecord[]) => {
      statements.records += 1;
      if (records.some((record) => record.id === options.failRecordOf)) {
        return Promise.reject(new Error('record failed'));
      }
      for (const record of records) recorded.set(record.id, record.outcome);
      return Promise.resolve();
    },
  } as unknown as PostgresNotificationsStore;
  const delivery = {
    describe: () => ({ in_product_only: false }),
    deliver: async (_email: OutboundEmail | null, push: OutboundPush | null) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      // A push service answering in a few milliseconds.
      await tick(3);
      if (push !== null) sent.push(push);
      inFlight -= 1;
      return { email: 'absent', push: push === null ? 'absent' : 'sent' } as const;
    },
  } as unknown as DeliveryService;
  const service = new NotificationsService(store, delivery, 'http://web.test');
  return { service, sent, recorded, statements, most: () => most };
}

describe('carrying over the pool', () => {
  afterEach(() => {
    delete process.env.NOTIFICATION_SEND_CONCURRENCY;
  });

  it('sends concurrently, never more than the setting at once, each notification once', async () => {
    process.env.NOTIFICATION_SEND_CONCURRENCY = '5';
    const rows = Array.from({ length: 40 }, (_, i) => due(`n${String(i)}`, `u${String(i)}`));
    const { service, sent, recorded, most } = carrier(rows);
    // Two passes racing, as the timer and a producer might.
    const [first, second] = await Promise.all([service.carry(), service.carry()]);
    expect((first?.carried ?? 0) + (second?.carried ?? 0)).toBe(40);
    expect(sent).toHaveLength(40);
    expect(new Set(sent.map((push) => push.userId)).size).toBe(40);
    expect(recorded.size).toBe(40);
    expect(most()).toBeLessThanOrEqual(10);
    expect(most()).toBeGreaterThan(1);
  });

  it('a member batch is one message, claimed and recorded on every row', async () => {
    const rows = [
      due('g1', 'fan', 'match_goal'),
      due('g2', 'fan', 'match_goal'),
      due('g3', 'other', 'match_goal'),
    ];
    const { service, sent, recorded } = carrier(rows);
    service.registerBatch(['match_goal'], (items) => ({
      email: null,
      push: {
        userId: items[0]!.user_id,
        title: 'FMIP',
        body: items.map((item) => item.headline).join(' / '),
        url: '/en/notifications',
      },
    }));
    expect(await service.carry()).toEqual({ due: 3, carried: 3 });
    expect(sent.map((push) => `${push.userId}: ${push.body}`).sort()).toEqual([
      'fan: Goal g1 / Goal g2',
      'other: Goal g3',
    ]);
    expect([...recorded.keys()].sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('a page is one claim statement and one record statement, whatever its size (T-901)', async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      due(`n${String(i)}`, `u${String(i % 90)}`, i % 2 === 0 ? 'match_goal' : 'friend_request'),
    );
    const { service, sent, recorded, statements } = carrier(rows);
    service.registerBatch(['match_goal'], (items) => ({
      email: null,
      push: { userId: items[0]!.user_id, title: 'FMIP', body: 'goals', url: '/en/notifications' },
    }));
    expect(await service.carry(undefined, 250)).toEqual({ due: 250, carried: 250 });
    expect(statements).toEqual({ claims: 1, records: 1 });
    expect(recorded.size).toBe(250);
    // 125 friend requests one by one, and the goals one message for each of
    // the 45 members they fell on (the even ids).
    expect(sent).toHaveLength(125 + 45);
  });

  it('one record that fails is logged and the rest of the pass still goes out', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => due(`n${String(i)}`, `u${String(i)}`));
    const { service, sent, recorded, statements } = carrier(rows, { failRecordOf: 'n2' });
    expect(await service.carry()).toEqual({ due: 6, carried: 5 });
    expect(sent).toHaveLength(6);
    expect(recorded.has('n2')).toBe(false);
    // The page's statement was refused, so each was recorded on its own.
    expect(statements.records).toBe(1 + 6);
    // Claimed and not recorded: never sent again.
    expect(await service.carry()).toEqual({ due: 0, carried: 0 });
  });
});
