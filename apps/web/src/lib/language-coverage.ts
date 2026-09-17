import { DEFAULT_LOCALE, LOCALES, type Locale, isPseudoLocale } from '@/i18n/locales';
import { EN, type Coverage, TRANSLATION_FILES, coverage, isShippable } from '@/i18n/messages';

/**
 * How far each language has got, as the operator's table on `/admin` shows it
 * (T-302, D-066). Pure: the component renders these rows and computes nothing.
 *
 * The numbers come from the translators' own files through `coverage()`, and
 * nothing here computes a second version of them: a second arithmetic would
 * be a second answer to the same question, and the day the two disagreed the
 * operator and the translator would be reading different truths about the
 * same file. `offered` is `isShippable`, the same test the picker (T-306) will
 * use, so what the operator reads as "not yet offered" is exactly what a
 * reader is not shown.
 */
export interface LanguageRow {
  locale: Locale;
  /** The language's own name, from its file; English for English. */
  autonym: string;
  /** The English name, which is what an English-reading operator recognises. */
  name: string;
  coverage: Coverage;
  /** Whole percent of keys that are done, rounded down: 94.9% is not 95%. */
  percent: number;
  offered: boolean;
}

/**
 * The catalogue key that names each language, written out rather than built
 * from the locale. Two reasons. The compiler checks each one exists in the
 * source catalogue, which a template built from the locale would not. And the
 * dead-key guard in `messages.spec.ts` looks for a key's literal in the code,
 * so this table is the evidence that these eight keys have a surface -- which
 * they did not, from T-300 until T-302.
 */
const NAME_KEY = {
  en: 'language.name.en',
  ar: 'language.name.ar',
  de: 'language.name.de',
  es: 'language.name.es',
  fr: 'language.name.fr',
  it: 'language.name.it',
  pt: 'language.name.pt',
  tr: 'language.name.tr',
} as const satisfies Record<Exclude<Locale, 'x-rtl'>, keyof typeof EN>;

/** One row per real locale, English first, the rest in the order they ship. */
export function languageRows(): LanguageRow[] {
  return LOCALES.filter((locale) => !isPseudoLocale(locale)).map((locale) => {
    const key = NAME_KEY[locale as keyof typeof NAME_KEY];
    const c = coverage(locale);
    const own =
      locale === DEFAULT_LOCALE
        ? EN[key]
        : (TRANSLATION_FILES[locale as keyof typeof TRANSLATION_FILES]?.[key]?.text ?? '');
    return {
      locale,
      autonym: own === '' ? EN[key] : own,
      name: EN[key],
      coverage: c,
      percent: Math.floor(((c.total - c.untranslated) / c.total) * 100),
      offered: isShippable(locale),
    };
  });
}
