import type { PowerIndex, PowerIndexComponent, PowerIndexComponentValue } from '@fmip/contracts';
import { intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t, type MessageKey } from '@/i18n/messages';

/**
 * Wording for the Power Index panel (T-114, blueprint 6.1).
 *
 * The blueprint asks the public display to explain "the leading factors, data
 * completeness and the time of calculation". The first two need words rather
 * than numbers to be honest, and those words are here so they can be tested.
 * They are the reader's (T-1303); `locale` defaults to English.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** Each component's name, as a catalogue key; the contract's English labels are the source. */
const COMPONENT_KEY = {
  underlying_strength: 'powerIndex.component.underlyingStrength',
  recent_form: 'powerIndex.component.recentForm',
  lineup_quality: 'powerIndex.component.lineupQuality',
  venue: 'powerIndex.component.venue',
  rest_and_congestion: 'powerIndex.component.restAndCongestion',
  competition_context: 'powerIndex.component.competitionContext',
  stability: 'powerIndex.component.stability',
} as const satisfies Record<PowerIndexComponent, MessageKey>;

/** A component's name, in the reader's words. */
export function componentLabel(key: PowerIndexComponent, locale = 'en'): string {
  return t(asLocale(locale), COMPONENT_KEY[key]);
}

/** A whole-number percentage in the locale's digits and sign: `62%`, `۶۲٪`. */
export function percentLabel(percent: number, locale = 'en'): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(percent / 100);
}

/** The percentile as a sentence a reader can check, not a decimal. */
export function componentSentence(component: PowerIndexComponentValue, locale = 'en'): string {
  const l = asLocale(locale);
  if (component.value === null) return t(l, 'powerIndex.notAvailable');
  const percent = Math.round(component.value * 100);
  if (percent >= 90) return interpolate(t(l, 'powerIndex.top'), { percent: percentLabel(10, l) });
  if (percent <= 10) {
    return interpolate(t(l, 'powerIndex.bottom'), { percent: percentLabel(10, l) });
  }
  return interpolate(t(l, 'powerIndex.ahead'), { percent: percentLabel(percent, l) });
}

/**
 * What the completeness figure means, said plainly.
 *
 * A percentage alone invites the reader to treat 70% as "mostly right" when
 * what it means is "three of the seven things this index is meant to weigh were
 * not measurable". The sentence says which, because that is the part that
 * changes how much weight to put on the number.
 */
export function completenessSentence(index: PowerIndex, locale = 'en'): string {
  const l = asLocale(locale);
  const percent = Math.round(index.completeness * 100);
  const missing = index.components.filter((component) => component.value === null);
  if (missing.length === 0) return t(l, 'powerIndex.allMeasured');
  const names = missing.map((component) => componentLabel(component.key, l).toLowerCase());
  return interpolate(t(l, 'powerIndex.partlyMeasured'), {
    percent: percentLabel(percent, l),
    list: listed(names, l),
  });
}

/** The leading factors as a phrase, or an honest silence. */
export function leadingSentence(index: PowerIndex, locale = 'en'): string | null {
  if (index.leading.length === 0) return null;
  const l = asLocale(locale);
  const names = index.leading.map((key) => componentLabel(key, l).toLowerCase());
  return interpolate(t(l, 'powerIndex.drivenBy'), { list: listed(names, l) });
}

/** `a`, `a and b`, `a, b and c` — Oxford-free, which is what the rest of the UI uses. */
export function listed(items: string[], locale = 'en'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  const l = asLocale(locale);
  return interpolate(t(l, 'powerIndex.listAnd'), {
    items: items.slice(0, -1).join(t(l, 'powerIndex.listSeparator')),
    last: items[items.length - 1] as string,
  });
}

/** Width of a component's bar, as a percentage string. Absent means no bar at all. */
export function barWidth(component: PowerIndexComponentValue): string | null {
  return component.value === null ? null : `${Math.round(component.value * 100)}%`;
}
