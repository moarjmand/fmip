import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The separation guard (T-133, CLAUDE.md rule 6).
 *
 * The three prediction products — the statistical model, the founder's analysis
 * and the community consensus — are never blended or relabelled. That is easy
 * to agree with and easy to break by accident: one shared `Prediction` type, one
 * payload with a `source` field, one component that takes "a prediction" and
 * renders whichever it is given, and a year later nobody can tell a reader which
 * of the three they are looking at.
 *
 * So this is a test rather than a paragraph. It fails when the contracts start
 * to merge, which is the moment the mistake is cheap to undo.
 */

const CONTRACTS = join(__dirname);

function source(file: string): string {
  return readFileSync(join(CONTRACTS, file), 'utf8');
}

describe('the three prediction products stay three', () => {
  it('gives each product its own file, and none of them imports another', () => {
    // A shared type is how blending starts. The founder's analysis has an
    // author and prose; a forecast has a model version and probabilities; a
    // member's prediction has a member and a lock. Nothing should make it easy
    // to pass one where another is expected.
    const founder = source('founder-analysis.ts');
    expect(founder).not.toMatch(/from '\.\/forecast'/);
    expect(founder).not.toMatch(/from '\.\/predictions'/);

    const forecast = source('forecast.ts');
    expect(forecast).not.toMatch(/from '\.\/founder-analysis'/);
    expect(forecast).not.toMatch(/from '\.\/predictions'/);
  });

  it('never puts a founder analysis inside a forecast payload, or the reverse', () => {
    // The specific failure this guards: a `FounderAnalysis` field appearing on
    // the forecast response so a page can render "the prediction", whichever it
    // came from.
    expect(source('forecast.ts')).not.toMatch(/FounderAnalysis/);
    expect(source('founder-analysis.ts')).not.toMatch(/ForecastVersion|ModelProbabilities/);
  });

  it('keeps the word "prediction" out of the founder analysis contract', () => {
    // Relabelling is the other half of rule 6. A founder analysis is not "the
    // founder's prediction" in the product's vocabulary, because "prediction"
    // means a member's, and a reader who sees the same word twice will assume
    // the same thing twice. The only mentions allowed are the ones explaining
    // that distinction, in comments.
    const withoutComments = source('founder-analysis.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/[Pp]rediction/);
  });

  it('does not let the three be enumerated as interchangeable kinds', () => {
    // A union like `type PredictionSource = 'model' | 'founder' | 'community'`
    // is the compact way to say the three are the same shape with a label —
    // which is precisely what rule 6 forbids.
    for (const file of ['forecast.ts', 'founder-analysis.ts']) {
      const text = source(file);
      expect(text).not.toMatch(/'model'\s*\|\s*'founder'/);
      expect(text).not.toMatch(/'founder'\s*\|\s*'community'/);
    }
  });
});
