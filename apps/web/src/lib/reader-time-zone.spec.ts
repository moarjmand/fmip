import { describe, expect, it } from 'vitest';
import { chosenTimeZone, defaultTimeZone, readerTimeZone, zoneWords } from './reader-time-zone';

/** One reader zone on every page (T-1391, D-207). */
describe('the reader’s time zone', () => {
  it('is the member’s, else the guest’s choice, else the locale’s default', () => {
    expect(readerTimeZone('en', { timezone: 'Asia/Tokyo' }, { timezone: 'Europe/Paris' })).toBe(
      'Asia/Tokyo',
    );
    expect(readerTimeZone('en', null, { timezone: 'Europe/Paris' })).toBe('Europe/Paris');
    expect(readerTimeZone('fa', null, { timezone: 'Asia/Tehran' })).toBe('Asia/Tehran');
  });

  it('defaults to UK time on /en and keeps UTC everywhere else', () => {
    expect(readerTimeZone('en', null, {})).toBe('Europe/London');
    expect(readerTimeZone('en', null, null)).toBe('Europe/London');
    expect(readerTimeZone('fa', null, {})).toBe('UTC');
    expect(defaultTimeZone('ar')).toBe('UTC');
    expect(defaultTimeZone('x-rtl')).toBe('UTC');
  });

  it('ignores a zone that is not one', () => {
    expect(chosenTimeZone({ timezone: 'Mars/Olympus' }, { timezone: '' })).toBeNull();
    expect(readerTimeZone('en', { timezone: 'Mars/Olympus' }, null)).toBe('Europe/London');
  });

  it('says the zone in words: UK time, Tehran time, UTC, or the city', () => {
    expect(zoneWords('en', 'Europe/London')).toBe('UK time');
    expect(zoneWords('en', 'Asia/Tehran')).toBe('Tehran time');
    expect(zoneWords('en', 'UTC')).toBe('UTC');
    expect(zoneWords('en', 'America/New_York')).toBe('New York time');
    // Persian keeps today's words (D-207).
    expect(zoneWords('fa', 'Asia/Tehran')).toBe('به وقت تهران');
    expect(zoneWords('fa', 'UTC')).toBe('به وقت UTC');
    expect(zoneWords('fa', 'Europe/London')).toBe('به وقت London');
  });
});
