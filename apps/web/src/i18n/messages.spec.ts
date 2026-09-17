import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AR,
  EN,
  SHIPPABLE_COMPLETENESS,
  TRANSLATION_FILES,
  completeness,
  coverage,
  interpolate,
  isPluralKey,
  isShippable,
  message,
  plural,
  t,
  type MessageKey,
  type PluralForms,
} from './messages';
import { UNFINISHED_LOCALES } from './locales';

// The missing-string policy (T-151, blueprint 13.2). The tests are about one
// rule: an untranslated string is visibly untranslated. Never blank, never
// machine output presented as a translation.

describe('looking up a message', () => {
  it('is the source language for English, and says so', () => {
    expect(message('en', 'nav.scores')).toEqual({ text: 'Scores', status: 'source' });
  });

  it('falls back to English for a key nobody has translated, and marks it', () => {
    // The fallback is the honest part. A blank teaches a reader nothing, and a
    // machine translation tells them something nobody checked.
    const scores = message('ar', 'nav.scores');
    expect(scores.text).toBe('Scores');
    expect(scores.status).toBe('untranslated');
  });

  it('uses the translation when there is one, and marks that too', () => {
    const name = message('ar', 'language.name.ar');
    expect(name.text).toBe('العربية');
    expect(name.status).toBe('translated');
  });

  it('never returns a blank, for any key in any locale', () => {
    for (const key of Object.keys(EN) as MessageKey[]) {
      for (const locale of ['en', 'ar', 'x-rtl'] as const) {
        expect(message(locale, key).text.trim()).not.toBe('');
      }
    }
  });
});

describe('what the catalogue may contain', () => {
  it('holds no machine translation: Arabic has only what is not translation', () => {
    // A language's own name is a fact, not a rendering of an English phrase.
    // Everything else waits for a fluent speaker (blueprint 13.1).
    //
    // `language.name.en` used to be here too, and it is not an autonym: the
    // Arabic for English is not the Latin word, so that entry was served under
    // `status: 'translated'` with nobody having translated it.
    expect(Object.keys(AR).sort()).toEqual(['language.name.ar']);
  });

  it('gives every unfinished locale its own name, and claims nothing else', () => {
    for (const locale of UNFINISHED_LOCALES) {
      const own = message(locale, `language.name.${locale}` as MessageKey);
      expect(own.status, `${locale} does not name itself`).toBe('translated');
      // Any other key is English, and says so. A catalogue that quietly held a
      // second entry would pass the count and fail the reader.
      expect(message(locale, 'nav.scores').status, locale).toBe('untranslated');
    }
  });

  it('cannot hold a key the source language does not have', () => {
    // The English catalogue is the source of truth: a key that is not there
    // does not exist, and the type system says so. This test records the
    // intent; the compiler enforces it.
    for (const key of Object.keys(AR)) {
      expect(Object.keys(EN)).toContain(key);
    }
  });
});

describe('every key is a key something renders', () => {
  // A key nobody calls is not free. `completeness()` divides by the number of
  // keys, so a dead one makes every locale look further behind than it is, and
  // the first translator to reach it spends their time on a string that goes
  // nowhere. `common.notTranslated` was exactly that until T-300: the fallback
  // is marked structurally, with `lang` and a data attribute, and no page ever
  // rendered the words.
  const SRC = join(__dirname, '..');

  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // The catalogue names every key by definition, so it cannot be its own
        // evidence that something renders one.
        if (entry.name !== 'i18n') found.push(...sources(full));
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.spec.tsx')
      ) {
        found.push(full);
      }
    }
    return found;
  }

  it('finds the whole app, so an empty result is a real result', () => {
    expect(sources(SRC).length).toBeGreaterThan(40);
  });

  /**
   * Keys whose surface is planned and not built. Each one has a task id, and
   * the list may only ever get shorter.
   *
   * The eight `language.name.*` keys sat here from T-300 until T-302 gave
   * them a surface. The seven plurals below are T-301's: the machinery lands
   * first, and the six pages that still spell "member{s}" by hand move onto
   * these keys in the change that follows, which empties this list again.
   */
  const AWAITING_A_SURFACE: MessageKey[] = [
    'friends.mutualCount',
    'groups.memberCount',
    'conversation.matchCount',
    'team.followerCount',
    'groupComparison.silent',
    'groupComparison.withheld',
    'team.position',
  ];

  it('has a call site for every key in the catalogue', () => {
    const code = sources(SRC).map((file) => readFileSync(file, 'utf8'));
    const unused = (Object.keys(EN) as MessageKey[]).filter(
      (key) => !code.some((text) => text.includes(`'${key}'`) || text.includes(`"${key}"`)),
    );
    // Equality, not containment: a key that gains a surface and stays on the
    // list makes the list something nobody trusts.
    expect(unused.sort()).toEqual([...AWAITING_A_SURFACE].sort());
  });
});

