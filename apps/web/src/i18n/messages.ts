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

import { DEFAULT_LOCALE, UNFINISHED_LOCALES, type Locale } from './locales';

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
  'nav.searchLabel': 'Search teams, competitions and players',
  'common.unreachable': 'The service is unreachable right now.',
  'language.name.en': 'English',
  // The eight languages of blueprint 13, named in English because this is the
  // English catalogue. In each locale's own catalogue exactly one of these is
  // a fact rather than a translation -- see `AUTONYMS` below.
  'language.name.ar': 'Arabic',
  'language.name.de': 'German',
  'language.name.es': 'Spanish',
  'language.name.fr': 'French',
  'language.name.it': 'Italian',
  'language.name.pt': 'Portuguese',
  'language.name.tr': 'Turkish',
} as const;

export type MessageKey = keyof typeof EN;

/*
 * `common.notTranslated` used to be here and is gone (T-300). Nothing rendered
 * it: the fallback is marked structurally, with `lang="en"` and a data
 * attribute, which a screen reader and a browser's translation offer can both
 * act on -- a visible "not translated yet" beside every string would be noise
 * that only a reader who does not need it can see.
 *
 * A key nobody renders is not free. `completeness()` divides by the number of
 * keys, so a dead one makes every locale look further behind than it is, and
 * the first translator to reach it would have spent time on a string that goes
 * nowhere. `messages.spec.ts` now fails on a key with no call site.
 */

/**
 * A catalogue for a locale. Partial on purpose: a language arrives a key at a
 * time, and the type says so rather than forcing a placeholder for every key
 * nobody has translated.
 */
export type Catalogue = Partial<Record<MessageKey, string>>;

/**
 * The one entry a catalogue may hold before a translator touches it: the
 * language's **own** name, written the way that language writes it.
 *
 * That is a fact, not a rendering of an English phrase — `Español` is `Español`
 * whoever is reading. Everything else, including what Spanish calls *German*,
 * is a translation and waits for a fluent speaker (blueprint 13.1).
 *
 * Note what is deliberately **not** here. Arabic used to carry
 * `language.name.en: 'English'`, and that is not an autonym: the Arabic for
 * English is `الإنجليزية`, and shipping the Latin word under `status:
 * 'translated'` claimed somebody had translated it. Falling back and being
 * marked `untranslated` is the smaller lie, which is to say none.
 */
const AUTONYMS = {
  ar: 'العربية',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  tr: 'Türkçe',
} as const satisfies Record<(typeof UNFINISHED_LOCALES)[number], string>;

/** Arabic (T-150). Exported because `messages.spec.ts` argues about it by name. */
export const AR: Catalogue = { 'language.name.ar': AUTONYMS.ar };

const CATALOGUES: Partial<Record<Locale, Catalogue>> = Object.fromEntries(
  UNFINISHED_LOCALES.map((locale) => [locale, { [`language.name.${locale}`]: AUTONYMS[locale] }]),
);

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

/**
 * A message that goes in an **attribute** — a `placeholder`, a `title`, an
 * `aria-label` — with the marking that `Translated` cannot supply there.
 *
 * `Translated` marks a fallback by wrapping it in `<span lang="en">`, and an
 * attribute holds a string, not an element. Dropping the marking would leave
 * exactly one kind of text on the page that is English and silent about it, and
 * a placeholder is not a small piece of text: it is often the only instruction
 * an input carries.
 *
 * So the marking moves to the element that holds the attribute. `lang` on the
 * input is what HTML already provides for, and it is what a screen reader and a
 * browser's translation offer both act on — the same argument as `Translated`,
 * one level out.
 *
 * @example
 * const search = attribute(locale, 'nav.search');
 * <input placeholder={search.text} lang={search.lang} />
 */
export function attribute(locale: Locale, key: MessageKey): { text: string; lang?: string } {
  const { text, status } = message(locale, key);
  return status === 'untranslated' ? { text, lang: DEFAULT_LOCALE } : { text };
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
