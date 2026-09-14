/**
 * The message catalogue and the missing-string policy (T-151, blueprint 13.2).
 *
 * **The rule this file exists for: an untranslated string is visibly
 * untranslated.** It is never machine output presented as a translation, and it
 * is never a blank. A reader on `/ar` who meets an English word should be able
 * to tell that nobody has translated it yet — because the alternative is a page
 * that looks finished and is not, which is the same failure as an empty module
 * that looks populated (rule 3), applied to language.
 *
 * The mechanism is deliberately small: a catalogue per locale, a lookup that
 * falls back to English, and a `status` saying which happened. Nothing here
 * translates anything. Producing Arabic by machine and shipping it as the
 * product's Arabic would be inventing content, and a football glossary is a
 * judgement a fluent speaker makes (blueprint 13.1).
 */

import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * Every message the product shows, by key.
 *
 * The English catalogue is the source of truth: a key that is not here does not
 * exist, and `MessageKey` makes asking for one a type error rather than a blank
 * on a page.
 */
export const EN = {
  'nav.scores': 'Scores',
  'nav.search': 'Search',
  'nav.predictions': 'Predictions',
  'nav.leaderboard': 'Leaderboard',
  'nav.friends': 'Friends',
  'nav.messages': 'Messages',
  'nav.groups': 'Groups',
  'nav.signIn': 'Sign in',
  'nav.signOut': 'Sign out',
  'nav.settings': 'Settings',
  'nav.skipToContent': 'Skip to content',
  'common.unreachable': 'The service is unreachable right now.',
  'common.notTranslated': 'not translated yet',
  'language.name.en': 'English',
  'language.name.ar': 'العربية',
} as const;

export type MessageKey = keyof typeof EN;

/**
 * A catalogue for a locale. Partial on purpose: a language arrives a key at a
 * time, and the type says so rather than forcing a placeholder for every key
 * nobody has translated.
 */
export type Catalogue = Partial<Record<MessageKey, string>>;

/**
 * Arabic (T-150). Empty until a fluent speaker fills it.
 *
 * The two entries that are here are the ones that are not translation: a
 * language's own name, which is a fact rather than a rendering of an English
 * phrase.
 */
export const AR: Catalogue = {
  'language.name.ar': 'العربية',
  'language.name.en': 'English',
};

const CATALOGUES: Partial<Record<Locale, Catalogue>> = {
  ar: AR,
};

export type MessageStatus = 'translated' | 'untranslated' | 'source';

export interface Message {
  /** What to render. Never blank, never machine output. */
  text: string;
  /**
   * `source` — this is the source language. `translated` — a translator wrote
   * it. `untranslated` — nobody has, and the English is standing in and must be
   * shown as standing in.
   */
  status: MessageStatus;
}

/**
 * The message for a key in a locale, with the truth about where it came from.
 *
 * The fallback is English, always, because a blank teaches a reader nothing and
 * a machine translation tells them something nobody checked. What the caller
 * must not do is drop the `status`: that is the part that keeps the fallback
 * honest.
 */
export function message(locale: Locale, key: MessageKey): Message {
  if (locale === DEFAULT_LOCALE) return { text: EN[key], status: 'source' };

  const translated = CATALOGUES[locale]?.[key];
  return translated === undefined
    ? { text: EN[key], status: 'untranslated' }
    : { text: translated, status: 'translated' };
}

/** Just the text, for the many places that render it directly. */
export function t(locale: Locale, key: MessageKey): string {
  return message(locale, key).text;
}

/** How much of the catalogue a locale actually has, `0`–`1`. */
export function completeness(locale: Locale): number {
  if (locale === DEFAULT_LOCALE) return 1;
  const keys = Object.keys(EN) as MessageKey[];
  const have = keys.filter((key) => CATALOGUES[locale]?.[key] !== undefined);
  return have.length / keys.length;
}

/**
 * Whether a locale is finished enough to be offered as a language.
 *
 * Below this it still routes and still renders — that is how a translator sees
 * their work in place — but it is not indexed and not presented to a reader as
 * a language the product speaks. Shipping a half-translated locale as a
 * finished one is the language version of faking coverage.
 */
export const SHIPPABLE_COMPLETENESS = 0.95;

export function isShippable(locale: Locale): boolean {
  return completeness(locale) >= SHIPPABLE_COMPLETENESS;
}
