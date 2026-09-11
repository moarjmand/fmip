import { describe, expect, it } from 'vitest';
import { RATING_FORMULA_V1, computeRating, tierOf, type RatingInput } from './internal/formula';

let counter = 0;
const input = (over: Partial<RatingInput> = {}): RatingInput => {
  counter += 1;
  return {
    settlementId: `s${String(counter).padStart(4, '0')}`,
    settledAt: `2026-01-${String(((counter - 1) % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    correct: true,
    scorePredicted: false,
    scoreCorrect: null,
    confidence: 3,
    difficulty: null,
    ...over,
  };
};
const many = (n: number, over: Partial<RatingInput> = {}): RatingInput[] =>
  Array.from({ length: n }, () => input(over));

describe('computeRating', () => {
  it('is null with nothing settled, and provisional below thirty', () => {
    expect(computeRating([])).toBeNull();
    const r = computeRating(many(20));
    expect(r?.provisional).toBe(true);
    expect(r?.established).toBe(false);
    expect(computeRating(many(30))?.provisional).toBe(false);
    expect(computeRating(many(50))?.established).toBe(true);
  });

  it('without a model, twenty correct picks at confidence 3 score 77.5', () => {
    const r = computeRating(many(20));
    // result 1, exact 0, consistency 1, confidence 0.5 → 60 + 0 + 15 + 2.5
    expect(r?.components).toEqual({ result: 1, exact_score: 0, consistency: 1, confidence: 0.5 });
    expect(r?.rating).toBe(77.5);
    expect(r?.tier).toBe('platinum');
  });

  it('always picking the strongest favourite is not enough: difficulty adjusts the credit', () => {
    const favourites = computeRating(many(20, { difficulty: 0.8 }));
    const upsets = computeRating(many(20, { difficulty: 0.2 }));
    expect(favourites?.components.result).toBe(0.3); // 20 × 0.2 / (20 × 2/3)
    expect(upsets?.components.result).toBe(1); // 20 × 0.8 / 13.33 → capped
    expect(favourites?.rating).toBe(35.5);
    expect(upsets?.rating).toBe(77.5);
    expect(favourites!.rating).toBeLessThan(upsets!.rating);
  });

  it('rewards exact scores, scaled, and confidence only when right', () => {
    const exact = computeRating([
      ...many(5, { scorePredicted: true, scoreCorrect: true }),
      ...many(15, { scorePredicted: true, scoreCorrect: false }),
    ]);
    expect(exact?.components.exact_score).toBe(1); // 5/20 × 4
    const bold = computeRating(many(20, { confidence: 5 }));
    const boldWrong = computeRating(many(20, { correct: false, confidence: 5 }));
    const timidWrong = computeRating(many(20, { correct: false, confidence: 1 }));
    expect(bold?.components.confidence).toBe(1);
    expect(boldWrong?.components.confidence).toBe(0);
    expect(timidWrong?.components.confidence).toBe(1);
    expect(boldWrong!.rating).toBeLessThan(timidWrong!.rating);
  });

  it('measures consistency across recent blocks and is neutral with little history', () => {
    const streaky = computeRating([
      ...many(10, { correct: true }),
      ...many(10, { correct: false }),
    ]);
    expect(streaky?.components.consistency).toBe(0); // blocks 1,1,0,0
    const steady = computeRating(
      Array.from({ length: 20 }, (_, i) => input({ correct: i % 2 === 0 })),
    );
    expect(steady?.components.consistency).toBe(0.8); // alternating: blocks of 3/5 and 2/5
    const little = computeRating(many(5, { correct: false }));
    expect(little?.components.consistency).toBe(0.5);
  });

  it('is deterministic and names its formula: the same records give the same hash and number', () => {
    const history = [...many(12, { difficulty: 0.5 }), ...many(3, { correct: false })];
    const a = computeRating(history);
    const b = computeRating([...history].reverse());
    expect(a).toEqual(b);
    expect(a?.inputsHash).toHaveLength(64);
    expect(
      computeRating(history, { ...RATING_FORMULA_V1, version: 'performance-rating@1.0.1' })
        ?.inputsHash,
    ).not.toBe(a?.inputsHash);
    expect(RATING_FORMULA_V1.version).toBe('performance-rating@1.0.0');
  });

  it('bands tiers on the configured bounds', () => {
    expect(tierOf(39.9, RATING_FORMULA_V1)).toBe('bronze');
    expect(tierOf(40, RATING_FORMULA_V1)).toBe('silver');
    expect(tierOf(69.9, RATING_FORMULA_V1)).toBe('gold');
    expect(tierOf(85, RATING_FORMULA_V1)).toBe('elite');
  });
});
