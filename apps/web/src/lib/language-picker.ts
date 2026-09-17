import { LOCALES, type Locale, isPseudoLocale, localeFromPathname } from '@/i18n/locales';
import { isShippable, message } from '@/i18n/messages';

/**
 * The language picker's contents (T-306): the languages the product actually
 * speaks, and nothing else.
 *
 * **A locale appears the day its catalogue crosses `SHIPPABLE_COMPLETENESS`,
 * and never before.** The test is `isShippable`, the same one `/admin`'s
 * language table reports, so what the operator reads as "not yet offered" is
 * exactly what a reader is not shown. Until T-300 nothing in the product
 * offered a language at all, which made the acceptance criterion "none of the
 * six is offered as a finished language" true by there being no offer; this is
 * what makes it a real one.
 *
 * **Fewer than two is not a choice.** With only English shippable -- today --
 * the picker renders nothing, on purpose and under test: a menu with one entry
 * is furniture, and furniture that appears the day a second language is done
 * is the honest signal. The predicate is a parameter so the spec can show both
 * states without editing a catalogue.
 */
export interface PickerEntry {
  locale: Locale;
  /** The language's own name, from its own catalogue: a fact, not a translation. */
  autonym: string;
  /** The same page in that language. */
  href: string;
  current: boolean;
}

/** Locales a reader may be offered, in the order they ship. */
export function offeredLocales(shippable: (locale: Locale) => boolean = isShippable): Locale[] {
  return LOCALES.filter((locale) => !isPseudoLocale(locale) && shippable(locale));
}

/**
 * The same pathname under another locale. The locale is the first segment when
 * there is one (`/es/scores` → `/fr/scores`); a pathname without one -- which
 * the proxy never serves, but a link may still be built from -- is prefixed.
 */
export function switchLocale(pathname: string, to: Locale): string {
  const current = localeFromPathname(pathname);
  if (current === undefined) return `/${to}${pathname === '/' ? '' : pathname}`;
  const rest = pathname.slice(`/${current}`.length);
  return `/${to}${rest}`;
}

/**
 * What the picker shows for a reader on `pathname`, or `[]` when there is no
 * choice to offer. `[]` rather than the one entry, so a caller cannot render
 * a one-item menu by forgetting to check.
 */
export function pickerEntries(
  pathname: string,
  shippable: (locale: Locale) => boolean = isShippable,
): PickerEntry[] {
  const offered = offeredLocales(shippable);
  if (offered.length < 2) return [];
  const current = localeFromPathname(pathname);
  return offered.map((locale) => ({
    locale,
    autonym: message(locale, `language.name.${locale}` as Parameters<typeof message>[1]).text,
    href: switchLocale(pathname, locale),
    current: locale === current,
  }));
}