describe("the translator's files (T-302)", () => {
  // These are the files a fluent speaker edits by hand, so what they may
  // contain is checked here rather than trusted: a stale `source` would have
  // them translating a sentence the product no longer says, and a status the
  // text does not support would count a blank as done.
  const DIR = join(__dirname, 'catalogues');

  it('is the same file on disk that the module imported', () => {
    // The module bundles the JSON; the script and a translator work on disk.
    // If those ever differed, every other test here would be about the wrong
    // thing.
    for (const locale of UNFINISHED_LOCALES) {
      const onDisk = JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8'));
      expect(onDisk, locale).toEqual(TRANSLATION_FILES[locale]);
    }
    expect(JSON.parse(readFileSync(join(DIR, 'en.json'), 'utf8'))).toEqual(EN);
  });

  it('carries every source key and nothing else, with the current English beside it', () => {
    const keys = Object.keys(EN).sort();
    for (const locale of UNFINISHED_LOCALES) {
      const file = TRANSLATION_FILES[locale];
      expect(Object.keys(file).sort(), locale).toEqual(keys);
      for (const key of keys as MessageKey[]) {
        // toEqual, not toBe: a plural's source is an object of forms, copied
        // into the file, and it is the forms that must match.
        expect(file[key].source, `${locale} ${key} source`).toEqual(EN[key]);
      }
    }
  });

  it('never lets a status say more than the words do', () => {
    for (const locale of UNFINISHED_LOCALES) {
      for (const [key, entry] of Object.entries(TRANSLATION_FILES[locale])) {
        expect(['untranslated', 'translated', 'reviewed'], `${locale} ${key}`).toContain(
          entry.status,
        );
        const words =
          (entry.text ?? '') !== '' ||
          Object.values(entry.forms ?? {}).some((form) => form !== undefined && form !== '');
        expect(words, `${locale} ${key}: words iff not untranslated`).toBe(
          entry.status !== 'untranslated',
        );
      }
    }
  });

  it('answers how far a locale has got, in numbers that add up', () => {
    for (const locale of UNFINISHED_LOCALES) {
      const c = coverage(locale);
      expect(c.total).toBe(Object.keys(EN).length);
      expect(c.untranslated + c.translated + c.reviewed, locale).toBe(c.total);
      // Today: exactly the autonym, and nobody has reviewed anything.
      expect(c.translated, locale).toBe(1);
      expect(c.reviewed, locale).toBe(0);
    }
    expect(coverage('en')).toEqual({
      total: Object.keys(EN).length,
      untranslated: 0,
      translated: 0,
      reviewed: Object.keys(EN).length,
    });
  });

  it('is what completeness is computed from', () => {
    for (const locale of UNFINISHED_LOCALES) {
      const c = coverage(locale);
      expect(completeness(locale)).toBeCloseTo((c.total - c.untranslated) / c.total, 10);
    }
  });
});

