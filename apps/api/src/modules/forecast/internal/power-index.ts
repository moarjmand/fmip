/**
 * The Power Index formula (blueprint 6.1, T-110).
 *
 * A versioned config in one file, the same shape as the Performance Rating
 * formula (D-035): changing a weight is a new version, so two published indexes
 * are never compared across different arithmetic.
 *
 * Pure. It takes component values that somebody else measured and combines
 * them; it does not know where a value came from, which is what lets T-111 and
 * T-112 add sources without touching the arithmetic — and lets the arithmetic be
 * argued with in a test.
 *
 * **The rule that shapes it.** A component nothing supplied is `not_supplied`
 * and its weight is redistributed across the components that did arrive. The
 * alternative — substituting a neutral 0.5 — would be inventing a value (rule
 * 3), and worse, it would drag every index towards the middle by an amount
 * nobody could see. Redistributing changes the number honestly and publishes
 * `completeness` so the reader knows how much of the picture they have.
 */

import {
  POWER_INDEX_COMPONENTS,
  POWER_INDEX_WEIGHTS,
  type CoverageState,
  type PowerIndexComponent,
  type PowerIndexComponentValue,
} from '@fmip/contracts';

export const POWER_INDEX_FORMULA_VERSION = 'power-index@1.1.0';

/** At most this many leading factors are named, however many are supplied. */
export const LEADING_FACTORS = 3;

/**
 * How far from the middle a component has to be before it is worth naming as a
 * leading factor. A component at 0.52 is not why a team is strong.
 */
export const LEADING_THRESHOLD = 0.1;

/** What a measurement of one component looks like before it is combined. */
export interface Measurement {
  /** Position in the distribution, `0`–`1`, or `null` when nothing supplied it. */
  value: number | null;
  /** `available` or `limited` when supplied. Ignored when `value` is null. */
  state?: Extract<CoverageState, 'available' | 'limited'>;
  note?: string;
}

export type Measurements = Partial<Record<PowerIndexComponent, Measurement>>;

export interface Combined {
  /** 0–100, one decimal. */
  value: number;
  /** Share of the formula's weight that was supplied, `0`–`1`. */
  completeness: number;
  components: PowerIndexComponentValue[];
  leading: PowerIndexComponent[];
  formulaVersion: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Combines measurements into an index, or reports that there is none.
 *
 * Returns `null` when nothing at all was supplied: an index built from no
 * component is not a weak index, it is the absence of one, and publishing 50
 * there would be the most misleading number on the page.
 */
export function combine(
  measured: Measurements,
  /**
   * The weights to use. Defaults to the published ones; T-113's backtest passes
   * candidates here so alternatives are scored through exactly this code rather
   * than through a second copy of it that might drift.
   */
  weights: Partial<Record<PowerIndexComponent, number>> = POWER_INDEX_WEIGHTS,
): Combined | null {
  const components: PowerIndexComponentValue[] = [];
  let suppliedWeight = 0;

  for (const key of POWER_INDEX_COMPONENTS) {
    const weight = weights[key] ?? 0;
    const measurement = measured[key];
    const value =
      measurement === undefined || measurement.value === null ? null : clamp01(measurement.value);

    // A candidate weight set that leaves a component out gives it weight 0, and
    // a component carrying no weight is not part of that index at all.
    if (value === null || weight === 0) {
      components.push({
        key,
        weight,
        value: weight === 0 ? value : null,
        state: value === null ? 'not_supplied' : (measurement?.state ?? 'available'),
        note: measurement?.note ?? null,
      });
      continue;
    }

    suppliedWeight += weight;
    components.push({
      key,
      weight,
      value: round(value, 4),
      state: measurement?.state ?? 'available',
      note: measurement?.note ?? null,
    });
  }

  if (suppliedWeight === 0) return null;

  // The redistribution: each supplied component's share of the weight that
  // actually arrived, rather than of the weight the formula wanted.
  let total = 0;
  for (const component of components) {
    if (component.value === null) continue;
    total += component.value * (component.weight / suppliedWeight);
  }

  return {
    value: round(clamp01(total) * 100, 1),
    completeness: round(suppliedWeight, 4),
    components,
    leading: leadingFactors(components),
    formulaVersion: POWER_INDEX_FORMULA_VERSION,
  };
}

/**
 * The components that moved this index furthest from the middle, strongest
 * first — what the blueprint calls the leading factors.
 *
 * Distance from 0.5 weighted by the weight it carried, because a component that
 * is extreme but counts for a twentieth of the index did not lead anything. A
 * component nobody supplied cannot lead, and neither can one sitting on the
 * middle: naming those would fill the panel with words that explain nothing.
 */
export function leadingFactors(components: PowerIndexComponentValue[]): PowerIndexComponent[] {
  return components
    .filter((component) => component.value !== null)
    .map((component) => ({
      key: component.key,
      pull: Math.abs((component.value as number) - 0.5) * component.weight,
      distance: Math.abs((component.value as number) - 0.5),
    }))
    .filter((component) => component.distance >= LEADING_THRESHOLD)
    .sort((a, b) => b.pull - a.pull || a.key.localeCompare(b.key))
    .slice(0, LEADING_FACTORS)
    .map((component) => component.key);
}
