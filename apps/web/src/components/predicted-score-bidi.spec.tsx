import type {
  FounderAnalysisResponse,
  ForecastVersionsResponse,
  GroupPredictionComparison,
  PanelLinkedPrediction,
  PredictionHistoryFixture,
  PredictionVersion,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FounderAnalysisPanel } from './founder-analysis';
import { ForecastPanel } from './forecast-panel';
import { GroupComparison } from './group-comparison';
import { predictionLine } from '@/lib/panel-link';
import { fixtureLabel, versionLabel } from '@/lib/prediction-history';

/**
 * T-1378: a predicted scoreline reads in the page's direction, like a score
 * (D-193). A "2–1" pick is home first in the DOM; isolated left to right on a
 * right-to-left page it put the home goals on the left, beside the away team.
 * On `/fa` it is one run isolated right to left, so the home goals stand on
 * the right, the home side. English reads as before.
 */

const RLI = '⁧'; // U+2067, a right-to-left isolate
const LRI = '⁦'; // U+2066, a left-to-right isolate
const PDI = '⁩'; // U+2069, closes either

/** The span a `ScorePair` renders, by its test id: its direction and its text. */
function pair(html: string, testId: string): { dir: string; text: string } | null {
  const m = new RegExp(
    `<span dir="(\\w+)" class="\\[unicode-bidi:isolate\\][^"]*" data-testid="${testId}">([^<]*)<`,
  ).exec(html);
  return m === null ? null : { dir: m[1]!, text: m[2]! };
}

const ANALYSIS = {
  analysis: {
    author: { display_name: 'The Founder' },
    versions: [
      {
        id: 'v1',
        version_number: 1,
        predicted_outcome: 'home',
        predicted_score: { home: 2, away: 1 },
        confidence: 4,
        reasoning: 'Reasoning.',
        lineup_impact: null,
        key_players: null,
        form_and_context: null,
        published_at: '2026-09-29T08:00:00.000Z',
      },
    ],
  },
} as unknown as FounderAnalysisResponse;

const founder = (locale: string) =>
  renderToStaticMarkup(
    <FounderAnalysisPanel
      analysis={ANALYSIS}
      home="Sepahan"
      away="Fajr Sepasi"
      timeZone="UTC"
      locale={locale}
    />,
  );

const FORECASTS = {
  fixture_id: 'f',
  coverage: 'available',
  last_updated_at: '2026-10-09T08:00:00.000Z',
  latest: {
    id: 'fv1',
    fixture_id: 'f',
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles-elo@0.6.0',
    computed_at: '2026-10-09T08:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    expected_goals: null,
    most_likely_scorelines: [
      { home: 2, away: 1, probability: 0.12 },
      { home: 1, away: 0, probability: 0.1 },
    ],
    leading_factors: null,
    data_completeness: 'available',
    inputs: null,
    unavailable_reason: null,
    unavailable_detail: null,
  },
  versions: [],
} as unknown as ForecastVersionsResponse;

const forecast = (locale: string) =>
  renderToStaticMarkup(
    <ForecastPanel
      forecasts={FORECASTS}
      evaluations={null}
      home="Sepahan"
      away="Fajr Sepasi"
      timeZone="UTC"
      locale={locale}
    />,
  );

describe('a predicted scoreline in the page’s direction (T-1378)', () => {
  it("isolates the founder's pick right to left on /fa, the home goals first", () => {
    expect(pair(founder('fa'), 'founder-score')).toEqual({ dir: 'rtl', text: '۲–۱' });
    expect(founder('fa')).not.toMatch(/dir="ltr"[^>]*data-testid="founder-score"/);
  });

  it("keeps the founder's pick left to right in English", () => {
    expect(pair(founder('en'), 'founder-score')).toEqual({ dir: 'ltr', text: '2–1' });
  });

  it("isolates the model's most likely scorelines in the page's direction", () => {
    const fa = forecast('fa');
    expect(fa).toContain(`${RLI}۲–۱${PDI}`);
    expect(fa).toContain(`${RLI}۱–۰${PDI}`);
    expect(fa).not.toContain(`${LRI}۲–۱${PDI}`);
    const en = forecast('en');
    expect(en).toContain(`${LRI}2–1${PDI}`);
    expect(en).not.toContain(RLI);
  });

  it("isolates a group member's call right to left on /fa", () => {
    const comparison = {
      fixture_id: 'f',
      locked: false,
      silent: 0,
      withheld: 0,
      calls: [
        {
          username: 'sara',
          display_name: 'Sara',
          version: { outcome: 'home', score: { home: 2, away: 1 }, confidence: 4 },
          revisions: 0,
          settlement: null,
        },
      ],
    } as unknown as GroupPredictionComparison;
    const html = renderToStaticMarkup(
      <GroupComparison comparison={comparison} locale="fa" groupName="یاران" />,
    );
    expect(html).toMatch(/<span dir="rtl" class="\[unicode-bidi:isolate\] text-muted">۲–۱<\/span>/);
  });

  it("isolates a member's pick and a result in the history's sentences", () => {
    const version = { outcome: 'home', score: { home: 2, away: 1 }, confidence: 4 };
    const fa = versionLabel(version as unknown as PredictionVersion, 'fa');
    expect(fa).toContain(`${RLI}۲–۱${PDI}`);
    expect(fa).not.toContain(LRI);
    // English exactly as it always read.
    expect(versionLabel(version as unknown as PredictionVersion, 'en')).toBe(
      'Home win 2–1 · confidence 4/5',
    );

    const fixture = {
      home: { name: 'Sepahan', short_name: null },
      away: { name: 'Fajr Sepasi', short_name: null },
      score: { home: 6, away: 1 },
      status: 'finished',
    } as unknown as PredictionHistoryFixture;
    const line = fixtureLabel(fixture, 'fa');
    expect(line).toContain(`${RLI}۶–۱${PDI}`);
    // The names are their own isolates, so a Latin name cannot turn the line.
    expect(line).toContain('⁨Sepahan⁩');
    expect(line.indexOf('Sepahan')).toBeLessThan(line.indexOf('Fajr Sepasi'));
    expect(fixtureLabel(fixture, 'en')).toBe('Sepahan 6–1 Fajr Sepasi');
  });

  it("isolates a linked prediction's score on a panel card in the page's direction", () => {
    const prediction: PanelLinkedPrediction = {
      outcome: 'home',
      home_goals: 2,
      away_goals: 1,
      confidence: 4,
      submitted_at: '2026-10-09T08:00:00.000Z',
      revised_since: false,
    };
    const fa = predictionLine('Sara', prediction, 'fa');
    expect(fa).toContain(`${RLI}۲-۱${PDI}`);
    expect(fa).not.toContain(LRI);
    expect(predictionLine('Sara', prediction, 'en')).not.toMatch(/[⁦⁧⁩]/);
  });
});
