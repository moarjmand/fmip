import { describe, expect, it } from 'vitest';
import {
  dayToIso,
  dayToJalali,
  isoToDay,
  jalaliMonthLength,
  jalaliToDay,
  occurrences,
  occursOn,
  reminderAt,
  timeToMinutes,
  wallClock,
  wallTimeToInstant,
  weekday,
  type Recurring,
} from './console-calendar';

const day = (iso: string): number => {
  const n = isoToDay(iso);
  if (n === null) throw new Error(`not a date: ${iso}`);
  return n;
};
const event = (over: Partial<Recurring>): Recurring => ({
  date: '2026-11-08',
  repeat: 'none',
  basis: 'j',
  repeat_until: null,
  ...over,
});

describe('day arithmetic (T-1788)', () => {
  it('round-trips ISO dates and refuses ones that are not real', () => {
    expect(dayToIso(day('2026-11-08'))).toBe('2026-11-08');
    expect(dayToIso(day('2028-02-29'))).toBe('2028-02-29');
    expect(isoToDay('2026-02-29')).toBeNull();
    expect(isoToDay('2026-13-01')).toBeNull();
    expect(isoToDay('8 Nov')).toBeNull();
  });

  it('converts to and from the Solar Hijri calendar', () => {
    // 1 Farvardin 1405 is 21 March 2026; 17 Aban 1405 is 8 November 2026.
    expect(dayToIso(jalaliToDay(1405, 1, 1))).toBe('2026-03-21');
    expect(dayToJalali(day('2026-11-08'))).toEqual({ y: 1405, m: 8, d: 17 });
    expect(dayToJalali(day('2025-03-20'))).toEqual({ y: 1403, m: 12, d: 30 });
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });

  it('knows the weekday (0 is Sunday)', () => {
    expect(weekday(day('2026-11-08'))).toBe(0);
    expect(weekday(day('2026-11-13'))).toBe(5);
  });
});

describe('occursOn', () => {
  it('a one-off event falls on its day only', () => {
    const e = event({});
    expect(occursOn(e, day('2026-11-08'))).toBe(true);
    expect(occursOn(e, day('2026-11-09'))).toBe(false);
  });

  it('daily and weekly start on their day and stop after repeat_until', () => {
    const daily = event({ repeat: 'daily', repeat_until: '2026-11-10' });
    expect(occurrences(daily, day('2026-11-01'), day('2026-11-30')).map(dayToIso)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    const weekly = event({ repeat: 'weekly' });
    expect(occurrences(weekly, day('2026-11-08'), day('2026-11-30')).map(dayToIso)).toEqual([
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
    ]);
  });

  it('a Gregorian monthly on the 31st falls on the last day of a shorter month', () => {
    const e = event({ date: '2026-01-31', repeat: 'monthly', basis: 'g' });
    expect(occurrences(e, day('2026-02-01'), day('2026-04-30')).map(dayToIso)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('a Solar Hijri monthly counts Solar Hijri months', () => {
    // 31 Shahrivar 1405 (22 September 2026): Mehr has 30 days, so its 30th.
    const e = event({ date: '2026-09-22', repeat: 'monthly', basis: 'j' });
    const next = occurrences(e, day('2026-09-23'), day('2026-11-30')).map((n) => dayToJalali(n));
    expect(next).toEqual([
      { y: 1405, m: 7, d: 30 },
      { y: 1405, m: 8, d: 30 },
    ]);
  });

  it('a yearly event keeps its month', () => {
    const e = event({ date: '2026-03-21', repeat: 'yearly', basis: 'j' });
    expect(occursOn(e, day('2027-03-21'))).toBe(true);
    expect(occursOn(e, day('2026-04-21'))).toBe(false);
  });
});

describe('wall-clock time in Tehran', () => {
  it('reads an instant on the team clock', () => {
    expect(wallClock(new Date('2026-11-08T20:45:00Z'))).toEqual({
      date: '2026-11-09',
      minutes: 15,
    });
  });

  it('turns a Tehran time into the right instant', () => {
    expect(wallTimeToInstant(day('2026-11-09'), 9 * 60).toISOString()).toBe(
      '2026-11-09T05:30:00.000Z',
    );
    expect(wallTimeToInstant(day('2026-11-09'), 2 * 60, 'UTC').toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    );
  });

  it('a reminder a day before at 09:00, and an untimed event at 09:00', () => {
    expect(
      reminderAt({ time: '09:00', remind_minutes: 1440 }, day('2026-11-21'))?.toISOString(),
    ).toBe('2026-11-20T05:30:00.000Z');
    expect(reminderAt({ time: null, remind_minutes: 0 }, day('2026-11-21'))?.toISOString()).toBe(
      '2026-11-21T05:30:00.000Z',
    );
    expect(reminderAt({ time: '09:00', remind_minutes: null }, day('2026-11-21'))).toBeNull();
  });

  it('reads a time', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('9:00')).toBeNull();
  });
});
