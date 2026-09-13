/**
 * Three numbers for the three outcomes, and the arithmetic on them (T-135).
 *
 * **Why this is not in `lib/forecast.ts`.** The rounding that makes three
 * shares total exactly 100 is the same arithmetic whether the shares came from
 * the model or from a crowd — but `percentages(p: ModelProbabilities)` is
 * typed to one product, and reaching for it from the community panel would put
 * a model type on the consensus surface. That is the first step of rule 6
 * going wrong, and the fix is not to duplicate the function: it is to notice
 * that the *arithmetic* belongs to neither product.
 *
 * `Triple` is deliberately anonymous. It is three numbers. It is not a
 * forecast, a consensus or an analysis, it carries no source, and nothing can
 * be rendered from it alone — which is why passing one around cannot blend
 * anything.
 */

export interface Triple {
  home: number;
  draw: number;
  away: number;
}

/**
 * Three shares of one as percentages totalling exactly 100.0.
 *
 * Blueprint 6.2 requires it of the model ("must always total 100% after
 * rounding") and a reader would be just as puzzled by a community consensus
 * adding up to 99.9. The largest share absorbs the rounding gap.
 */
export function sharesToPercentages(triple: Triple): Triple {
  const values = [triple.home, triple.draw, triple.away].map((value) => Math.round(value * 1000));
  const gap = 1000 - values.reduce((sum, value) => sum + value, 0);
  const largest = values.indexOf(Math.max(...values));
  values[largest] = (values[largest] ?? 0) + gap;
  return {
    home: (values[0] ?? 0) / 10,
    draw: (values[1] ?? 0) / 10,
    away: (values[2] ?? 0) / 10,
  };
}

/**
 * `a - b`, outcome by outcome, in whatever unit both were in.
 *
 * This is the comparison blueprint 4.2 asks for between the community forecast
 * and the model, and it is deliberately a *difference* rather than anything
 * that could be mistaken for a combined answer. There is no `average`,
 * `blend` or `merge` here and there must not be one: two products that
 * disagree are two products disagreeing, which is information, and averaging
 * them would destroy it while inventing a third number nobody computed
 * (rule 6).
 */
export function difference(a: Triple, b: Triple): Triple {
  return {
    home: Math.round((a.home - b.home) * 10) / 10,
    draw: Math.round((a.draw - b.draw) * 10) / 10,
    away: Math.round((a.away - b.away) * 10) / 10,
  };
}

/** `+4.2` / `−4.2` / `0` — a signed number a reader can scan. */
export function signed(value: number): string {
  if (value === 0) return '0';
  // U+2212, the real minus sign: a hyphen next to a digit is a different
  // character doing a different job, and it reads as a hyphen at small sizes.
  return value > 0 ? `+${value.toFixed(1)}` : `−${Math.abs(value).toFixed(1)}`;
}
