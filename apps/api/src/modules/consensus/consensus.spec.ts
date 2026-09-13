import { describe, expect, it } from 'vitest';
import { type Vote, crowd, weighted } from './internal/distribution';

/**
 * The consensus arithmetic (T-134, blueprint 6.6).
 *
 * The interesting cases are not "does it add up" — they are the ones where the
 * honest answer is to return less than a full payload.
 */

const vote = (outcome: Vote['outcome'], rating: number | null = null): Vote => ({
  outcome,
  rating,
});

describe('the crowd distribution', () => {
  it('counts one member once, whatever their rating', () => {
    const votes = [vote('home', 90), vote('home'), vote('draw', 10), vote('away')];
    const result = crowd(votes);

    expect(result.counts).toEqual({ home: 2, draw: 1, away: 1 });
    expect(result.shares).toEqual({ home: 0.5, draw: 0.25, away: 0.25 });
  });

  it('gives shares that sum to exactly one, including when thirds do not divide', () => {
    // 1/3 is 0.3333 three times, which is 0.9999 — a page renders that as
    // "99.99%" and a reader wonders what the missing hundredth is. The
    // largest-remainder method puts it somewhere rather than losing it.
    const result = crowd([vote('home'), vote('draw'), vote('away')]);
    const total = result.shares.home + result.shares.draw + result.shares.away;

    expect(total).toBeCloseTo(1, 10);
    expect(Object.values(result.shares).filter((share) => share === 0.3334)).toHaveLength(1);
  });

  it('keeps the biggest share the biggest after rounding', () => {
    // Rounding must not reorder the three; a consensus that says "away leads"
    // when more members picked home is worse than an imprecise percentage.
    const votes = [...Array.from({ length: 7 }, () => vote('home')), vote('draw'), vote('away')];
    const result = crowd(votes);

    expect(result.shares.home).toBeGreaterThan(result.shares.draw);
    expect(result.shares.home).toBeGreaterThan(result.shares.away);
  });
});

describe('the rating-weighted distribution', () => {
  it('weights by rating, so it can disagree with the crowd', () => {
    // This is the whole reason blueprint 6.6 asks for two: four unrated members
    // say home, one established rater says away. The crowd leans home; the
    // weighted distribution is entirely away, because nobody else is weighted.
    const votes = [vote('home'), vote('home'), vote('home'), vote('home'), vote('away', 80)];

    expect(crowd(votes).shares.home).toBe(0.8);
    expect(weighted(votes)?.shares).toEqual({ home: 0, draw: 0, away: 1 });
    expect(weighted(votes)?.raters).toBe(1);
  });

  it('is null when no established rater has predicted, never the crowd relabelled', () => {
    // The failure this guards is the tempting one: fall back to the crowd
    // distribution so the page has two bars to draw. That presents one answer
    // twice under two labels, which is the disguise blueprint 6.6 forbids in
    // the same sentence that asks for both.
    const votes = [vote('home'), vote('draw'), vote('away')];

    expect(weighted(votes)).toBeNull();
  });

  it('is null when every rater who predicted carries a rating of zero', () => {
    // Not a rounding edge. A rating of 0 is a verdict, and a distribution over
    // zero total weight has no meaning to round.
    expect(weighted([vote('home', 0), vote('away', 0)])).toBeNull();
  });

  it('ignores an unrated member entirely rather than treating them as zero', () => {
    // Treating "no established rating" as weight 0 gives the same numbers here,
    // but it makes `raters` a lie — and `raters` is what the page shows to say
    // how much judgement is behind the second bar.
    const votes = [vote('home', 50), vote('away', 50), vote('away'), vote('away')];
    const result = weighted(votes);

    expect(result?.raters).toBe(2);
    expect(result?.shares).toEqual({ home: 0.5, draw: 0, away: 0.5 });
  });
});
