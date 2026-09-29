import { type Locale, localeFromPathname } from '@/i18n/locales';

/**
 * The language picker's links (T-306), and nothing that needs a catalogue.
 *
 * Split from `language-picker.ts` (T-1040) because the picker is a client
 * component: which languages are offered is decided on the server, where the
 * catalogues are, and arrives as `OfferedLanguage[]`; what is left -- the same
 * page under another locale -- needs only the pathname, and this file only
 * `locales.ts`. Importing `i18n/messages` here would ship all eight catalogues
 * to every page; `client-catalogues.spec.ts` fails if anything on the client
 * does.
 */

/** A language the product offers, with its own name for itself. */
export interface OfferedLanguage {
  locale: Locale;
  /** The language's own name, from its own catalogue: a fact, not a translation. */
  autonym: string;
}

export interface PickerEntry extends OfferedLanguage {
  /** The same page in that language. */
  href: string;
  current: boolean;
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
 * What the picker shows for a reader on `pathname`, given the offered
 * languages, or `[]` when there is no choice to offer. `[]` rather than the
 * one entry, so a caller cannot render a one-item menu by forgetting to check.
 */
export function pickerEntriesFor(
  pathname: string,
  languages: readonly OfferedLanguage[],
): PickerEntry[] {
  if (languages.length < 2) return [];
  const current = localeFromPathname(pathname);
  return languages.map(({ locale, autonym }) => ({
    locale,
    autonym,
    href: switchLocale(pathname, locale),
    current: locale === current,
  }));
}
