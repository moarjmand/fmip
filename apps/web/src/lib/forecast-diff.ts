import type { ForecastVersion, ModelInputs } from '@fmip/contracts';
import { formatFixed } from './words';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, plural, t, type MessageKey } from '@/i18n/messages';
import { kindLabel } from './forecast';

/**
 * What changed between two forecast versions, and what can honestly be blamed
 * for it (T-121, blueprint 6.4).
 *
 * The blueprint's example is "a team's win probability fell after a key starter
 * was excluded from the confirmed line-up". **We cannot say that, and this file
 * is careful not to.** The model is fitted on historical results (D-009); it
 * does not take a line-up as an input at all. So a `lineups_confirmed` version
 * is a forecast *computed when the line-up was confirmed*, not one *computed
 * from the line-up*, and the difference between it and the early version is
 * whatever really moved: more matches in the fit, a later fit date, a new model
 * version.
 *
 * Saying that plainly is worth more than a plausible sentence nobody can check,
 * and it becomes the real thing the day line-ups reach the model (T-101, T-112).
 */

/** One input that differs between two versions. */
export interface InputChange {
  key: keyof ModelInputs;
  label: string;
  before: string;
  after: string;
}

/** Each input's name, as a catalogue key (T-1303). */
export const INPUT_LABEL = {
  model_version: 'forecast.input.modelVersion',
  fit_date: 'forecast.input.fitDate',
  matches_used: 'forecast.input.matchesUsed',
  elo_used: 'forecast.input.eloUsed',
  history_from: 'forecast.input.historyFrom',
  data_completeness: 'forecast.input.dataCompleteness',
} as const satisfies Record<keyof ModelInputs, MessageKey>;

const COMPLETENESS_KEY = {
  available: 'status.coverage.available',
  limited: 'status.coverage.limited',
} as const satisfies Record<ModelInputs['data_completeness'], MessageKey>;

function shown(
  key: keyof ModelInputs,
  value: ModelInputs[keyof ModelInputs],
  locale: Locale,
): string {
  if (key === 'elo_used')
    return t(locale, value === true ? 'forecast.input.used' : 'forecast.input.notUsed');
  if (value === null) return t(locale, 'forecast.input.none');
  if (typeof value === 'number') return formatFixed(locale, value, 0);
  if (key === 'data_completeness' && (value === 'available' || value === 'limited')) {
    return t(locale, COMPLETENESS_KEY[value]);
  }
  return String(value);
}

/** Every input that differs, in the order the labels are declared, in the reader's words. */
export function inputChanges(
  before: ModelInputs | null,
  after: ModelInputs | null,
  locale = 'en',
): InputChange[] {
  if (before === null || after === null) return [];
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const keys = Object.keys(INPUT_LABEL) as (keyof ModelInputs)[];
  return keys
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      key,
      label: t(l, INPUT_LABEL[key]),
      before: shown(key, before[key], l),
      after: shown(key, after[key], l),
    }));
}

/**
 * The change in words, attributed only as far as it can be.
 *
 * Three cases, and the third is the one that matters. One input moved: name it.
 * Several moved: say so, because a re-run with one of them held constant is the
 * only thing that could separate them and we did not do it. **Nothing moved:**
 * say that too — the probabilities are identical, or they differ only by the
 * model being asked again, and pretending a reason exists would be the invention
 * rule 3 forbids.
 */
export function attribute(
  previous: ForecastVersion,
  current: ForecastVersion,
  locale = 'en',
): string {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const kind = kindLabel(current.kind, locale).toLowerCase();
  const changes = inputChanges(previous.inputs, current.inputs, locale);

  if (previous.inputs === null || current.inputs === null) {
    return interpolate(t(l, 'forecast.attribution.noInputs'), { kind });
  }

  const lineupCaveat =
    current.kind === 'lineups_confirmed' ? ` ${t(l, 'forecast.attribution.lineupCaveat')}` : '';

  if (changes.length === 0) {
    return `${t(l, 'forecast.attribution.nothing')}${lineupCaveat}`;
  }
  if (changes.length === 1) {
    const only = changes[0] as InputChange;
    return `${interpolate(t(l, 'forecast.attribution.one'), {
      label: only.label,
      before: only.before,
      after: only.after,
    })}${lineupCaveat}`;
  }
  const named = changes.map((change) =>
    interpolate(t(l, 'forecast.attribution.change'), {
      label: change.label,
      before: change.before,
      after: change.after,
    }),
  );
  return `${
    plural(l, 'forecast.attribution.several', changes.length, {
      list: named.join(t(l, 'forecast.listSeparator')),
    }).text
  }${lineupCaveat}`;
}
