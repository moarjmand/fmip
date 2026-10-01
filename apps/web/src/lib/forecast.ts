import type {
  ForecastKind,
  ForecastUnavailableReason,
  ForecastVersion,
  ModelLeadingFactorKind,
  ModelProbabilities,
} from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t, type MessageKey } from '@/i18n/messages';
import { FORECAST_REASON_KEY, formatFixed } from './words';
import { sharesToPercentages } from './triple';

/** The page's locale as the catalogue takes it. */
const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/**
 * Pure helpers for the forecast panel (T-065, blueprint 6.1–6.4). The panel
 * explains and never asserts certainty: every number here is a probability
 * with its wording, every version carries its computation time, and what
 * changed between versions is computed, not guessed.
 */

/** Percent to one decimal, e.g. 46.4. */
export const toPercent = (p: number): number => Math.round(p * 1000) / 10;

/**
 * The three probabilities as percentages that total exactly 100.0 (blueprint
 * 6.2: "must always total 100% after rounding"). The largest absorbs the
 * rounding gap, as the API does at four decimals.
 */
export function percentages(p: ModelProbabilities): ModelProbabilities {
  // The arithmetic itself lives in `lib/triple.ts` since T-135, because it
  // belongs to neither product: the community consensus needs the same
  // rounding, and calling a function typed to `ModelProbabilities` from that
  // panel would put a model type on the community surface (rule 6).
  return sharesToPercentages(p);
}

const KIND_KEY = {
  early: 'forecast.kind.early',
  lineups_predicted: 'forecast.kind.lineupsPredicted',
  lineups_confirmed: 'forecast.kind.lineupsConfirmed',
  manual: 'forecast.kind.manual',
} as const satisfies Record<ForecastKind, MessageKey>;

const FACTOR_KEY = {
  team_strength: 'forecast.factor.teamStrength',
  home_advantage: 'forecast.factor.homeAdvantage',
  attack_vs_defence: 'forecast.factor.attackVsDefence',
} as const satisfies Record<ModelLeadingFactorKind, MessageKey>;

/** Which kind of version it is, in the reader's words (T-1303). */
export function kindLabel(kind: ForecastKind, locale = 'en'): string {
  return t(asLocale(locale), KIND_KEY[kind]);
}

/** A leading factor's name, in the reader's words. */
export function factorLabel(factor: ModelLeadingFactorKind, locale = 'en'): string {
  return t(asLocale(locale), FACTOR_KEY[factor]);
}

/** Why a version has no probabilities, in the reader's words. */
export function unavailableLabel(reason: ForecastUnavailableReason, locale = 'en'): string {
  return t(asLocale(locale), FORECAST_REASON_KEY[reason]);
}

/**
 * The line the factor list adds when a version was computed without the Elo
 * prior (T-920, D-111), read from the inputs stored with it, never from the
 * source's state now. `null` when the prior was used, or when the version
 * reported no inputs (an unavailable one has no factors to qualify).
 */
export function priorNote(version: Pick<ForecastVersion, 'inputs'>, locale = 'en'): string | null {
  if (version.inputs === null || version.inputs.elo_used) return null;
  return t(asLocale(locale), 'forecast.noEloPrior');
}

/** The outcome the model gives the most probability, and whether it is a clear lead. */
export function favourite(p: ModelProbabilities): {
  outcome: 'home' | 'draw' | 'away';
  margin: number;
} {
  const entries: ['home' | 'draw' | 'away', number][] = [
    ['home', p.home],
    ['draw', p.draw],
    ['away', p.away],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [first, second] = entries;
  return {
    outcome: first?.[0] ?? 'draw',
    margin: toPercent((first?.[1] ?? 0) - (second?.[1] ?? 0)),
  };
}

/**
 * The wording under the probabilities. Never "X will win": the model gives
 * every outcome a chance, and the sentence says how far apart they are.
 */
export function framing(p: ModelProbabilities, home: string, away: string, locale = 'en'): string {
  const l = asLocale(locale);
  const { outcome, margin } = favourite(p);
  const side = outcome === 'home' ? home : outcome === 'away' ? away : t(l, 'forecast.aDraw');
  return interpolate(t(l, margin < 5 ? 'forecast.framing.close' : 'forecast.framing.clear'), {
    side,
    margin: formatFixed(locale, margin, 1),
  });
}

export interface VersionChange {
  version: ForecastVersion;
  /** Percentage-point change of each outcome against the previous available version; null for the first. */
  delta: ModelProbabilities | null;
}

/** Oldest first; each available version compared with the previous available one. */
export function versionChanges(versions: ForecastVersion[]): VersionChange[] {
  let previous: ModelProbabilities | null = null;
  return versions.map((version) => {
    if (version.probabilities === null) return { version, delta: null };
    const current = percentages(version.probabilities);
    const delta =
      previous === null
        ? null
        : {
            home: Math.round((current.home - previous.home) * 10) / 10,
            draw: Math.round((current.draw - previous.draw) * 10) / 10,
            away: Math.round((current.away - previous.away) * 10) / 10,
          };
    previous = current;
    return { version, delta };
  });
}

/** "Liverpool +3.2, draw −1.0, Manchester United −2.2 after confirmed line-ups". */
export function describeChange(
  change: VersionChange,
  home: string,
  away: string,
  locale = 'en',
): string | null {
  if (change.delta === null) return null;
  const l = asLocale(locale);
  // `+3.2` / `-1.0` / `0.0`, as the line has always written it, in the locale's digits.
  const sign = (n: number): string =>
    `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatFixed(locale, Math.abs(n), 1)}`;
  const d = change.delta;
  const kind = kindLabel(change.version.kind, locale).toLowerCase();
  if (d.home === 0 && d.draw === 0 && d.away === 0) {
    return interpolate(t(l, 'forecast.change.none'), { kind });
  }
  return interpolate(t(l, 'forecast.change.moved'), {
    home,
    homeDelta: sign(d.home),
    drawDelta: sign(d.draw),
    away,
    awayDelta: sign(d.away),
    kind,
  });
}