describe('plurals (T-301)', () => {
  // The rule the task exists for: a language with six forms gets six, and a
  // translated entry missing a form its language has is a failing test, not a
  // fallback. `Intl.PluralRules` says which forms a language has; nothing
  // here types that knowledge out by hand.
  const pluralKeys = (Object.keys(EN) as MessageKey[]).filter(isPluralKey);
  const categories = (locale: string, type: 'cardinal' | 'ordinal') =>
    [
      ...new Intl.PluralRules(locale === 'en' ? 'en-GB' : locale, { type }).resolvedOptions()
        .pluralCategories,
    ].sort();

  it('has seven plural keys, one of them ordinal, and knows which they are', () => {
    expect(pluralKeys).toHaveLength(7);
    expect(pluralKeys.filter((key) => (EN[key] as PluralForms).type === 'ordinal')).toEqual([
      'team.position',
    ]);
  });

  it("gives every English plural exactly English's categories", () => {
    for (const key of pluralKeys) {
      const { type, ...forms } = EN[key] as PluralForms;
      expect(Object.keys(forms).sort(), key).toEqual(categories('en', type ?? 'cardinal'));
      for (const form of Object.values(forms)) expect(form, key).toContain('{count}');
    }
  });

  it('refuses a translated plural that lacks a form its language has', () => {
    for (const locale of UNFINISHED_LOCALES) {
      for (const key of pluralKeys) {
        const entry = TRANSLATION_FILES[locale][key];
        const filled = Object.entries(entry.forms ?? {})
          .filter(([, form]) => form !== undefined && form !== '')
          .map(([category]) => category)
          .sort();
        if (entry.status === 'untranslated') {
          expect(filled, `${locale} ${key}: untranslated means no forms`).toEqual([]);
        } else {
          const type = (EN[key] as PluralForms).type ?? 'cardinal';
          expect(filled, `${locale} ${key}: exactly this language's categories`).toEqual(
            categories(locale, type),
          );
        }
      }
    }
  });

  it("selects the form by the locale's own rules, and falls back to English by English rules", () => {
    // Arabic has six forms; nobody has translated any, so every count is
    // English -- chosen by English rules, not conjugated by Arabic ones.
    for (const count of [0, 1, 2, 3, 11, 100]) {
      const m = plural('ar', 'groups.memberCount', count);
      expect(m.status).toBe('untranslated');
      expect(m.text).toBe(count === 1 ? '1 member' : `${count} members`);
    }
    expect(plural('en', 'groups.memberCount', 1)).toEqual({ text: '1 member', status: 'source' });
    expect(plural('en', 'groups.memberCount', 2).text).toBe('2 members');
  });

  it('spells ordinals by CLDR, including the teens', () => {
    const spell = (n: number) => plural('en', 'team.position', n).text;
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(spell)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '111th',
    ]);
  });

  it('writes the count in the reader\u2019s digits and grouping, and fills named parameters', () => {
    expect(plural('de', 'team.followerCount', 60000).text).toBe('60.000 followers');
    expect(plural('en', 'conversation.matchCount', 3, { term: 'goal' }).text).toBe(
      '3 messages matching \u201cgoal\u201d',
    );
    expect(interpolate('{a} and {b} and {c}', { a: '1', b: '2' })).toBe('1 and 2 and {c}');
  });

  it('answers message() with the other form, so nothing is ever blank', () => {
    for (const key of pluralKeys) {
      for (const locale of ['en', 'ar', 'x-rtl'] as const) {
        expect(message(locale, key).text.trim()).not.toBe('');
      }
    }
  });
});

describe('how finished a locale is', () => {
  it('is complete for the source language and nearly empty for the other seven', () => {
    expect(completeness('en')).toBe(1);
    for (const locale of UNFINISHED_LOCALES) {
      expect(completeness(locale), locale).toBeGreaterThan(0);
      expect(completeness(locale), locale).toBeLessThan(SHIPPABLE_COMPLETENESS);
    }
  });

  it('refuses to call a half-translated locale shippable', () => {
    // It still routes and still renders — that is how a translator sees their
    // work in place — but it is not offered as a language the product speaks.
    // Shipping it as finished is the language version of faking coverage.
    expect(isShippable('en')).toBe(true);
    for (const locale of UNFINISHED_LOCALES) {
      expect(isShippable(locale), locale).toBe(false);
    }
  });
});

describe('the plain helper', () => {
  it('returns the text, for the many places that render it directly', () => {
    expect(t('en', 'nav.signIn')).toBe('Sign in');
    expect(t('ar', 'nav.signIn')).toBe('Sign in');
  });
});
