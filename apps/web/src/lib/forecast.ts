import type {
  ForecastKind,
  ForecastUnavailableReason,
  ForecastVersion,
  ModelLeadingFactorKind,
  ModelProbabilities,
} from '@fmip/contracts';

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
  const values = [p.home, p.draw, p.away].map((v) => Math.round(v * 1000));
  const gap = 1000 - values.reduce((a, b) => a + b, 0);
  const largest = values.indexOf(Math.max(...values));
  values[largest] = (values[largest] ?? 0) + gap;
  return {
    home: (values[0] ?? 0) / 10,
    draw: (values[1] ?? 0) / 10,
    away: (values[2] ?? 0) / 10,
  };
}

export const KIND_LABEL: Record<ForecastKind, string> = {
  early: 'Early pre-match',
  lineups_predicted: 'Predicted line-ups',
  lineups_confirmed: 'Confirmed line-ups',
  manual: 'Manual recomputation',
};

export const FACTOR_LABEL: Record<ModelLeadingFactorKind, string> = {
  team_strength: 'Team strength',
  home_advantage: 'Home advantage',
  attack_vs_defence: 'Attack against defence',
};

export const UNAVAILABLE_LABEL: Record<ForecastUnavailableReason, string> = {
  team_not_mapped: 'The model does not know one of the teams yet.',
  no_history: 'The model has too little match history for one of the teams.',
  division_not_loaded: "This competition's history is not loaded into the model.",
  competition_not_mapped: 'This competition is not mapped to the model.',
  model_unreachable: 'The model service could not be reached when this version was computed.',
  contract_violation: "The model's answer did not match the contract and was not used.",
};

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
export function framing(p: ModelProbabilities, home: string, away: string): string {
  const { outcome, margin } = favourite(p);
  const side = outcome === 'home' ? home : outcome === 'away' ? away : 'a draw';
  if (margin < 5) {
    return `The model sees this as close: ${side} is ahead by ${margin.toFixed(1)} points, which is within the noise of a football match.`;
  }
  return `The model gives ${side} the most probability, ${margin.toFixed(1)} points ahead of the next outcome. Every outcome remains possible; these are probabilities, not a prediction of the result.`;
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
export function describeChange(change: VersionChange, home: string, away: string): string | null {
  if (change.delta === null) return null;
  const sign = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  const d = change.delta;
  if (d.home === 0 && d.draw === 0 && d.away === 0) {
    return `No change in probabilities (${KIND_LABEL[change.version.kind].toLowerCase()}).`;
  }
  return `${home} ${sign(d.home)}, draw ${sign(d.draw)}, ${away} ${sign(d.away)} points (${KIND_LABEL[change.version.kind].toLowerCase()}).`;
}
