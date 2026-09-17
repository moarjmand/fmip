import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offeredLocales, pickerEntries, switchLocale } from './language-picker';
import { type Locale, UNFINISHED_LOCALES } from '../i18n/locales';
import { isShippable } from '../i18n/messages';

/**
 * The language picker offers what the product speaks (T-306).
 *
 * Two states matter and both are tested: today, when only English is done and
 * the picker must render nothing; and the day a second catalogue crosses the
 * threshold, when it must appear with exactly the finished languages. The
 * predicate is injected so the second state can be shown without pretending a
 * catalogue is finished.
 */

const done =
  (...locales: Locale[]) =>
  (locale: Locale) =>
    locales.includes(locale);

describe('which locales are offered', () => {
  it('is English alone today, because no other catalogue is finished', () => {
    expect(offeredLocales()).toEqual(['en']);
    for (const locale of UNFINISHED_LOCALES) expect(isShippable(locale), locale).toBe(false);
  });

  it('never offers the pseudo-locale, however shippable it claims to be', () => {
    expect(offeredLocales(() => true)).not.toContain('x-rtl');
  });

  it('keeps the order the locales ship in', () => {
    expect(offeredLocales(done('tr', 'en', 'ar'))).toEqual(['en', 'ar', 'tr']);
  });
});

describe('what the picker shows', () => {
  it('shows nothing when there is only one language, because one is not a choice', () => {
    expect(pickerEntries('/en/scores')).toEqual([]);
    expect(pickerEntries('/en/scores', done('en'))).toEqual([]);
  });

  it('appears the day a second language is finished, with exactly the finished ones', () => {
    const entries = pickerEntries('/en/scores', done('en', 'es'));
    expect(entries.map((e) => e.locale)).toEqual(['en', 'es']);
    expect(entries.map((e) => e.href)).toEqual(['/en/scores', '/es/scores']);
    expect(entries.map((e) => e.current)).toEqual([true, false]);
  });

  it('names each language in its own words, from its own catalogue', () => {
    const entries = pickerEntries('/en', done('en', 'ar', 'de'));
    expect(entries.map((e) => e.autonym)).toEqual(['English', 'العربية', 'Deutsch']);
  });

  it('links to the same page, not to the other language’s home', () => {
    const [, es] = pickerEntries('/en/match/abc?x=1'.split('?')[0] ?? '', done('en', 'es'));
    expect(es?.href).toBe('/es/match/abc');
  });
});

describe('switching the locale of a pathname', () => {
  it('replaces the first segment when it is a locale', () => {
    expect(switchLocale('/en/scores', 'fr')).toBe('/fr/scores');
    expect(switchLocale('/ar', 'en')).toBe('/en');
    expect(switchLocale('/x-rtl/settings/notifications', 'de')).toBe('/de/settings/notifications');
  });

  it('prefixes a pathname that carries no locale', () => {
    expect(switchLocale('/', 'es')).toBe('/es');
    expect(switchLocale('/scores', 'es')).toBe('/es/scores');
  });

  it('does not mistake a path that merely starts like a locale', () => {
    expect(switchLocale('/entries', 'es')).toBe('/es/entries');
  });
});

describe('the component', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'components', 'language-picker.tsx'), 'utf8');

  it('is a client component reading the real pathname, and renders the entries only', () => {
    // A server component cannot know the pathname (Next documents this as
    // intentional); the picker needs it to link to the same page. The proxy
    // only redirects, never rewrites, so the pathname the server rendered is
    // the one the browser has and there is no hydration mismatch to guard.
    expect(SOURCE.startsWith("'use client'")).toBe(true);
    expect(SOURCE).toMatch(/usePathname\(\)/);
    expect(SOURCE).toMatch(/pickerEntries\(pathname\)/);
    expect(SOURCE).not.toMatch(/isShippable|LOCALES|coverage\(/);
  });

  it('renders nothing rather than an empty landmark when there is no choice', () => {
    expect(SOURCE).toMatch(/entries\.length === 0\) return null/);
  });

  it('marks each entry with its language and the current one as current', () => {
    expect(SOURCE).toMatch(/lang=\{entry\.locale\}/);
    expect(SOURCE).toMatch(/hrefLang=\{entry\.locale\}/);
    expect(SOURCE).toMatch(/aria-current=\{entry\.current \? 'page' : undefined\}/);
  });
});
