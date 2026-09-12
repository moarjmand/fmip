import { describe, expect, it } from 'vitest';
import { POWER_INDEX_COMPONENTS, POWER_INDEX_WEIGHTS } from '@fmip/contracts';
import {
  LEADING_THRESHOLD,
  POWER_INDEX_FORMULA_VERSION,
  combine,
  leadingFactors,
  type Measurements,
} from './internal/power-index';

// The Power Index arithmetic (blueprint 6.1, T-110). The interesting question is
// never "what is the weighted mean" — it is what a missing component does to the
// number, and whether the reader is told.
describe('the published weights', () => {
  it("are the blueprint's, and sum to one", () => {
    expect(POWER_INDEX_WEIGHTS).toEqual({
      underlying_strength: 0.35,
      recent_form: 0.2,
      lineup_quality: 0.2,
      venue: 0.1,
      rest_and_congestion: 0.05,
      competition_context: 0.05,
      stability: 0.05,
    });
    const total = POWER_INDEX_COMPONENTS.reduce((sum, key) => sum + POWER_INDEX_WEIGHTS[key], 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('combining components into an index', () => {
  const all = (value: number): Measurements =>
    Object.fromEntries(POWER_INDEX_COMPONENTS.map((key) => [key, { value }])) as Measurements;

  it('is the weighted mean, on a 0-100 scale, when everything is supplied', () => {
    const result = combine(all(0.75));
    expect(result).not.toBeNull();
    expect(result?.value).toBe(75);
    expect(result?.completeness).toBe(1);
    expect(result?.formulaVersion).toBe(POWER_INDEX_FORMULA_VERSION);
  });

  it('keeps every component, including the ones nobody supplied', () => {
    const result = combine({ underlying_strength: { value: 0.9 } });
    expect(result?.components).toHaveLength(POWER_INDEX_COMPONENTS.length);
    const missing = result?.components.filter((c) => c.state === 'not_supplied') ?? [];
    expect(missing).toHaveLength(POWER_INDEX_COMPONENTS.length - 1);
    // Absent means absent: never zero, never a neutral 0.5 (rule 3).
    expect(missing.every((c) => c.value === null)).toBe(true);
  });

  it("redistributes a missing component's weight instead of substituting a value", () => {
    // Strength 0.9 and form 0.3, nothing else: 0.35 and 0.20 of the weight, so
    // the index is their mean weighted 35:20 — not dragged toward the middle by
    // five components that were never measured.
    const result = combine({
      underlying_strength: { value: 0.9 },
      recent_form: { value: 0.3 },
    });
    const expected = ((0.9 * 0.35 + 0.3 * 0.2) / 0.55) * 100;
    expect(result?.value).toBeCloseTo(expected, 1);
    expect(result?.completeness).toBeCloseTo(0.55, 4);

    // The alternative we rejected, for contrast: neutral fill would report 62.
    const neutralFill = 0.9 * 0.35 + 0.3 * 0.2 + 0.5 * 0.45;
    expect(result!.value / 100).not.toBeCloseTo(neutralFill, 2);
  });

  it('publishes the completeness the free data actually reaches', () => {
    // D-049: nothing supplies line-up quality or managerial stability, so a
    // fully working index on free data is 75% of the blueprint's weight.
    const measured: Measurements = {
      underlying_strength: { value: 0.7 },
      recent_form: { value: 0.6 },
      venue: { value: 0.55 },
      rest_and_congestion: { value: 0.5 },
      competition_context: { value: 0.5 },
    };
    expect(combine(measured)?.completeness).toBeCloseTo(0.75, 4);
  });

  it('reports no index at all rather than a middling one when nothing was supplied', () => {
    expect(combine({})).toBeNull();
    expect(combine({ underlying_strength: { value: null } })).toBeNull();
  });

  it('clamps a measurement that escaped its range instead of publishing it', () => {
    expect(combine({ underlying_strength: { value: 1.4 } })?.value).toBe(100);
    expect(combine({ underlying_strength: { value: -0.2 } })?.value).toBe(0);
  });

  it('carries the coverage state and the note of each component', () => {
    const result = combine({
      underlying_strength: { value: 0.8, state: 'limited', note: 'only 6 matches of history' },
      lineup_quality: { value: null, note: 'no player ratings on the free tier' },
    });
    expect(result?.components.find((c) => c.key === 'underlying_strength')).toMatchObject({
      state: 'limited',
      note: 'only 6 matches of history',
    });
    expect(result?.components.find((c) => c.key === 'lineup_quality')).toMatchObject({
      state: 'not_supplied',
      value: null,
      note: 'no player ratings on the free tier',
    });
  });
});

describe('the leading factors', () => {
  it('names what moved the index, strongest pull first', () => {
    const result = combine({
      underlying_strength: { value: 0.9 },
      recent_form: { value: 0.2 },
      venue: { value: 0.95 },
    });
    // Strength pulls 0.4 * 0.35, form 0.3 * 0.20, venue 0.45 * 0.10.
    expect(result?.leading).toEqual(['underlying_strength', 'recent_form', 'venue']);
  });

  it('never names more than three', () => {
    const result = combine(
      Object.fromEntries(
        POWER_INDEX_COMPONENTS.map((key) => [key, { value: 0.95 }]),
      ) as Measurements,
    );
    expect(result?.leading).toHaveLength(3);
  });

  it('ignores a component sitting on the middle, and one nobody supplied', () => {
    const result = combine({
      underlying_strength: { value: 0.5 + LEADING_THRESHOLD / 2 },
      recent_form: { value: 0.9 },
    });
    expect(result?.leading).toEqual(['recent_form']);

    expect(
      leadingFactors([
        { key: 'lineup_quality', weight: 0.2, value: null, state: 'not_supplied', note: null },
      ]),
    ).toEqual([]);
  });
});
