import { describe, expect, it } from 'vitest';
import { formatTime } from '@/i18n/format';
import { interpolate, t } from '@/i18n/messages';
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

  it('defaults to UK time on /en, Tehran time on /fa (D-337) and UTC everywhere else', () => {
    expect(readerTimeZone('en', null, {})).toBe('Europe/London');
    expect(readerTimeZone('en', null, null)).toBe('Europe/London');
    expect(readerTimeZone('fa', null, {})).toBe('Asia/Tehran');
    expect(readerTimeZone('fa', null, null)).toBe('Asia/Tehran');
    expect(defaultTimeZone('fa')).toBe('Asia/Tehran');
    // A member's or a guest's own choice still wins on /fa.
    expect(readerTimeZone('fa', { timezone: 'UTC' }, null)).toBe('UTC');
    expect(readerTimeZone('fa', null, { timezone: 'Europe/Berlin' })).toBe('Europe/Berlin');
    expect(defaultTimeZone('ar')).toBe('UTC');
    expect(defaultTimeZone('de')).toBe('UTC');
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

  it('prints a kick-off on /fa in Tehran time, UTC+3:30 all year, and says so (D-337)', () => {
    const fa = defaultTimeZone('fa');
    // 16:00 UTC is 19:30 in Tehran, summer and winter alike (no DST since 2022).
    expect(formatTime('fa', '2026-11-01T16:00:00Z', fa)).toBe('۱۹:۳۰');
    expect(formatTime('fa', '2027-07-01T16:00:00Z', fa)).toBe('۱۹:۳۰');
    expect(formatTime('fa', '2026-11-01T22:00:00Z', fa)).toBe('۰۱:۳۰');
    expect(zoneWords('fa', fa)).toBe('به وقت تهران');
    // The note names the zone in words, never the IANA id ("Asia/Tehran").
    const params = { zone: fa, zoneName: zoneWords('fa', fa) };
    expect(interpolate(t('fa', 'scores.timesIn'), params)).toBe('ساعت‌ها به وقت تهران');
    expect(interpolate(t('fa', 'watch.timesIn'), params)).toBe('ساعت‌ها به وقت تهران');
    expect(interpolate(t('fa', 'scores.timesInGuest'), params)).toMatch(/^ساعت‌ها به وقت تهران \(/);
  });

  it('leaves /en on UK time, with its summer hour, and its words unchanged', () => {
    const en = defaultTimeZone('en');
    expect(formatTime('en', '2026-11-01T16:00:00Z', en)).toBe('16:00');
    expect(formatTime('en', '2027-07-01T16:00:00Z', en)).toBe('17:00');
    expect(zoneWords('en', en)).toBe('UK time');
    expect(interpolate(t('en', 'scores.timesIn'), { zoneName: zoneWords('en', en) })).toBe(
      'Times: UK time',
    );
  });
});
