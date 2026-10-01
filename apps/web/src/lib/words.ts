import type { ForecastUnavailableReason } from '@fmip/contracts';
import type { Message, MessageKey, PluralCategory, PluralKey } from '@/i18n/messages';
import { formatNumber, intlLocale } from '@/i18n/format';

/**
 * Words for the live surfaces (T-1303): the scores list and the match centre
 * render in client components, which may not import the catalogues (T-1040).
 * Their server pages resolve the keys listed here for the reader's locale
 * (`lib/words-server.ts`) and hand them down; these helpers fill them in.
 *
 * No catalogue import and no directive (the `Message` imports are types), so
 * this module is safe in a client bundle.
 */

/** A plural resolved for one locale: its forms, and whose rules choose among them. */
export interface ClientPlural {
  forms: Partial<Record<PluralCategory, string>> & { other: string };
  /** The `Intl` tag whose plural rules pick the form: English for a fallback. */
  rules: string;
  status: Message['status'];
}

/** Resolved sentences and plurals, for the reader's locale. */
export interface ClientWords<K extends MessageKey, P extends PluralKey = never> {
  locale: string;
  m: Record<K, Message>;
  p: Record<P, ClientPlural>;
}

/** `{name}` placeholders, filled from `params`; an unknown name is left as it is, visibly. */
export function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => params[name] ?? whole);
}

/** A message with its placeholders filled, keeping where it came from. */
export function filled(message: Message, params: Record<string, string>): Message {
  return { text: fill(message.text, params), status: message.status };
}

/**
 * A resolved plural for `count`: the form the rules choose, `{count}` in the
 * locale's own digits -- what `plural()` does on the server.
 */
export function pickPlural(
  plural: ClientPlural,
  locale: string,
  count: number,
  params: Record<string, string> = {},
): Message {
  const category = new Intl.PluralRules(plural.rules).select(count) as PluralCategory;
  const form = plural.forms[category] ?? plural.forms.other;
  return {
    text: fill(form, { count: formatNumber(locale, count), ...params }),
    status: plural.status,
  };
}

/** A number with exactly `digits` decimals, in the locale's digits: `46.4`, `۴۶٫۴`. */
export function formatFixed(locale: string, value: number, digits: number): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(Object.is(value, -0) ? 0 : value);
}

/** A percentage already in percent units: `46.4%`, `۴۶٫۴٪`. */
export function formatPercent(locale: string, value: number, digits = 1): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

/**
 * `+4.2` / `−4.2` / `0` in the locale's digits, the sign written out as
 * `lib/triple.ts`'s `signed` writes it (U+2212 for minus).
 */
export function formatSigned(locale: string, value: number, digits = 1): string {
  if (value === 0) return formatNumber(locale, 0);
  const magnitude = formatFixed(locale, Math.abs(value), digits);
  return value > 0 ? `+${magnitude}` : `−${magnitude}`;
}

/** A live minute, `67′` or `45+2′`, in the locale's digits. */
export function formatMinute(locale: string, minute: number, addedTime: number | null): string {
  const n = (v: number): string => formatNumber(locale, v);
  return addedTime !== null && addedTime > 0 ? `${n(minute)}+${n(addedTime)}′` : `${n(minute)}′`;
}

/**
 * Why a forecast version has no probabilities, as a catalogue key: the card
 * (client) and the forecast panel (server) name the reason the same way.
 */
export const FORECAST_REASON_KEY = {
  team_not_mapped: 'forecast.reason.teamNotMapped',
  no_history: 'forecast.reason.noHistory',
  division_not_loaded: 'forecast.reason.divisionNotLoaded',
  competition_not_mapped: 'forecast.reason.competitionNotMapped',
  cross_competition: 'forecast.reason.crossCompetition',
  model_unreachable: 'forecast.reason.modelUnreachable',
  contract_violation: 'forecast.reason.contractViolation',
} as const satisfies Record<ForecastUnavailableReason, MessageKey>;
