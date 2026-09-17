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
 *
 * **Where the words live (T-302, D-066).** In `catalogues/`, as JSON a
 * translator edits directly: `en.json` is the source, and each other locale's
 * file carries every key with the English beside it and a `status` a person
 * set. `scripts/i18n-catalogues.mjs` keeps those files in step with the source
 * and never touches a translation; `messages.spec.ts` fails if a file is stale
 * or claims a status its text does not support. This module only reads them.
 *
 * **Plurals (T-301, D-067).** A key whose English is an object of forms is a
 * plural. Its forms are keyed by CLDR category, the category for a count comes
 * from `Intl.PluralRules` for the locale, and a translated entry that lacks a
 * category its language *has* fails the spec rather than falling back — a
 * fallback there is a sentence that is wrong in a way only a native speaker
 * sees. `type: "ordinal"` selects the ordinal rules ("1st", "2nd") instead.
 */

import { DEFAULT_LOCALE, UNFINISHED_LOCALES, type Locale } from './locales';
import { formatNumber, intlLocale } from './format';
import en from './catalogues/en.json';
import ar from './catalogues/ar.json';
import de from './catalogues/de.json';
import es from './catalogues/es.json';
import fr from './catalogues/fr.json';
import it from './catalogues/it.json';
import pt from './catalogues/pt.json';
import tr from './catalogues/tr.json';

/**
 * Every message the product shows, by key.
 *
 * The English catalogue is the source of truth: a key that is not here does not
 * exist, and `MessageKey` makes asking for one a type error rather than a blank
 * on a page. The keys are the JSON file's own, which is what makes the file
 * the source rather than a copy of one.
 */
export const EN = en;

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

/** The CLDR plural categories. Which ones a locale has is `Intl`'s to say. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export const PLURAL_CATEGORIES: readonly PluralCategory[] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
];

/**
 * A plural's forms. `other` is the one category every language has, so it is
 * the one the type requires; the rest are whatever the language needs, and the
 * spec holds each locale's file to exactly its own set.
 */
export type PluralForms = { other: string } & Partial<Record<PluralCategory, string>> & {
    /** `ordinal` for "1st, 2nd"; absent means cardinal. */
    type?: 'ordinal';
  };

/** The keys whose English is a plural rather than a sentence. */
export type PluralKey = {
  [K in MessageKey]: (typeof EN)[K] extends string ? never : K;
}[MessageKey];

export function isPluralKey(key: MessageKey): key is PluralKey {
  return typeof EN[key] !== 'string';
}

/**
 * What a translator's file says about one key.
 *
 * `untranslated` — nobody has written it; `text` is empty and the page shows
 * English and says so. `translated` — a fluent speaker wrote it. `reviewed` —
 * a second fluent speaker approved it (blueprint 13.2's review step). The last
 * two render the same way: both are a person's words. The distinction is for
 * whoever is deciding whether a language is done, not for the reader.
 */
export type TranslationStatus = 'untranslated' | 'translated' | 'reviewed';

export interface TranslationEntry {
  /** The English, copied in so the translator sees it beside their work. */
  source: string | PluralForms;
  /** The translation, or empty when there is none. Sentences only. */
  text?: string;
  /** The translation's forms, in the locale's own categories. Plurals only. */
  forms?: Partial<Record<PluralCategory, string>>;
  status: TranslationStatus;
  /** A translator's or reviewer's remark, kept with the entry. */
  note?: string;
}

/** A translator's file: every source key, whether translated or not. */
export type TranslationFile = Record<MessageKey, TranslationEntry>;

/**
 * A catalogue for a locale. Partial on purpose: a language arrives a key at a
 * time, and the type says so rather than forcing a placeholder for every key
 * nobody has translated.
 */
export type Catalogue = Partial<Record<MessageKey, string | PluralForms>>;

/**
 * The seven translators' files, by locale. Typed as `TranslationFile` here
 * rather than trusting the JSON's inferred shape, so a file that drifts from
 * the source keys is a type error and not a silent miss.
 */
export const TRANSLATION_FILES: Record<(typeof UNFINISHED_LOCALES)[number], TranslationFile> = {
  ar: ar as TranslationFile,
  de: de as TranslationFile,
  es: es as TranslationFile,
  fr: fr as TranslationFile,
  it: it as TranslationFile,
  pt: pt as TranslationFile,
  tr: tr as TranslationFile,
};

/** Whether an entry carries any words at all. */
function hasWords(entry: TranslationEntry): boolean {
  if (typeof entry.text === 'string' && entry.text !== '') return true;
  return Object.values(entry.forms ?? {}).some((form) => form !== undefined && form !== '');
}

/**
 * The words a locale actually has: every entry with a text or with forms. An
 * entry whose status says `translated` but which carries nothing is *not* a
 * translation, and the spec refuses the file; here the words decide, so a page
 * can never render a blank on the strength of a label.
 */
