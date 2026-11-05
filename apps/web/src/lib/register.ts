import { DEFAULT_LOCALE, type Locale, isLocale, isPseudoLocale } from '@/i18n/locales';

/**
 * What the register form no longer asks (T-1737, D-358) and registration
 * still stores (blueprint 7.1): a display name and a preferred language. Pure,
 * so the defaults are tested without the API behind the action.
 */

/**
 * The account's first display name: what the form sent, if a form still sends
 * one, else the username. The member changes it in Settings.
 */
export function registrationDisplayName(given: string, username: string): string {
  const typed = given.trim();
  return typed !== '' ? typed : username.trim();
}

/**
 * The account's preferred language: the language of the page the reader
 * registered on, when it is one the product offers now -- the first run's own
 * rule (T-306, T-1163). A pseudo-locale, an unfinished or held language and an
 * unknown value register in the source language, as every account did before.
 */
export function registrationLanguage(locale: string, offered: (locale: Locale) => boolean): string {
  return isLocale(locale) && !isPseudoLocale(locale) && offered(locale) ? locale : DEFAULT_LOCALE;
}
