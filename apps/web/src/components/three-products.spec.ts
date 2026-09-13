import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The separation guard, on the surfaces (T-133, CLAUDE.md rule 6).
 *
 * `packages/contracts/src/three-products.spec.ts` guards the shapes. This
 * guards the place the three actually meet a reader: a match centre that shows
 * the model's forecast, the founder's analysis and — when the community
 * consensus arrives — all three on one page.
 *
 * The failure it is written against is not malice, it is convenience. Somebody
 * wants one `PredictionPanel` that takes "a prediction" and a `source` prop, and
 * the day it lands the reader can no longer tell which of the three they are
 * looking at. These tests fail on the first step towards that, while it is still
 * one commit to undo.
 */

const COMPONENTS = __dirname;

function source(file: string): string {
  return readFileSync(join(COMPONENTS, file), 'utf8');
}

describe('the three products stay three on the page', () => {
  it('renders each with a component that can only render that one', () => {
    // `FounderAnalysisPanel` takes a founder analysis. It has no branch for a
    // forecast, no `source` prop, and no way to be handed one.
    const founder = source('founder-analysis.tsx');
    expect(founder).not.toMatch(/ForecastVersion|ModelProbabilities|ForecastVersionsResponse/);
    expect(founder).not.toMatch(/source\s*[:?]/);

    const forecast = source('forecast-panel.tsx');
    expect(forecast).not.toMatch(/FounderAnalysis/);
  });

  it('never lets one panel take whichever product it is given', () => {
    for (const file of ['founder-analysis.tsx', 'forecast-panel.tsx']) {
      const text = source(file);
      // A union of the three as a prop is the compact way to build the thing
      // rule 6 forbids.
      expect(text).not.toMatch(/'model'\s*\|\s*'founder'/);
      expect(text).not.toMatch(/'founder'\s*\|\s*'community'/);
      expect(text).not.toMatch(/kind:\s*'forecast'\s*\|/);
    }
  });

  it('labels the founder panel as one person’s view, so a reader cannot mistake it', () => {
    // Attribution is not decoration here. The blueprint asks that each entry be
    // signed personally, and the signature is also what separates it from the
    // model on a page that shows both.
    const founder = source('founder-analysis.tsx');
    expect(founder).toContain('Not the statistical model, and not the community');
    expect(founder).toMatch(/data-testid="founder-signature"/);
  });

  it('keeps the match centre rendering them as separate sections', () => {
    const page = readFileSync(
      join(COMPONENTS, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
      'utf8',
    );
    // Both present, each with its own component. If one ever renders the other's
    // data, this is where it would show up first.
    expect(page).toContain('<FounderAnalysisPanel');
    expect(page).toContain('<ForecastPanel');
    expect(page).not.toMatch(/<PredictionPanel/);
  });
});
