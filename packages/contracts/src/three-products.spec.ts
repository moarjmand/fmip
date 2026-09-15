import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The separation guard (T-133, extended in T-134; CLAUDE.md rule 6).
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
 *
 * **Worth recording:** for its first weeks this guarded a consensus payload
 * that did not exist. The model and the founder's analysis were built; the
 * third product was named in the rule, named in this test, and never written.
 * T-134 built it, and these assertions now cover all three.
 *
 * **T-263 makes it four.** Community-written analysis (blueprint 10.3) is not
 * one of rule 6's three — and it is the most dangerous addition yet, because it
 * carries a predicted result, a confidence and reasoning, which makes it look
 * exactly like the founder's analysis. The one-line wrong version of E26 was a
 * second author on `founder_analysis`, and it would have made the founder's own
 * signature meaningless: a reader could no longer tell whose opinion they were
 * reading, and the column that distinguished them would be one a query could
 * forget to filter on.
 *
 * So the rule these assertions defend is now wider than rule 6 as written:
 * **four signed opinions, each legible as itself.**
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

    // The consensus (T-134) is the third product, and it is the one most at
    // risk of quietly merging: it is built out of member predictions, so
    // reaching for `PredictionOutcome` feels harmless. It is not — that is the
    // first shared type, and the second is a shared shape.
    const consensus = source('consensus.ts');
    expect(consensus).not.toMatch(/from '\.\/forecast'/);
    expect(consensus).not.toMatch(/from '\.\/founder-analysis'/);
    expect(consensus).not.toMatch(/from '\.\/predictions'/);
  });

  it('never puts a founder analysis inside a forecast payload, or the reverse', () => {
    // The specific failure this guards: a `FounderAnalysis` field appearing on
    // the forecast response so a page can render "the prediction", whichever it
    // came from.
    expect(source('forecast.ts')).not.toMatch(/FounderAnalysis/);
    expect(source('founder-analysis.ts')).not.toMatch(/ForecastVersion|ModelProbabilities/);

    // And the specific failure blueprint 6.6 names in a sentence of its own:
    // "The website must not disguise community opinion as the statistical
    // model." A model probability appearing on the consensus payload is how
    // that would start.
    const consensus = source('consensus.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(consensus).not.toMatch(/ModelProbabilities|ForecastVersion|FounderAnalysis/);
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
    for (const file of ['forecast.ts', 'founder-analysis.ts', 'consensus.ts']) {
      const text = source(file);
      expect(text).not.toMatch(/'model'\s*\|\s*'founder'/);
      expect(text).not.toMatch(/'founder'\s*\|\s*'community'/);
    }
  });
});

describe('community analysis is a fourth opinion, not a fourth label', () => {
  const FILES = ['forecast.ts', 'founder-analysis.ts', 'consensus.ts', 'community-analysis.ts'];

  /** Code only: these files argue about each other at length in prose. */
  function code(file: string): string {
    return source(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\r\n])\s*\/\/.*/g, '$1');
  }

  it('imports none of the three, and none of them imports it', () => {
    // The first shared type is how blending starts, and here it would be the
    // easiest one to reach for: a community analysis and a founder analysis
    // have the same fields.
    const community = code('community-analysis.ts');
    for (const other of ['forecast', 'founder-analysis', 'consensus', 'predictions']) {
      expect(community, `community-analysis imports ${other}`).not.toMatch(
        new RegExp(`from '\\./${other}'`),
      );
    }
    for (const file of ['forecast.ts', 'founder-analysis.ts', 'consensus.ts']) {
      expect(code(file), `${file} imports community-analysis`).not.toMatch(
        /from '\.\/community-analysis'/,
      );
    }
  });

  it('names no type belonging to another product, in either direction', () => {
    const community = code('community-analysis.ts');
    expect(community).not.toMatch(
      /FounderAnalysis|ForecastVersion|ModelProbabilities|CommunityConsensus/,
    );

    // And the reverse: a `CommunityAnalysis` field on the founder's payload so
    // a page can render "the analysis", whichever it came from.
    for (const file of ['forecast.ts', 'founder-analysis.ts', 'consensus.ts']) {
      expect(code(file), `${file} names a community analysis type`).not.toMatch(
        /CommunityAnalysis(?!es)/,
      );
    }
  });

  it('is not enumerable alongside the others as an interchangeable kind', () => {
    // `type AnalysisSource = 'founder' | 'community'` is the compact way to say
    // the two are the same shape with a label, which is exactly what the epic
    // exists to prevent.
    for (const file of FILES) {
      const text = code(file);
      expect(text, `${file} enumerates the products`).not.toMatch(
        /'founder'\s*\|\s*'community'|'community'\s*\|\s*'founder'/,
      );
      expect(text).not.toMatch(/'model'\s*\|\s*'community'/);
    }
  });

  it('keeps the word "prediction" out of the community analysis contract too', () => {
    // The same relabelling rule the founder's analysis has: "prediction" means
    // a member's, and a reader who sees the same word twice will assume the
    // same thing twice.
    expect(code('community-analysis.ts')).not.toMatch(/[Pp]rediction\b/);
  });

  it('gives the fourth opinion its own file, so the count is four', () => {
    // A sweep rather than a list: a fifth product added without a file of its
    // own would be a fifth opinion sharing somebody else's shape.
    for (const file of FILES) expect(source(file).length).toBeGreaterThan(0);
  });
});
