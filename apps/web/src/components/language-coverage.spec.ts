import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNFINISHED_LOCALES } from '../i18n/locales';
import { EN, SHIPPABLE_COMPLETENESS, coverage } from '../i18n/messages';
import { languageRows } from '../lib/language-coverage';

/**
 * The operator's view of the languages (T-302).
 *
 * The one thing this surface must not do is compute: the numbers are the
 * translators' files' numbers, through `coverage()`, and "offered" is
 * `isShippable`, the same test the picker uses. So the tests check that the
 * rows *are* those numbers, and that the component renders them and carries
 * no arithmetic of its own. The rows live in `lib/` and the component only
 * renders them, which is also why this spec can import one and only read the
 * other: vitest does not transform `.tsx` here, and no component spec in this
 * app imports a component.
 */

describe('the language rows', () => {
  it('lists English and the seven others, and never the pseudo-locale', () => {
    const locales = languageRows().map((row) => row.locale);
    expect(locales[0]).toBe('en');
    expect(locales.slice(1).sort()).toEqual([...UNFINISHED_LOCALES].sort());
    expect(locales).not.toContain('x-rtl');
  });

  it('carries exactly what coverage() says, for every locale', () => {
    for (const row of languageRows()) {
      expect(row.coverage).toEqual(coverage(row.locale));
      const done = row.coverage.total - row.coverage.untranslated;
      expect(row.percent).toBe(Math.floor((done / row.coverage.total) * 100));
    }
  });

  it('offers English and none of the seven, today', () => {
    const rows = languageRows();
    expect(rows.find((row) => row.locale === 'en')?.offered).toBe(true);
    for (const locale of UNFINISHED_LOCALES) {
      expect(rows.find((row) => row.locale === locale)?.offered, locale).toBe(false);
    }
  });

  it('rounds the percent down, because 94.9% is not the threshold', () => {
    // The threshold is a floor; a display that rounded up would say "95%"
    // beside "Not yet offered", which is the page arguing with itself.
    for (const row of languageRows()) {
      const exact = ((row.coverage.total - row.coverage.untranslated) / row.coverage.total) * 100;
      expect(row.percent).toBeLessThanOrEqual(exact);
      if (row.percent >= SHIPPABLE_COMPLETENESS * 100) expect(row.offered).toBe(true);
    }
  });

  it('names each language in its own words, and in English beside them', () => {
    for (const row of languageRows()) {
      expect(row.name).toBe(EN[`language.name.${row.locale}` as keyof typeof EN]);
      expect(row.autonym).not.toBe('');
    }
    expect(languageRows().find((row) => row.locale === 'ar')?.autonym).toBe('العربية');
  });
});

describe('what the code does and does not do', () => {
  const ROWS = readFileSync(join(__dirname, '..', 'lib', 'language-coverage.ts'), 'utf8');
  const COMPONENT = readFileSync(join(__dirname, 'language-coverage.tsx'), 'utf8');

  it('takes the numbers from coverage() and holds no catalogue of its own', () => {
    expect(ROWS).toMatch(/coverage\(locale\)/);
    // No second definition of "done": the only division is the percent, and
    // it is over coverage()'s numbers.
    expect(ROWS).not.toMatch(/Object\.keys\(EN\)\.length/);
    expect(ROWS).not.toMatch(/\.json/);
  });

  it('renders the rows and computes nothing', () => {
    expect(COMPONENT).toMatch(/languageRows\(\)/);
    expect(COMPONENT).not.toMatch(/coverage\(|isShippable\(|TRANSLATION_FILES/);
    // The one arithmetic allowed on the page is turning the threshold into a
    // percent for the sentence beside the table.
    expect(COMPONENT.match(/Math\.\w+\(/g) ?? []).toEqual(['Math.round(']);
  });

  it('names all eight keys literally, which is what took them off the waiting list', () => {
    // The eight `language.name.*` keys sat in the catalogue with no surface
    // until this table. The dead-key guard in messages.spec.ts looks for each
    // key's literal, so a template built from the locale would not have
    // counted; the table of literals is the evidence.
    for (const locale of ['en', ...UNFINISHED_LOCALES]) {
      expect(ROWS, locale).toContain(`'language.name.${locale}'`);
    }
  });
});
