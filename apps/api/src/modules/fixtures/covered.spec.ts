import { describe, expect, it } from 'vitest';
import { covered, derived } from './internal/covered';

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
