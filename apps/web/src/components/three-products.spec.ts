import { readFileSync } from 'node:fs';
import { EN } from '@/i18n/messages';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The separation guard, on the surfaces (T-133, CLAUDE.md rule 6).
 *
 * `packages/contracts/src/three-products.spec.ts` guards the shapes. This
 * guards the place the three actually meet a reader: a match centre that shows
 * the model's forecast, the founder's analysis and the community consensus, all
 * three on one page. (The consensus arrived in T-134/T-135; until then this
 * file guarded two products and waited for the third.)
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

    // The community panel is the one with a live temptation: blueprint 4.2 asks
    // it to compare with the model, so it has a reason to reach for a forecast
    // type. It must not — the comparison takes plain numbers the page pulled
    // out, so the panel can render a difference and cannot render a forecast.
    const community = source('community-consensus.tsx');
    expect(community).not.toMatch(/ForecastVersion|ModelProbabilities|FounderAnalysis/);
    expect(community).not.toMatch(/source\s*[:?]/);
  });

  it('never lets one panel take whichever product it is given', () => {
    for (const file of ['founder-analysis.tsx', 'forecast-panel.tsx', 'community-consensus.tsx']) {
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
    expect(page).toContain('<CommunityForecastPanel');
    expect(page).not.toMatch(/<PredictionPanel/);
  });

  it('keeps the Predictions page four sections rather than one feed', () => {
    // This is the page rule 6 was written for: blueprint 2.1 puts all three
    // products and the leaderboard under one heading, which makes "today's
    // predictions, ranked, with a little tag saying where each came from" the
    // obvious design. It is more compact, it reads better, and it is exactly
    // what the rule forbids.
    const page = readFileSync(
      join(COMPONENTS, '..', 'app', '[locale]', 'predictions', 'page.tsx'),
      'utf8',
    );

    // Each product rendered by its own component, from its own endpoint.
    expect(page).toContain('<ForecastList');
    expect(page).toContain('<FounderAnalysisFeed');
    expect(page).toContain('<CommunityConsensusList');
    // And nothing that takes whichever it is handed.
    expect(page).not.toMatch(/<PredictionList|<ProductList|<PredictionRow/);
    expect(page).not.toMatch(/source:\s*'(model|founder|community)'/);
  });

  it('keeps the scores card two lines from two components (T-940)', () => {
    // The card is the smallest place the model and the community meet, which
    // makes one "prediction" line with a source label the tempting design.
    const forecast = source('score-card-forecast.tsx');
    const community = source('score-card-community.tsx');
    expect(forecast).not.toMatch(/CardCommunity|Consensus|FounderAnalysis/);
    expect(community).not.toMatch(
      /CardForecast|ForecastSummary|ModelProbabilities|FounderAnalysis/,
    );
    for (const text of [forecast, community]) {
      expect(text).not.toMatch(/source\s*[:?]/);
      expect(text).not.toMatch(/'model'\s*\|\s*'community'/);
    }
    // Each line names whose it is: the words are the catalogue's (T-1303),
    // so the file names the keys and the English says it.
    expect(forecast).toContain("m['scores.card.model.label']");
    expect(EN['scores.card.model.label']).toBe('Model forecast:');
    expect(forecast).toContain("m['scores.card.model.version']");
    expect(EN['scores.card.model.version']).toContain('the statistical model');
    expect(community).toContain("m['scores.card.community.label']");
    expect(EN['scores.card.community.label']).toBe('Community predictions:');
    expect(community).toContain("p['scores.card.community.sample']");
    expect(EN['scores.card.community.sample'].other).toContain('not the model');

    const card = source('score-card.tsx');
    expect(card).toContain('<CardForecastSummary');
    expect(card).toContain('<CardCommunityTotals');
    expect(card).not.toMatch(/<PredictionLine|<ProductLine/);

    // Three maps the page fills from three endpoints, never one of both.
    const lib = readFileSync(join(COMPONENTS, '..', 'lib', 'score-card-products.ts'), 'utf8');
    expect(lib).not.toMatch(/function (average|blend|merge|combine)/);
    expect(lib).toMatch(/forecast: Record<string, CardForecast>/);
    expect(lib).toMatch(/community: Record<string, CardCommunity>/);
  });

  it('links the three from a match story, each under its own name, never as one figure (T-941)', () => {
    const links = source('story-links.tsx');
    expect(links).toContain("anchor: 'forecast'");
    expect(links).toContain("anchor: 'analysis'");
    expect(links).toContain("anchor: 'community'");
    expect(links).not.toMatch(/ForecastVersion|ForecastSummary|CommunityConsensus|FounderAnalysis/);
  });

  it('never averages the three into one number', () => {
    // Blueprint 4.2 asks the community forecast to be shown "and comparison
    // with the model". Comparison is a difference; the failure is an average,
    // which would invent a figure nobody computed and hide the disagreement
    // that makes showing both worth doing.
    const shared = readFileSync(join(COMPONENTS, '..', 'lib', 'triple.ts'), 'utf8');
    for (const text of [shared, source('community-consensus.tsx')]) {
      expect(text).not.toMatch(/function (average|blend|merge|combine)/);
    }
    // And the wording a reader sees says so, because a rule kept only in tests
    // is a rule the reader has to take on trust.
    expect(source('community-consensus.tsx')).toContain('matchCentre.community.gapNote');
    expect(EN['matchCentre.community.gapNote']).toContain('does not average them');
  });
});
