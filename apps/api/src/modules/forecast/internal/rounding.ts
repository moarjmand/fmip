import type { ModelProbabilities } from '@fmip/contracts';

/**
 * Three probabilities that total exactly 1 at `digits` decimals (blueprint
 * 6.2: "must always total 100% after rounding"). The model already rounds
 * this way; the store re-applies it so the database CHECK can never fail on
 * a probability that arrived as 0.33333 through some other path. The largest
 * value absorbs the rounding gap, which moves the displayed figures least.
 */
export function roundToTotalOne(p: ModelProbabilities, digits = 4): ModelProbabilities {
  const scale = 10 ** digits;
  const values = [p.home, p.draw, p.away].map((v) => Math.round(v * scale));
  const gap = scale - values.reduce((a, b) => a + b, 0);
  const largest = values.indexOf(Math.max(...values));
  values[largest] = (values[largest] ?? 0) + gap;
  return {
    home: (values[0] ?? 0) / scale,
    draw: (values[1] ?? 0) / scale,
    away: (values[2] ?? 0) / scale,
  };
}
