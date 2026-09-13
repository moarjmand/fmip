import { describe, expect, it } from 'vitest';
import type { ForecastVersion, ModelInputs } from '@fmip/contracts';
import { INPUT_LABEL, attribute, inputChanges } from './forecast-diff';

// Attributing what changed between two forecast versions (T-121). The point of
// the tests is the boundary of what may be claimed: the model does not read
// line-ups, so a confirmed-line-up version must never be described as though it
// did, and a move nobody can explain must be described as one.

function inputs(over: Partial<ModelInputs> = {}): ModelInputs {
  return {
    model_version: 'dixon-coles@1.0.0',
    fit_date: '2026-01-01',
    matches_used: 380,
    elo_used: false,
    history_from: '2024-08-01',
    data_completeness: 'available',
    ...over,
  };
}

function version(over: Partial<ForecastVersion> = {}): ForecastVersion {
  return {
    id: 'v',
    fixture_id: 'f',
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles@1.0.0',
    computed_at: '2026-01-05T12:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.5, draw: 0.25, away: 0.25 },
    expected_goals: { home: 1.5, away: 1.1 },
    most_likely_scorelines: null,
    leading_factors: null,
    data_completeness: 'available',
    inputs: inputs(),
    unavailable_reason: null,
    unavailable_detail: null,
    ...over,
  };
}

describe('which inputs moved', () => {
  it('lists each difference with its before and after', () => {
    const changes = inputChanges(inputs(), inputs({ matches_used: 400, elo_used: true }));
    expect(changes).toEqual([
      { key: 'matches_used', label: 'matches in the fit', before: '380', after: '400' },
      { key: 'elo_used', label: 'long-term ratings', before: 'not used', after: 'used' },
    ]);
  });

  it('finds nothing when the model was working from the same thing', () => {
    expect(inputChanges(inputs(), inputs())).toEqual([]);
  });

  it('reports nothing rather than guessing when a version carried no inputs', () => {
    expect(inputChanges(null, inputs())).toEqual([]);
    expect(inputChanges(inputs(), null)).toEqual([]);
  });

  it('has a label for every input the model reports', () => {
    for (const key of Object.keys(inputs()) as (keyof ModelInputs)[]) {
      expect(INPUT_LABEL[key]).toBeTruthy();
    }
  });
});

describe('what may be said about the change', () => {
  it('names the single input when only one moved', () => {
    const sentence = attribute(version(), version({ inputs: inputs({ matches_used: 400 }) }));
    expect(sentence).toBe('Only one input changed: matches in the fit, from 380 to 400.');
  });

  it('refuses to pick one when several moved together', () => {
    const sentence = attribute(
      version(),
      version({ inputs: inputs({ matches_used: 400, fit_date: '2026-01-04' }) }),
    );
    expect(sentence).toContain('2 inputs changed together');
    expect(sentence).toContain('cannot be put down to any one of them');
  });

  it('says nothing changed, rather than inventing a reason', () => {
    expect(attribute(version(), version())).toBe(
      'Nothing the model reads changed between these two versions.',
    );
  });

  it('never lets a confirmed line-up be described as though the model read it', () => {
    // The blueprint's example sentence is "the win probability fell after a key
    // starter was excluded". The model is fitted on results and does not take a
    // line-up as an input, so that sentence would be fiction.
    const confirmed = version({ kind: 'lineups_confirmed', inputs: inputs({ matches_used: 400 }) });
    const sentence = attribute(version(), confirmed);
    expect(sentence).toContain('does not read line-ups yet');
    expect(sentence).toContain('computed when the line-up was confirmed, not one computed from it');
  });

  it('says so when a version reported no inputs at all', () => {
    const unavailable = version({ status: 'unavailable', probabilities: null, inputs: null });
    expect(attribute(version(), unavailable)).toContain('reported no inputs');
  });
});
