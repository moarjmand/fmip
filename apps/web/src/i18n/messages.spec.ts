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
    expect(Object.keys(AR).sort()).toEqual(['language.name.ar', 'language.name.en']);
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

describe('how finished a locale is', () => {
  it('is complete for the source language and nearly empty for Arabic', () => {
    expect(completeness('en')).toBe(1);
    expect(completeness('ar')).toBeGreaterThan(0);
    expect(completeness('ar')).toBeLessThan(SHIPPABLE_COMPLETENESS);
  });

  it('refuses to call a half-translated locale shippable', () => {
    // It still routes and still renders — that is how a translator sees their
    // work in place — but it is not offered as a language the product speaks.
    // Shipping it as finished is the language version of faking coverage.
    expect(isShippable('en')).toBe(true);
    expect(isShippable('ar')).toBe(false);
  });
});

describe('the plain helper', () => {
  it('returns the text, for the many places that render it directly', () => {
    expect(t('en', 'nav.signIn')).toBe('Sign in');
    expect(t('ar', 'nav.signIn')).toBe('Sign in');
  });
});
