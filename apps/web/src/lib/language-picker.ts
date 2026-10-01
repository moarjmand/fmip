import { LOCALES, type Locale, isPreparingLocale, isPseudoLocale } from '@/i18n/locales';
import { isShippable, message } from '@/i18n/messages';
import { type OfferedLanguage, type PickerEntry, pickerEntriesFor } from '@/lib/language-switch';

export { type OfferedLanguage, type PickerEntry, switchLocale } from '@/lib/language-switch';

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
 *
 * **Server side (T-1040).** Deciding reads every catalogue, so this module is
 * for server components: the header calls `offeredLanguages()` and hands the
 * result to the picker, which makes the links with `language-switch.ts` and
 * never sees a catalogue.
 */

/** Locales a reader may be offered, in the order they ship. */
export function offeredLocales(shippable: (locale: Locale) => boolean = isShippable): Locale[] {
  return LOCALES.filter(
    (locale) => !isPseudoLocale(locale) && !isPreparingLocale(locale) && shippable(locale),
  );
}

/**
 * The offered locales with their autonyms: what the header hands the picker.
 * Fewer than two is still passed as it is; the picker's `[]` rule decides.
 */
export function offeredLanguages(
  shippable: (locale: Locale) => boolean = isShippable,
): OfferedLanguage[] {
  return offeredLocales(shippable).map((locale) => ({
    locale,
    autonym: message(locale, `language.name.${locale}` as Parameters<typeof message>[1]).text,
  }));
}

/** What the picker shows for a reader on `pathname`: `pickerEntriesFor` over `offeredLanguages`. */
export function pickerEntries(
  pathname: string,
  shippable: (locale: Locale) => boolean = isShippable,
): PickerEntry[] {
  return pickerEntriesFor(pathname, offeredLanguages(shippable));
}
