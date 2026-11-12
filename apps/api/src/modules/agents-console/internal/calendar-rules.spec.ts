import { describe, expect, it } from 'vitest';
import { isoToDay } from '@fmip/contracts/console';
import {
  type RemindableEvent,
  checkEvent,
  checkImport,
  checkSubscription,
  dueReminders,
} from './calendar-rules';

const day = (iso: string): number => isoToDay(iso)!;

describe('checkEvent (T-1788)', () => {
  it('takes a title and a day, and defaults the rest', () => {
    const checked = checkEvent({ title: '  Weekly meeting ', date: '2026-11-09' });
    expect(checked).toEqual({
      ok: true,
      value: {
        title: 'Weekly meeting',
        date: '2026-11-09',
        time: null,
        repeat: 'none',
        basis: 'j',
        repeat_until: null,
        remind_minutes: null,
        note: '',
        color: 'blue',
        subscription_key: null,
      },
    });
  });

  it('refuses what the calendar cannot hold', () => {
    const bad = (body: unknown) => checkEvent(body).ok;
    expect(bad(null)).toBe(false);
    expect(bad({ title: ' ', date: '2026-11-09' })).toBe(false);
    expect(bad({ title: 'x'.repeat(201), date: '2026-11-09' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-02-30' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', time: '25:00' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', repeat: 'hourly' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', basis: 'h' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', remind_minutes: 30 })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', color: 'red' })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', note: 'x'.repeat(4001) })).toBe(false);
    expect(bad({ title: 'x', date: '2026-11-09', subscription_key: 'Not A Key' })).toBe(false);
    // An end needs a repeat, and comes after the start.
    expect(bad({ title: 'x', date: '2026-11-09', repeat_until: '2026-12-01' })).toBe(false);
    expect(
      bad({ title: 'x', date: '2026-11-09', repeat: 'weekly', repeat_until: '2026-11-01' }),
    ).toBe(false);
    expect(
      bad({ title: 'x', date: '2026-11-09', repeat: 'weekly', repeat_until: '2026-12-01' }),
    ).toBe(true);
  });

  it('an empty time or end is none', () => {
    const checked = checkEvent({ title: 'x', date: '2026-11-09', time: '', repeat_until: '' });
    expect(checked.ok && checked.value.time).toBeNull();
    expect(checked.ok && checked.value.repeat_until).toBeNull();
  });
});

describe('checkSubscription and checkImport', () => {
  const sub = {
    key: 'api-football',
    name: 'API-Football',
    status: 'active',
    renew_on: '2026-11-21',
  };

  it('reads a subscription, empty text where none was given', () => {
    const checked = checkSubscription({
      ...sub,
      manage_url: 'https://dashboard.api-football.com',
      paid: true,
    });
    expect(checked.ok && checked.value).toMatchObject({
      key: 'api-football',
      renew_on: '2026-11-21',
      manage_url: 'https://dashboard.api-football.com',
      paid: true,
      plan: '',
      position: 0,
    });
  });

  it('refuses a bad key, status, day or address', () => {
    expect(checkSubscription({ ...sub, key: 'API' }).ok).toBe(false);
    expect(checkSubscription({ ...sub, status: 'paid' }).ok).toBe(false);
    expect(checkSubscription({ ...sub, renew_on: 'soon' }).ok).toBe(false);
    expect(checkSubscription({ ...sub, manage_url: 'http://x.example' }).ok).toBe(false);
    expect(checkSubscription({ ...sub, manage_url: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('every imported event names its source', () => {
    const event = { title: 'Renew', date: '2026-11-21', subscription_key: 'api-football' };
    expect(checkImport({ subscriptions: [sub], events: [event] }).ok).toBe(false);
    const checked = checkImport({
      subscriptions: [sub],
      events: [{ ...event, source_ref: 'claude-board:events/a' }],
    });
    expect(checked.ok && checked.value.events[0]).toMatchObject({
      source_ref: 'claude-board:events/a',
      subscription_key: 'api-football',
    });
  });
});

describe('dueReminders', () => {
  const event = (over: Partial<RemindableEvent>): RemindableEvent => ({
    id: 'e',
    title: 'Renew',
    date: '2026-11-21',
    time: '09:00',
    repeat: 'none',
    basis: 'g',
    repeat_until: null,
    remind_minutes: 1440,
    updated_at: new Date('2026-10-20T00:00:00Z'),
    ...over,
  });
  // The day before at 09:00 Tehran is 05:30 UTC.
  const at = new Date('2026-11-20T05:30:00Z');

  it('is due from its minute until the grace runs out', () => {
    const today = day('2026-11-20');
    expect(dueReminders([event({})], new Date(at.getTime() - 60000), today)).toEqual([]);
    expect(dueReminders([event({})], at, today).map((d) => d.day)).toEqual(['2026-11-21']);
    expect(dueReminders([event({})], new Date(at.getTime() + 359 * 60000), today)).toHaveLength(1);
    expect(dueReminders([event({})], new Date(at.getTime() + 361 * 60000), today)).toEqual([]);
  });

  it('never for an event without a reminder, or written after the reminder time', () => {
    const today = day('2026-11-20');
    expect(dueReminders([event({ remind_minutes: null })], at, today)).toEqual([]);
    expect(
      dueReminders(
        [event({ updated_at: new Date(at.getTime() + 1000) })],
        new Date(at.getTime() + 60000),
        today,
      ),
    ).toEqual([]);
  });

  it('a monthly repeat reminds for this month’s day', () => {
    const monthly = event({ date: '2026-10-21', repeat: 'monthly' });
    expect(dueReminders([monthly], at, day('2026-11-20')).map((d) => d.day)).toEqual([
      '2026-11-21',
    ]);
  });
});
