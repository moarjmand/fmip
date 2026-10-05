import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccuracyMetrics,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelAccuracy } from './model-accuracy';

/**
 * The public page's figures (T-1369), rendered: never a figure without a
 * match behind it (`not_supplied`), the count beside a figure below the
 * minimum (`limited`), the metrics explained, the model alone (rule 6), in
 * the reader's language and digits, and logical properties only (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const NONE: AccuracyMetrics = {
  forecasts: 0,
  matches: 0,
  coverage: 'not_supplied',
  log_loss: null,
  brier: null,
  rps: null,
  accuracy: null,
  uniform_rps: null,
};

const metrics = (overrides: Partial<AccuracyMetrics>): AccuracyMetrics => ({
  forecasts: 14,
  matches: 12,
  coverage: 'limited',
  log_loss: 0.98765,
  brier: 0.5812,
  rps: 0.2011,
  accuracy: 0.5,
  uniform_rps: 0.2489,
  ...overrides,
});

const series = (overrides: Partial<PublicAccuracySeries>): PublicAccuracySeries => ({
  competition: null,
  model_versions: ['dixon-coles-elo@0.1.0'],
  total: metrics({}),
  points: [{ period: '2026-10', period_start: '2026-10-01', ...metrics({}) }],
  ...overrides,
});

const report = (overrides: Partial<PublicModelAccuracyResponse>): PublicModelAccuracyResponse => ({
  period: 'month',
  minimum_matches: 30,
  reference: { uniform_log_loss: 1.098612, uniform_brier: 0.666667, uniform_accuracy: 0.333333 },
  overall: series({}),
  competitions: [
    series({ competition: { id: 'c1', name: 'Premier League' } }),
    series({
      competition: { id: 'c2', name: 'Serie A' },
      model_versions: [],
      total: NONE,
      points: [],
    }),
  ],
  last_updated_at: '2026-10-12T09:00:00Z',
  ...overrides,
});

const html = (r: PublicModelAccuracyResponse | null, locale = 'en') =>
  renderToStaticMarkup(<ModelAccuracy locale={locale} report={r} />);

describe('ModelAccuracy (T-1369)', () => {
  it('shows the figures below the minimum as limited, with the count', () => {
    const out = html(report({}));
    expect(out).toContain('data-testid="accuracy-limited"');
    expect(out).toContain('Only 12 matches have been scored so far, fewer than 30');
    expect(out).toContain('October 2026');
    for (const text of ['50.0%', '0.201', '0.249', '0.581', '0.988', 'dixon-coles-elo@0.1.0']) {
      expect(out).toContain(text);
    }
    expect(out).not.toMatch(PHYSICAL);
  });

  it('shows no figure for a competition with nothing scored, and still lists it', () => {
    const out = html(report({}));
    expect(out).toContain('Serie A');
    expect(out).toContain('data-testid="accuracy-not-supplied"');
    expect(out.match(/data-testid="accuracy-months"/g)).toHaveLength(2);
  });

  it('says there is no accuracy at all when nothing has been scored', () => {
    const out = html(
      report({
        overall: series({ total: NONE, points: [], model_versions: [] }),
        competitions: [],
        last_updated_at: null,
      }),
    );
    expect(out).toContain('there is no accuracy to show');
    expect(out).not.toContain('data-testid="accuracy-months"');
    expect(out).not.toMatch(/\d+\.\d%/);
  });

  it('calls a row available from the minimum on', () => {
    const out = html(
      report({ overall: series({ total: metrics({ matches: 40, coverage: 'available' }) }) }),
    );
    expect(out).toContain('40 matches scored.');
  });

  it('explains every metric beside the uniform forecast', () => {
    const out = html(report({}));
    expect(out).toContain('ranked probability score');
    expect(out).toContain('scores 0.667');
    expect(out).toContain('scores 1.099');
    expect(out).toContain('about 33% right');
  });

  it('speaks Persian on /fa, in Persian digits and the Gregorian month', () => {
    const out = html(report({}), 'fa');
    expect(out).toContain('اکتبر ۲۰۲۶');
    expect(out).toContain('۱۲');
    expect(out).not.toContain('data-translation="untranslated"');
  });

  it('says so when the API cannot be reached', () => {
    expect(html(null)).toContain('data-testid="accuracy-unreachable"');
  });

  it('renders the model alone: no other product in its file (rule 6)', () => {
    const source = readFileSync(join(__dirname, 'model-accuracy.tsx'), 'utf8');
    expect(source).not.toMatch(/FounderAnalysis|Consensus|PredictionOutcome/);
    expect(source).not.toMatch(/from '@\/components\/(founder|community)/);
    expect(source).not.toMatch(/source\s*[:?]/);
  });
});
