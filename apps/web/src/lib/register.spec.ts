import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { registrationDisplayName, registrationLanguage, registrationRefusal } from './register';

describe('what the register form no longer asks (T-1737, D-358)', () => {
  it('names the account after its username until the member chooses a display name', () => {
    expect(registrationDisplayName('', 'sam_91')).toBe('sam_91');
    expect(registrationDisplayName('   ', ' sam_91 ')).toBe('sam_91');
    // A form that still sends one is believed.
    expect(registrationDisplayName(' Sam K ', 'sam_91')).toBe('Sam K');
    // No username is no display name: the API says so on the username field.
    expect(registrationDisplayName('', '')).toBe('');
  });

  it('registers in the page’s language when that language is offered', () => {
    const offered = (locale: Locale) => locale === 'en' || locale === 'fa';
    expect(registrationLanguage('fa', offered)).toBe('fa');
    expect(registrationLanguage('en', offered)).toBe('en');
  });

  it('registers in English on a held or unfinished language, a pseudo-locale and nonsense', () => {
    const onlyEnglish = (locale: Locale) => locale === 'en';
    expect(registrationLanguage('fa', onlyEnglish)).toBe('en');
    expect(registrationLanguage('de', onlyEnglish)).toBe('en');
    // The pseudo-locale is never a member's language, whatever the predicate says.
    expect(registrationLanguage('x-rtl', () => true)).toBe('en');
    expect(registrationLanguage('klingon', () => true)).toBe('en');
    expect(registrationLanguage('', () => true)).toBe('en');
  });
});

describe('a registration refused by the close-sign-ups switch (T-1970)', () => {
  it('is told in our words, read from the code, and nothing else is', () => {
    expect(
      registrationRefusal({ error: 'registration_closed', message: 'Sign-ups are closed.' }),
    ).toBe('auth.register.signupsClosed');
    // Every other failure keeps the API's sentence and its field errors.
    expect(
      registrationRefusal({ error: 'conflict', message: 'Already taken.', fields: { email: 'x' } }),
    ).toBeNull();
    expect(registrationRefusal({ error: 'forbidden', message: 'No.' })).toBeNull();
    expect(registrationRefusal({ error: 'rate_limited', message: 'Wait.' })).toBeNull();
    expect(registrationRefusal(null)).toBeNull();
  });

  it('says plainly that sign-ups are closed and signing in still works, in English and Persian', () => {
    expect(t('en', 'auth.register.signupsClosed')).toBe(
      'Sign-ups are closed for now. If you already have an account, you can still sign in.',
    );
    const fa = t('fa', 'auth.register.signupsClosed');
    expect(fa).toContain('ثبت‌نام');
    expect(fa).toContain('وارد شوید');
    expect(fa).not.toMatch(/[A-Za-z]/);
  });

  it('falls back to the English in a language not yet translated, never to a blank', () => {
    for (const locale of ['ar', 'de', 'es', 'fr', 'it', 'pt', 'tr'] as const) {
      expect(t(locale, 'auth.register.signupsClosed')).toBe(t('en', 'auth.register.signupsClosed'));
    }
  });
});
