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
  isShippable,
  message,
  t,
  type MessageKey,
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
   * It is empty now. The eight `language.name.*` keys sat here from T-300
   * until T-302 put the operator's language table on `/admin`, which renders
   * every one of them. The picker (T-306) is still to come, but a key with
   * one real surface is not awaiting one -- and the list is asserted by
   * equality, so it could not have kept them.
   */
  const AWAITING_A_SURFACE: MessageKey[] = [];

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
        expect(file[key].source, `${locale} ${key} source`).toBe(EN[key]);
      }
    }
  });

  it('never lets a status say more than the text does', () => {
    for (const locale of UNFINISHED_LOCALES) {
      for (const [key, entry] of Object.entries(TRANSLATION_FILES[locale])) {
        expect(['untranslated', 'translated', 'reviewed'], `${locale} ${key}`).toContain(
          entry.status,
        );
        expect(entry.text === '', `${locale} ${key}: empty text iff untranslated`).toBe(
          entry.status === 'untranslated',
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
