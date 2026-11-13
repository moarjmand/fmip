import { describe, expect, it } from 'vitest';
import { ARRIVAL_SAMPLE, COVERAGE_MODULES, arrivesLate, compute } from './internal/coverage-rules';

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

// T-1824 (D-418): line-ups that reach us after kick-off as a rule are
// `delayed`, never `available`. The Persian Gulf Pro League on 2026-11-13: 104
// of 104 matches with line-ups, 20 of the last 20 stored after kick-off.
describe('line-ups measured by when they arrived (T-1824)', () => {
  it('is delayed when most of the measured matches had them only after kick-off', () => {
    const pgpl = compute(
      'lineups',
      { expected: 104, present: 104, arrival: { measured: 20, late: 20 } },
      'available',
    );
    expect(pgpl.state).toBe('delayed');
    expect(pgpl.note).toBe(
      '104 of 104 fixtures have lineups; 20 of the last 20 had them only after kick-off.',
    );
    // Some missing too: still delayed, not limited, with both counts.
    const some = compute(
      'lineups',
      { expected: 69, present: 44, arrival: { measured: 20, late: 12 } },
      null,
    );
    expect(some.state).toBe('delayed');
    expect(some.note).toContain('44 of 69');
  });

  it('stays available or limited when they mostly arrive before kick-off', () => {
    const onTime = { measured: 20, late: 8 };
    expect(compute('lineups', { expected: 50, present: 50, arrival: onTime }, null).state).toBe(
      'available',
    );
    expect(compute('lineups', { expected: 50, present: 30, arrival: onTime }, null).state).toBe(
      'limited',
    );
    // Exactly half is not "most".
    expect(arrivesLate({ measured: 20, late: 10 })).toBe(false);
    expect(arrivesLate({ measured: 20, late: 11 })).toBe(true);
  });

  it('measures nothing it cannot: no sample, or no line-up at all', () => {
    expect(arrivesLate(undefined)).toBe(false);
    expect(arrivesLate({ measured: 0, late: 0 })).toBe(false);
    // Nothing arrived: the arrival cannot say anything, the counts decide.
    expect(
      compute('lineups', { expected: 8, present: 0, arrival: { measured: 0, late: 0 } }, null)
        .state,
    ).toBe('not_supplied');
    expect(ARRIVAL_SAMPLE).toBe(20);
  });
});
