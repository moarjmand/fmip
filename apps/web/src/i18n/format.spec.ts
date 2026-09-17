import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber, formatTime, intlLocale } from './format';
import { UNFINISHED_LOCALES } from './locales';

const ISO = '2025-01-05T16:28:00Z';
const ZONE = 'Europe/London';

describe('the tag Intl is given', () => {
  it('formats English as en-GB, which is what every call site said before', () => {
    expect(intlLocale('en')).toBe('en-GB');
  });

  it('formats the pseudo-locale as English, because Intl throws on it', () => {
    expect(intlLocale('x-rtl')).toBe('en-GB');
    // The reason the mapping exists at all: a private-use tag is not a locale
    // Intl accepts, and a render on /x-rtl must not find that out.
    expect(() => new Intl.DateTimeFormat('x-rtl')).toThrow(RangeError);
    expect(formatDateTime('x-rtl', ISO, ZONE)).toBe(formatDateTime('en', ISO, ZONE));
  });

  it('passes a real locale through untouched', () => {
    for (const locale of UNFINISHED_LOCALES) expect(intlLocale(locale)).toBe(locale);
  });

  it('never hands Intl something that is not one of ours', () => {
    expect(intlLocale('nl')).toBe('en-GB');
    expect(intlLocale('')).toBe('en-GB');
  });
});

describe('what English readers see', () => {
  // Pinned to the strings the hardcoded 'en-GB' produced, so an English page
  // is byte-for-byte what it was and the other seven locales are the change.
  it('is the same date and time as before', () => {
    expect(formatDateTime('en', ISO, ZONE)).toBe('5 Jan 2025, 16:28');
  });

  it('is the same clock as before, on the 24-hour cycle', () => {
    expect(formatTime('en', ISO, ZONE)).toBe('16:28');
    expect(formatTime('en', ISO, ZONE, { seconds: true })).toBe('16:28:00');
  });

  it('keeps the 24-hour cycle in the afternoon, where a 12-hour clock would show', () => {
    expect(formatTime('en', '2025-01-05T20:31:07Z', ZONE, { seconds: true })).toBe('20:31:07');
    expect(formatTime('en', '2025-01-05T20:31:07Z', ZONE)).not.toMatch(/pm/i);
  });

  it('groups a count the way it was grouped', () => {
    expect(formatNumber('en', 60000)).toBe('60,000');
  });
});

describe('what the other seven see', () => {
  it('is not English, for every one of them', () => {
    const english = formatDateTime('en', ISO, ZONE);
    for (const locale of UNFINISHED_LOCALES) {
      expect(formatDateTime(locale, ISO, ZONE), locale).not.toBe(english);
    }
  });

  it('writes the date in the language, not only in its order', () => {
    expect(formatDateTime('es', ISO, ZONE)).toMatch(/ene/);
    expect(formatDateTime('de', ISO, ZONE)).toMatch(/^05\.01\.2025/);
    expect(formatDate('fr', ISO, ZONE, { weekday: 'long' })).toBe('dimanche');
    expect(formatDate('tr', ISO, ZONE, { month: 'long' })).toBe('Ocak');
  });

  it('groups a count the way the language does', () => {
    expect(formatNumber('de', 60000)).toBe('60.000');
    expect(formatNumber('fr', 60000)).not.toBe('60,000');
  });

  it('keeps the clock on the 24-hour cycle everywhere', () => {
    for (const locale of UNFINISHED_LOCALES) {
      expect(formatTime(locale, '2025-01-05T20:31:00Z', ZONE), locale).toMatch(/20.31/);
    }
  });

  it('is in the reader’s zone, not the server’s', () => {
    expect(formatTime('es', ISO, 'Asia/Tehran')).toBe('19:58');
    expect(formatTime('es', ISO, 'America/New_York')).toBe('11:28');
  });
});

describe('the two machine formats this module must not touch', () => {
  // `lib/scores.ts` validates a time zone with `en-US` and builds the scores
  // day-tab key with `en-CA`, whose date order is ISO. Neither is read by a
  // person. Localising them would make the tab URLs depend on the language,
  // and this test is where somebody who tries finds out why not.
  const source = readFileSync(join(__dirname, '..', 'lib', 'scores.ts'), 'utf8');

  it('leaves the date key on en-CA', () => {
    expect(source.match(/'en-CA'/g)).toHaveLength(1);
  });

  it('leaves time-zone validation on en-US', () => {
    expect(source.match(/'en-US'/g)).toHaveLength(1);
  });

  it('does not offer a date-key helper for them to reach for', () => {
    // The code, not the prose: the header comment names `en-CA` to say what
    // this module is not for, and a guard that failed on the explanation
    // would teach people to delete explanations.
    const code = readFileSync(join(__dirname, 'format.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/en-CA|formatToParts|dateKey/);
  });
});
