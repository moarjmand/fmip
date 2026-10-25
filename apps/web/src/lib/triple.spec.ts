import { describe, expect, it } from 'vitest';
import { difference, sharesToPercentages, signed, wholePercentages } from './triple';

/**
 * The arithmetic the model and the community both need (T-135).
 *
 * It lives apart from either product on purpose, so neither panel has to import
 * a function typed to the other one (rule 6).
 */

describe('shares as percentages', () => {
  it('totals exactly 100 even when the shares do not divide', () => {
    // Blueprint 6.2 requires it of the model, and a community consensus adding
    // up to 99.9 would puzzle a reader for the same reason.
    const result = sharesToPercentages({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });

    expect(result.home + result.draw + result.away).toBeCloseTo(100, 10);
  });

  it('gives the rounding gap to the largest share, not the first', () => {
    const result = sharesToPercentages({ home: 0.2005, draw: 0.2005, away: 0.599 });

    expect(result.home + result.draw + result.away).toBeCloseTo(100, 10);
    expect(result.away).toBeGreaterThan(result.home);
  });
});

describe('whole percentages for a row (T-1545)', () => {
  it('totals exactly 100 where rounding each would give 101 or 99', () => {
    // Toulouse v Troyes on 25 Oct 2026: 66.6 · 19.6 · 13.8 read 67 · 20 · 14.
    expect(wholePercentages({ home: 66.6, draw: 19.6, away: 13.8 })).toEqual({
      home: 67,
      draw: 19,
      away: 14,
    });
    expect(wholePercentages({ home: 33.4, draw: 33.3, away: 33.3 })).toEqual({
      home: 34,
      draw: 33,
      away: 33,
    });
    for (const t of [
      { home: 42.5, draw: 25.5, away: 32 },
      { home: 0.4, draw: 0.4, away: 99.2 },
      { home: 50, draw: 25, away: 25 },
    ]) {
      const w = wholePercentages(t);
      expect(w.home + w.draw + w.away).toBe(100);
    }
  });

  it('keeps a whole share as it is', () => {
    expect(wholePercentages({ home: 50, draw: 25, away: 25 })).toEqual({
      home: 50,
      draw: 25,
      away: 25,
    });
  });
});

describe('the difference between two answers', () => {
  it('is a difference, outcome by outcome', () => {
    const community = { home: 60, draw: 25, away: 15 };
    const model = { home: 48, draw: 27, away: 25 };

    expect(difference(community, model)).toEqual({ home: 12, draw: -2, away: -10 });
  });

  it('never produces a third answer from the two', () => {
    // The failure this stands against is an `average` or `blend` next to it:
    // two products that disagree are information, and a combined number would
    // destroy that while inventing a figure nobody computed (rule 6). A
    // difference cannot be mistaken for a probability — it is signed, and here
    // it does not sum to anything meaningful.
    const gap = difference({ home: 60, draw: 25, away: 15 }, { home: 48, draw: 27, away: 25 });

    expect(gap.home + gap.draw + gap.away).toBe(0);
    expect(Object.values(gap).some((value) => value < 0)).toBe(true);
  });
});

describe('signing a number for a reader', () => {
  it('marks direction, and uses a minus sign rather than a hyphen', () => {
    expect(signed(12)).toBe('+12.0');
    // U+2212. A hyphen beside a digit is a different character doing a
    // different job, and it reads as one at small sizes.
    expect(signed(-4.2)).toBe('−4.2');
    expect(signed(0)).toBe('0');
  });
});
