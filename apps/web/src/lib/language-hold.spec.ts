import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOLDABLE_LOCALES, type LocaleHoldRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale, isPseudoLocale } from '../i18n/locales';
import { languageRows } from './language-coverage';
import { heldNotice, offeredGiven } from './language-hold';
import { offeredLocales } from './language-picker';
import { INDEXABLE_LOCALES } from './seo';

/**
 * Holding back a language that is ready (T-1163, D-155): a hold only takes a
 * language away; English is never held; when the holds cannot be read only
 * English is offered; a reader whose stored language is held is told once.
 */
const ready =
  (...locales: string[]) =>
  (locale: Locale) =>
    locale === 'en' || locales.includes(locale);
const holds = (...locales: string[]) =>
  new Map(locales.map((locale) => [locale, '2026-09-29T10:00:00.000Z']));

describe('what is offered', () => {
  it('is what is ready and not held', () => {
    const offer = offeredGiven(holds('fr'), ready('fr', 'de'));
    expect(offeredLocales(offer)).toEqual(['en', 'de']);
  });

  it('never offers a language the catalogue refuses, held or not', () => {
    expect(offeredLocales(offeredGiven(holds(), ready()))).toEqual(['en']);
    expect(offeredLocales(offeredGiven(holds('tr'), ready()))).toEqual(['en']);
  });

  it('offers English only when the holds cannot be read', () => {
    expect(offeredLocales(offeredGiven(null, ready('fr', 'de')))).toEqual(['en']);
  });

  it('holds only real languages other than English, the registry’s own list', () => {
    const real = LOCALES.filter((l) => !isPseudoLocale(l) && l !== 'en');
    expect([...HOLDABLE_LOCALES].sort()).toEqual([...real].sort());
  });

  it('cannot disagree with indexing: no holdable language is indexable yet', () => {
    // A held language must answer as an unoffered one does, which includes
    // not being offered to search engines. Today that is true because every
    // language but English is unfinished (`seo.ts`). The day one leaves
    // `UNFINISHED_LOCALES`, `INDEXABLE_LOCALES` has to consult the holds too,
    // and this fails to say so.
    expect(INDEXABLE_LOCALES).toEqual(['en']);
  });
});

describe('telling a reader once', () => {
  it('tells a reader whose stored language is held, keyed by the hold', () => {
    expect(heldNotice('fr', holds('fr'), undefined)).toBe('fr@2026-09-29T10:00:00.000Z');
  });

  it('does not tell them twice for the same hold, and tells them again for a new one', () => {
    expect(heldNotice('fr', holds('fr'), 'fr@2026-09-29T10:00:00.000Z')).toBeNull();
    expect(heldNotice('fr', holds('fr'), 'fr@2026-01-01T00:00:00.000Z')).toBe(
      'fr@2026-09-29T10:00:00.000Z',
    );
  });

  it('says nothing to English, to an unheld language, to no choice, or when holds are unread', () => {
    expect(heldNotice('en', holds('fr'), undefined)).toBeNull();
    expect(heldNotice('de', holds('fr'), undefined)).toBeNull();
    expect(heldNotice(undefined, holds('fr'), undefined)).toBeNull();
    expect(heldNotice(null, holds('fr'), undefined)).toBeNull();
    expect(heldNotice('fr', null, undefined)).toBeNull();
  });
});

describe('the operator’s rows', () => {
  const hold = (locale: string, released = false): LocaleHoldRecord => ({
    locale,
    held_by: 'operator',
    reason: 'Not reviewed',
    held_at: '2026-09-29T10:00:00.000Z',
    released_by: released ? 'operator' : null,
    release_reason: released ? 'Reviewed' : null,
    released_at: released ? '2026-09-29T11:00:00.000Z' : null,
  });

  it('shows the hold in force, and offers exactly what the reader is offered', () => {
    const rows = languageRows([hold('fr'), hold('de', true)], ready('fr', 'de'));
    const fr = rows.find((r) => r.locale === 'fr')!;
    const de = rows.find((r) => r.locale === 'de')!;
    expect([fr.ready, fr.offered, fr.hold?.reason]).toEqual([true, false, 'Not reviewed']);
    expect([de.ready, de.offered, de.hold]).toEqual([true, true, null]);
    expect(rows.filter((r) => r.offered).map((r) => r.locale)).toEqual(
      offeredLocales(offeredGiven(holds('fr'), ready('fr', 'de'))),
    );
  });

  it('offers English only when the holds are unread, as the reader is', () => {
    const rows = languageRows(null, ready('fr'));
    expect(rows.filter((r) => r.offered).map((r) => r.locale)).toEqual(['en']);
  });
});

describe('where the offer is applied', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('in the header’s picker, the first run’s step and its save action, and the proxy', () => {
    expect(read('components', 'site-header.tsx')).toContain(
      'offeredLanguages(offeredGiven(holds))',
    );
    expect(read('app', '[locale]', 'welcome', 'page.tsx')).toContain(
      'offeredLocales(await offeredNow())',
    );
    expect(read('lib', 'first-run-actions.ts')).toContain('(await offeredNow())(language)');
    expect(read('proxy.ts')).toContain('await isHeld(chosen)');
  });

  it('leaves the translators’ files alone', () => {
    for (const file of ['language-hold.ts', 'locale-hold-actions.ts'])
      expect(read('lib', file)).not.toMatch(/catalogues|writeFile/);
  });
});
