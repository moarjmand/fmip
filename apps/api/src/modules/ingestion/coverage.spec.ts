import { describe, expect, it } from 'vitest';
import { COVERAGE_MODULES, compute } from './internal/coverage-rules';

// The rules that turn "of the fixtures that should carry this, how many do"
// into a coverage state (T-027, blueprint 4.3). Pure, so they can be argued
// with here rather than inferred from SQL.
describe('computing a coverage state from what arrived', () => {
  it('covers every module the contract names', () => {
    expect([...COVERAGE_MODULES].sort()).toEqual([
      'advanced_statistics',
      'availability',
      'incidents',
      'lineups',
      'scores',
      'standings',
      'statistics',
    ]);
  });

  it('is available only when every fixture that should have it does', () => {
    expect(compute('scores', { expected: 10, present: 10 }, null).state).toBe('available');
    expect(compute('scores', { expected: 10, present: 10 }, null).note).toContain('All 10');
  });

  it('is limited when some have it, and says how many', () => {
    const result = compute('lineups', { expected: 10, present: 3 }, 'available');
    expect(result.state).toBe('limited');
    expect(result.note).toBe('3 of 10 fixtures have lineups.');
  });

  it('does not let a declared state outrank the evidence', () => {
    // The failure rule 3 exists to prevent: a season promised `available` whose
    // line-ups never arrived would otherwise show an empty module as populated.
    expect(compute('lineups', { expected: 10, present: 0 }, 'available').state).toBe(
      'not_supplied',
    );
    expect(compute('lineups', { expected: 10, present: 4 }, 'available').state).toBe('limited');
  });

  it('separates "nothing yet" from "nothing supplied"', () => {
    // A season that has not kicked off owes nothing, and saying `not_supplied`
    // without saying why would read as "this provider does not serve it".
    const early = compute('incidents', { expected: 0, present: 0 }, null);
    expect(early.state).toBe('not_supplied');
    expect(early.note).toContain('has reached the point where');

    const absent = compute('incidents', { expected: 6, present: 0 }, null);
    expect(absent.state).toBe('not_supplied');
    expect(absent.note).toBe('No incidents for any of the 6 fixtures that should have them.');
  });

  it('keeps `delayed` while nothing has arrived, and drops it as soon as something does', () => {
    // `delayed` is a statement about a provider's behaviour, not about our
    // rows, so an empty count does not contradict it — but data does.
    expect(compute('lineups', { expected: 8, present: 0 }, 'delayed').state).toBe('delayed');
    expect(compute('lineups', { expected: 8, present: 8 }, 'delayed').state).toBe('available');
    expect(compute('lineups', { expected: 8, present: 2 }, 'delayed').state).toBe('limited');
  });
});
