import type { Territory, ViewingTerritory } from '@fmip/contracts';
import { intlLocale } from '@/i18n/format';

export interface TerritoryOption {
  value: string;
  label: string;
}

/**
 * The name of a territory in the reader's language, from the platform's
 * own region names where it has them, else the API's English name. Nothing
 * is translated here: `Intl.DisplayNames` is the browser's and Node's own
 * data, the same source the languages band trusts for dates and plurals.
 */
export function territoryName(locale: string, territory: Territory): string {
  try {
    const names = new Intl.DisplayNames([intlLocale(locale)], { type: 'region', fallback: 'none' });
    return names.of(territory.code) ?? territory.name;
  } catch {
    return territory.name;
  }
}

/**
 * The chooser's options (T-312): the empty choice first, spelled as a
 * sentence rather than a blank, then every territory by its name in the
 * reader's language and sorted for that language -- the API's order is the
 * database's collation and is not the reader's.
 */
export function territoryOptions(
  locale: string,
  territories: Territory[],
  notChosenLabel: string,
): TerritoryOption[] {
  const collator = new Intl.Collator(intlLocale(locale));
  const named = territories
    .map((t) => ({ value: t.code, label: territoryName(locale, t) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  return [{ value: '', label: notChosenLabel }, ...named];
}

/** The chooser's current value: the code, or the empty choice. */
export function territoryValue(viewing: ViewingTerritory): string {
  return viewing.state === 'chosen' ? viewing.territory.code : '';
}
