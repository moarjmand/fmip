import type { ApiError } from '@fmip/contracts';
import { DEFAULT_LOCALE, type Locale, isLocale, isPseudoLocale } from '@/i18n/locales';
import type { MessageKey } from '@/i18n/messages';

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

/**
 * The words a refused registration is told in when the refusal is ours to
 * word, by the API's code and never its sentence: the close-sign-ups switch
 * (T-1970, D-459) says so in the reader's language. Anything else is `null`,
 * and the API's own sentence and field errors are shown as before.
 */
export function registrationRefusal(error: ApiError | null): MessageKey | null {
  return error?.error === 'registration_closed' ? 'auth.register.signupsClosed' : null;
}
