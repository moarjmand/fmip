import { describe, expect, it } from 'vitest';
import { COVERAGE_STATES, hasData, isCoverageState, type Covered } from './index';

describe('coverage states', () => {
  it('are exactly the four the architecture defines', () => {
    expect([...COVERAGE_STATES]).toEqual(['available', 'limited', 'not_supplied', 'delayed']);
  });

  it('rejects anything else', () => {
    expect(isCoverageState('available')).toBe(true);
    expect(isCoverageState('unknown')).toBe(false);
    expect(isCoverageState('')).toBe(false);
  });
});

describe('hasData', () => {
  const payload = <T>(coverage: Covered<T>['coverage'], data: T | null): Covered<T> => ({
    coverage,
    last_updated_at: '2026-09-09T05:00:00.000Z',
    data,
  });

  it('passes available data through', () => {
    expect(hasData(payload('available', { goals: 2 }))).toBe(true);
  });

  it('passes limited data: some fields missing is not all fields missing', () => {
    expect(hasData(payload('limited', { goals: 2 }))).toBe(true);
  });

  it('passes delayed data, which the caller must label rather than hide', () => {
    expect(hasData(payload('delayed', { goals: 2 }))).toBe(true);
  });

  it('rejects not_supplied even when something is attached', () => {
    // A module the provider does not cover must never render, whatever is in
    // `data`. This is the case rule 3 exists for.
    expect(hasData(payload('not_supplied', { goals: 0 }))).toBe(false);
  });

  it('rejects null data whatever the state claims', () => {
    expect(hasData(payload('available', null))).toBe(false);
  });

  it('narrows the type so `data` is no longer nullable', () => {
    const value = payload('available', { goals: 2 });

    if (hasData(value)) {
      expect(value.data.goals).toBe(2);
    } else {
      throw new Error('expected hasData to narrow');
    }
  });
});
