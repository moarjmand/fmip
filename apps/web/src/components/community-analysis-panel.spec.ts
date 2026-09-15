import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The fourth opinion on the page (T-263).
 *
 * The contracts guard keeps the four apart in the types. **This keeps them apart
 * where a reader meets them** — which is the last place the rule can break, and
 * the only place it matters to anybody outside this repository.
 *
 * The failure it guards is not a merged type. It is one component that takes
 * "an analysis" and renders whichever it was given, a heading that says
 * "Analysis" without saying whose, or a panel that borrows the founder's card
 * because the fields line up. All three would pass every test in
 * `three-products.spec.ts`.
 */
const HERE = __dirname;
const PANEL = readFileSync(join(HERE, 'community-analysis-panel.tsx'), 'utf8');
const FOUNDER = readFileSync(join(HERE, 'founder-analysis.tsx'), 'utf8');
const CONSENSUS = readFileSync(join(HERE, 'community-consensus.tsx'), 'utf8');
const FORECAST = readFileSync(join(HERE, 'forecast-panel.tsx'), 'utf8');
const MATCH = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
  'utf8',
);

/** Code only: these files argue about each other at length in prose. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\r\n])\s*\/\/.*/g, '$1');

describe('four opinions on one page, each legible as itself', () => {
  it('gives the fourth its own component, borrowed from none of the three', () => {
    // A shared "analysis card" that took either would be the blending rule
    // broken at the last possible moment -- after the schema, the contract and
    // the API all kept them apart.
    for (const other of ['founder-analysis', 'community-consensus', 'forecast-panel']) {
      expect(code(PANEL), `the panel imports ${other}`).not.toMatch(
        new RegExp(`from '@/components/${other}'`),
      );
    }
    // And none of the three reaches for this one.
    for (const [name, source] of [
      ['founder-analysis', FOUNDER],
      ['community-consensus', CONSENSUS],
      ['forecast-panel', FORECAST],
    ] as const) {
      expect(code(source), `${name} imports the community analysis panel`).not.toMatch(
        /community-analysis-panel/,
      );
    }
  });

  it('names whose opinion it is in the heading, and says what it is not', () => {
    // Whitespace-normalised, because the formatter reflows prose across lines
    // and an assertion that broke on a line wrap would be testing Prettier.
    const words = PANEL.replace(/\s+/g, ' ');
    // "Analysis" on its own is the relabelling rule broken in two words.
    expect(words).toMatch(/Analysis from approved contributors/);
    expect(words).toMatch(/Not the founder&rsquo;s analysis/);
    expect(words).toMatch(/not the statistical model/);
    expect(words).toMatch(/not the community consensus/i);
  });

  it('renders all four panels on the match page, separately', () => {
    for (const component of [
      '<FounderAnalysisPanel',
      '<CommunityForecastPanel',
      '<ForecastPanel',
      '<CommunityAnalysisPanel',
    ]) {
      expect(MATCH, `${component} is missing from the match page`).toContain(component);
    }
  });

  it('fetches the published analyses without a session', () => {
    // A published analysis is meant to be read. Sending a cookie would make a
    // public document viewer-specific for nothing, the same mistake the panel
    // avoids (T-251).
    expect(MATCH).toContain('fetchCommunityAnalyses(id)');
    expect(MATCH).not.toMatch(/fetchCommunityAnalyses\(id,\s*cookie/);
  });
});

describe('what each analysis carries', () => {
  it('shows the author name and rating, because that is what separates them', () => {
    // Blueprint 10.3: published analysis is labelled with the author's name and
    // rating. On a page with four opinions it is the only thing telling one
    // analyst's call from another's.
    expect(PANEL).toContain('analysis.author.display_name');
    expect(PANEL).toContain('data-testid="community-analysis-rating"');
    expect(PANEL).toContain('data-testid="community-analysis-unrated"');
  });

  it('shows a formerly approved analyst as former, and keeps their work', () => {
    // Taking it down would rewrite the record; still calling them approved
    // would be false.
    expect(PANEL).toContain("'community-analysis-approved' : 'community-analysis-former'");
  });

  it('says when an analysis was revised', () => {
    // A correction is a new version that says what changed. Getting something
    // wrong and correcting it costs an analyst nothing here; quietly editing it
    // would.
    expect(PANEL).toContain('data-testid="community-analysis-revised"');
    expect(PANEL).toContain('current.version_number > 1');
  });

  it('shows the newest version and omits absent optional fields', () => {
    expect(PANEL).toContain('analysis.versions[0]');
    expect(PANEL).toContain('current[field] === null ? null');
  });

  it('tells unreachable apart from empty', () => {
    expect(PANEL).toContain('data-testid="community-analysis-unreachable"');
    expect(PANEL).toContain('data-testid="community-analysis-empty"');
  });

  it('uses logical properties only (rule 7)', () => {
    expect(PANEL).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
