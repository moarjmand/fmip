import { describe, expect, it } from 'vitest';
import {
  type StoredExpectedGoals,
  absencesCovered,
  covered,
  derived,
  expectedGoalsCovered,
} from './internal/covered';

describe('covered', () => {
  it('labels present rows with the declared state, and limited when the profile denied them', () => {
    expect(covered([1], false, 'available', 't')).toEqual({
      coverage: 'available',
      last_updated_at: 't',
      data: [1],
    });
    expect(covered([1], false, 'limited', 't').coverage).toBe('limited');
    expect(covered([1], false, 'delayed', 't').coverage).toBe('delayed');
    expect(covered([1], false, 'not_supplied', 't').coverage).toBe('limited');
    expect(covered([1], false, null, 't').coverage).toBe('limited');
  });

  it('never presents an empty module as populated', () => {
    expect(covered([], true, 'available', null)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
    expect(covered(null, true, 'delayed', null).coverage).toBe('delayed');
    expect(covered({ home: [], away: [] }, true, 'available', null).data).toBeNull();
  });
});

describe('derived', () => {
  it('grades our own history by how much of the window it fills', () => {
    expect(derived([1, 2, 3, 4, 5], 5, 't').coverage).toBe('available');
    expect(derived([1, 2], 5, 't').coverage).toBe('limited');
    expect(derived([], 5, null)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });
});

describe('absencesCovered (T-103, T-1364)', () => {
  const NOW = new Date('2026-10-04T12:00:00Z');
  const soon = { status: 'scheduled' as const, kickoffAt: '2026-10-05T19:00:00Z' };
  const later = { status: 'scheduled' as const, kickoffAt: '2026-10-10T19:00:00Z' };
  const listed = {
    id: 'p1',
    name: 'A. Player',
    side: 'home' as const,
    status: 'out' as const,
    kind: 'injury' as const,
    reason: 'Knee Injury',
    reported_at: '2026-10-04T09:00:00Z',
  };
  const asked = '2026-10-04T10:00:00Z';

  it('reads an asked, empty answer as nobody, dated by the ask', () => {
    expect(absencesCovered({ rows: [], askedAt: asked, notCovered: false }, soon, NOW)).toEqual({
      coverage: 'available',
      last_updated_at: asked,
      data: [],
      gap: null,
    });
  });

  it('never reads an empty answer as nobody where the provider has no absences', () => {
    expect(absencesCovered({ rows: [], askedAt: asked, notCovered: true }, soon, NOW)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
      gap: 'not_covered',
    });
    expect(absencesCovered({ rows: [], askedAt: null, notCovered: true }, later, NOW).gap).toBe(
      'not_covered',
    );
    // Someone the provider did list is still shown.
    expect(
      absencesCovered({ rows: [listed], askedAt: asked, notCovered: true }, soon, NOW),
    ).toMatchObject({ coverage: 'available', data: [listed] });
  });

  it('says "not yet" for a match more than three days away, and "not asked" otherwise', () => {
    const never = { rows: [], askedAt: null, notCovered: false };
    expect(absencesCovered(never, later, NOW)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
      gap: 'not_yet',
    });
    expect(absencesCovered(never, soon, NOW).gap).toBe('not_asked');
    expect(absencesCovered(never, { ...later, status: 'postponed' }, NOW).gap).toBe('not_asked');
    expect(
      absencesCovered(never, { status: 'finished', kickoffAt: '2026-10-01T19:00:00Z' }, NOW).gap,
    ).toBe('not_asked');
  });
});

describe('expected goals (T-1432)', () => {
  const at = new Date('2026-10-20T12:00:00Z');
  const finished = { status: 'finished' as const, kickoffAt: '2026-10-19T19:00:00Z' };
  const player = { id: 'p', name: 'P', side: 'home' as const, figures: { xg: 0.4 } };
  const stored = (over: Partial<StoredExpectedGoals> = {}): StoredExpectedGoals => ({
    rows: [],
    answeredAt: null,
    unplaced: 0,
    sourceCovers: true,
    ...over,
  });

  it('labels its figures with the source: available, or limited with players not placed', () => {
    expect(expectedGoalsCovered(stored({ rows: [player], answeredAt: 't' }), finished, at)).toEqual(
      {
        source: 'highlightly',
        unplaced: 0,
        coverage: 'available',
        last_updated_at: 't',
        data: [player],
      },
    );
    expect(
      expectedGoalsCovered(stored({ rows: [player], answeredAt: 't', unplaced: 3 }), finished, at),
    ).toMatchObject({ coverage: 'limited', unplaced: 3 });
  });

  it('is delayed only while the job still owes a covered finished match its ask', () => {
    expect(expectedGoalsCovered(stored(), finished, at).coverage).toBe('delayed');
    const late = { ...finished, kickoffAt: '2026-10-17T19:00:00Z' };
    expect(expectedGoalsCovered(stored(), late, at).coverage).toBe('not_supplied');
    expect(expectedGoalsCovered(stored({ sourceCovers: false }), finished, at).coverage).toBe(
      'not_supplied',
    );
    expect(
      expectedGoalsCovered(stored(), { status: 'scheduled', kickoffAt: finished.kickoffAt }, at)
        .coverage,
    ).toBe('not_supplied');
  });

  it('says not supplied, never zeros, when the source answered without a figure', () => {
    expect(expectedGoalsCovered(stored({ answeredAt: 't' }), finished, at)).toMatchObject({
      coverage: 'not_supplied',
      last_updated_at: 't',
      data: null,
    });
  });
});
