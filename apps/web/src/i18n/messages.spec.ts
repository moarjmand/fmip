import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AR,
  EN,
  SHIPPABLE_COMPLETENESS,
  completeness,
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
   * The names of the eight languages exist for the picker that offers them
   * (T-306). Nothing in the product lists a language today, which is why the
   * acceptance criterion "none of the six is offered as a finished language"
   * is currently true by there being no offer at all -- a weaker thing than it
   * sounds, and worth writing down rather than ticking.
   */
  const AWAITING_A_SURFACE: MessageKey[] = [
    'language.name.en',
    'language.name.ar',
    'language.name.de',
    'language.name.es',
    'language.name.fr',
    'language.name.it',
    'language.name.pt',
    'language.name.tr',
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
