import { describe, expect, it } from 'vitest';
import { asksWithin, everyExternalId, personExternalIds } from './person-ids';

/** Every provider id of a person, for the per-person jobs (T-1866). */

describe('a person ask by every provider id', () => {
  it('reads one id exactly as before, and more as a list after the lowest', () => {
    expect(personExternalIds(['7'])).toEqual({ externalId: '7' });
    expect(personExternalIds(['7', '9'])).toEqual({ externalId: '7', moreExternalIds: ['9'] });
    expect(() => personExternalIds([])).toThrow();
    expect(everyExternalId({ externalId: '7' })).toEqual(['7']);
    expect(everyExternalId({ externalId: '7', moreExternalIds: ['9'] })).toEqual(['7', '9']);
  });

  it('keeps the asks whose ids fit in the allowance, in order, passing over one that does not', () => {
    const one = (n: number) => ({ externalId: `${n}` });
    const two = (n: number) => ({ externalId: `${n}`, moreExternalIds: [`${n}b`] });
    expect(asksWithin([one(1), one(2), one(3)], 3)).toEqual({
      asks: [one(1), one(2), one(3)],
      requests: 3,
      deferred: 0,
    });
    expect(asksWithin([one(1), two(2), one(3)], 2)).toEqual({
      asks: [one(1), one(3)],
      requests: 2,
      deferred: 1,
    });
    expect(asksWithin([one(1), two(2), one(3)], 3)).toEqual({
      asks: [one(1), two(2)],
      requests: 3,
      deferred: 1,
    });
    expect(asksWithin([two(1)], 1)).toEqual({ asks: [], requests: 0, deferred: 1 });
    expect(asksWithin([], 5)).toEqual({ asks: [], requests: 0, deferred: 0 });
  });
});