function catalogueOf(file: TranslationFile): Catalogue {
  const words: Catalogue = {};
  for (const key of Object.keys(file) as MessageKey[]) {
    const entry = file[key];
    if (!hasWords(entry)) continue;
    if (isPluralKey(key)) {
      const source = EN[key] as PluralForms;
      words[key] = {
        ...(entry.forms as PluralForms),
        ...(source.type === 'ordinal' ? { type: 'ordinal' as const } : {}),
      };
    } else if (typeof entry.text === 'string') {
      words[key] = entry.text;
    }
  }
  return words;
}

/** Arabic (T-150). Exported because `messages.spec.ts` argues about it by name. */
export const AR: Catalogue = catalogueOf(TRANSLATION_FILES.ar);

const CATALOGUES: Partial<Record<Locale, Catalogue>> = Object.fromEntries(
  UNFINISHED_LOCALES.map((locale) => [locale, catalogueOf(TRANSLATION_FILES[locale])]),
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

/** A sentence's text, or a plural's `other` form: the one every language has. */
function textOf(value: string | PluralForms): string {
  return typeof value === 'string' ? value : value.other;
}

/**
 * The message for a key in a locale, with the truth about where it came from.
 *
 * The fallback is English, always, because a blank teaches a reader nothing and
 * a machine translation tells them something nobody checked. What the caller
 * must not do is drop the `status`: that is the part that keeps the fallback
 * honest.
 *
 * For a plural key this is the `other` form with its placeholders unfilled --
 * enough to never be blank, which is what "never returns a blank" promises,
 * and not what a page should render. Pages render plurals through `plural()`.
 */
export function message(locale: Locale, key: MessageKey): Message {
  const source = EN[key] as string | PluralForms;
  if (locale === DEFAULT_LOCALE) return { text: textOf(source), status: 'source' };

  const translated = CATALOGUES[locale]?.[key];
  return translated === undefined
    ? { text: textOf(source), status: 'untranslated' }
    : { text: textOf(translated), status: 'translated' };
}

/** Just the text, for the many places that render it directly. */
export function t(locale: Locale, key: MessageKey): string {
  return message(locale, key).text;
}

/** `{name}` placeholders, filled from `params`; an unknown name is left as it is, visibly. */
export function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => params[name] ?? whole);
}

/**
 * A plural, chosen for `count` by the locale's own rules (T-301).
 *
 * The category comes from `Intl.PluralRules` -- cardinal, or ordinal when the
 * English says `type: "ordinal"` -- and the form for it from the locale's
 * catalogue when the entry is translated, otherwise from the English, marked
 * `untranslated` like any other fallback. `{count}` is filled with the number
 * in the locale's own digits and grouping; other `{name}` placeholders from
 * `params`.
 *
 * The `other` form is used only when the rules ask for it: a translated entry
 * missing a category its language has is refused by the spec, so at runtime
 * the form is always there. The `?? other` below is for the type, not for a
 * gap the spec would already have caught.
 */
export function plural(
  locale: Locale,
  key: PluralKey,
  count: number,
  params: Record<string, string> = {},
): Message {
  const source = EN[key] as PluralForms;
  const translated = locale === DEFAULT_LOCALE ? undefined : CATALOGUES[locale]?.[key];
  const forms: PluralForms =
    translated !== undefined && typeof translated !== 'string' ? translated : source;
  const status: MessageStatus =
    locale === DEFAULT_LOCALE ? 'source' : translated === undefined ? 'untranslated' : 'translated';
  // The English forms are selected by English rules: a fallback shown in
  // English must not be conjugated by Arabic arithmetic.
  const rulesFor = status === 'untranslated' ? DEFAULT_LOCALE : locale;
  const category = new Intl.PluralRules(intlLocale(rulesFor), {
    type: source.type === 'ordinal' ? 'ordinal' : 'cardinal',
  }).select(count) as PluralCategory;
  const form = forms[category] ?? forms.other;
  return {
    text: interpolate(form, { count: formatNumber(locale, count), ...params }),
    status,
  };
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

/**
 * How far a locale has got, as the product's own answer (T-302): "how much of
 * `tr` is done" is these four numbers, not a grep. `reviewed` is a subset of
 * what counts as done; it is reported so that whoever decides can see how much
 * of the done part a second speaker has read.
 */
export interface Coverage {
  total: number;
  untranslated: number;
  translated: number;
  reviewed: number;
}

export function coverage(locale: Locale): Coverage {
  const total = Object.keys(EN).length;
  if (locale === DEFAULT_LOCALE) return { total, untranslated: 0, translated: 0, reviewed: total };
  const file = (TRANSLATION_FILES as Partial<Record<Locale, TranslationFile>>)[locale];
  if (file === undefined) return { total, untranslated: total, translated: 0, reviewed: 0 };
  const counts: Coverage = { total, untranslated: 0, translated: 0, reviewed: 0 };
  for (const key of Object.keys(EN) as MessageKey[]) {
    const entry = file[key];
    if (entry === undefined || !hasWords(entry)) counts.untranslated += 1;
    else if (entry.status === 'reviewed') counts.reviewed += 1;
    else counts.translated += 1;
  }
  return counts;
}

/** How much of the catalogue a locale actually has, `0`–`1`. */
export function completeness(locale: Locale): number {
  const { total, untranslated } = coverage(locale);
  return (total - untranslated) / total;
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
