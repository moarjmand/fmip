import type { ForecastVersion, ModelInputs } from '@fmip/contracts';
import { KIND_LABEL } from './forecast';

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

export const INPUT_LABEL: Record<keyof ModelInputs, string> = {
  model_version: 'model version',
  fit_date: 'history up to',
  matches_used: 'matches in the fit',
  elo_used: 'long-term ratings',
  history_from: 'history from',
  data_completeness: 'input completeness',
};

function shown(key: keyof ModelInputs, value: ModelInputs[keyof ModelInputs]): string {
  if (key === 'elo_used') return value === true ? 'used' : 'not used';
  return value === null ? 'none' : String(value);
}

/** Every input that differs, in the order the labels are declared. */
export function inputChanges(before: ModelInputs | null, after: ModelInputs | null): InputChange[] {
  if (before === null || after === null) return [];
  const keys = Object.keys(INPUT_LABEL) as (keyof ModelInputs)[];
  return keys
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      key,
      label: INPUT_LABEL[key],
      before: shown(key, before[key]),
      after: shown(key, after[key]),
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
export function attribute(previous: ForecastVersion, current: ForecastVersion): string {
  const kind = KIND_LABEL[current.kind].toLowerCase();
  const changes = inputChanges(previous.inputs, current.inputs);

  if (previous.inputs === null || current.inputs === null) {
    return `The ${kind} version reported no inputs, so nothing can be attributed.`;
  }

  const lineupCaveat =
    current.kind === 'lineups_confirmed'
      ? ' The model does not read line-ups yet, so this version is one computed when the line-up was confirmed, not one computed from it.'
      : '';

  if (changes.length === 0) {
    return `Nothing the model reads changed between these two versions.${lineupCaveat}`;
  }
  if (changes.length === 1) {
    const only = changes[0] as InputChange;
    return `Only one input changed: ${only.label}, from ${only.before} to ${only.after}.${lineupCaveat}`;
  }
  const named = changes.map((change) => `${change.label} (${change.before} → ${change.after})`);
  return `${changes.length} inputs changed together — ${named.join(', ')} — so the move cannot be put down to any one of them.${lineupCaveat}`;
}
