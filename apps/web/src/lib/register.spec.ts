import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/locales';
import { registrationDisplayName, registrationLanguage } from './register';

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
