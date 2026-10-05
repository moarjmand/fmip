import type {
  AccuracyMetrics,
  AccuracyPoint,
  AdminAccuracySeries,
  AdminModelAccuracyResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelAccuracyReport, sparkline } from './model-accuracy-report';

/**
 * Accuracy over time in the console (T-1369), rendered: each version in its
 * role, overall then per competition, a table with the uniform reference and
 * each row's coverage, and a sparkline only where there is a line to draw.
 * No verdict. Logical properties (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const metrics = (overrides: Partial<AccuracyMetrics>): AccuracyMetrics => ({
  forecasts: 12,
  matches: 10,
  coverage: 'limited',
  log_loss: 0.98765,
  brier: 0.5812,
  rps: 0.2011,
  accuracy: 0.5,
  uniform_rps: 0.2489,
  ...overrides,
});

const point = (period: string, start: string, rps: number): AccuracyPoint => ({
  period,
  period_start: start,
  ...metrics({ rps }),
});

const series = (overrides: Partial<AdminAccuracySeries>): AdminAccuracySeries => ({
  role: 'published',
  model_version: 'dixon-coles-elo@0.1.0',
  competition: null,
  total: metrics({ forecasts: 24, matches: 20 }),
  points: [point('2026-W41', '2026-10-05', 0.21), point('2026-W42', '2026-10-12', 0.19)],
  ...overrides,
});

const report = (overrides: Partial<AdminModelAccuracyResponse>): AdminModelAccuracyResponse => ({
  period: 'week',
  minimum_matches: 30,
  reference: { uniform_log_loss: 1.098612, uniform_brier: 0.666667, uniform_accuracy: 0.333333 },
  series: [
    series({}),
    series({ competition: { id: 'c1', name: 'Premier League' } }),
    series({ role: 'shadow', model_version: 'dixon-coles-elo@0.5.0', points: [] }),
  ],
  last_updated_at: '2026-10-13T00:00:00Z',
  generated_at: '2026-10-14T00:00:00Z',
  ...overrides,
});

const html = (r: AdminModelAccuracyResponse) =>
  renderToStaticMarkup(<ModelAccuracyReport locale="en" report={r} />);

describe('ModelAccuracyReport (T-1369)', () => {
  it('shows each version in its role, overall and per competition, with every metric', () => {
    const out = html(report({}));
    expect(out.match(/data-testid="accuracy-series"/g)).toHaveLength(2);
    expect(out).toContain('data-role="published"');
    expect(out).toContain('data-role="shadow"');
    expect(out).toContain('shadow (shown to no member)');
    expect(out).toContain('data-testid="accuracy-competition"');
    expect(out).toContain('Premier League (20 matches)');
    for (const text of ['2026-W41', '0.9877', '0.5812', '0.2011', '0.2489', '50.0%', 'ISO week']) {
      expect(out).toContain(text);
    }
    expect(out).toContain('limited (under 30)');
    expect(out).toContain('1.0986');
    expect(out).not.toMatch(/\b(better than|worse than|winner|promote it)\b/i);
    expect(out).not.toMatch(PHYSICAL);
  });

  it('draws a sparkline only with two periods or more', () => {
    const out = html(report({}));
    // The published overall and its competition have two weeks; the shadow has none.
    expect(out.match(/data-testid="accuracy-sparkline"/g)).toHaveLength(2);
  });

  it('says so when nothing has been evaluated', () => {
    const out = html(report({ series: [], period: 'month' }));
    expect(out).toContain('data-testid="accuracy-none"');
    expect(out).toContain('href="/en/admin/model-accuracy?period=week"');
  });
});

describe('sparkline', () => {
  it('puts both lines on one scale, oldest first', () => {
    const lines = sparkline([
      point('2026-W41', '2026-10-05', 0.1),
      point('2026-W42', '2026-10-12', 0.2),
    ]);
    expect(lines?.max).toBe(0.2489);
    expect(lines?.rps.startsWith('M4.0 ')).toBe(true);
    expect(lines?.rps).toContain('L236.0 ');
  });

  it('is null with fewer than two periods that have figures', () => {
    expect(sparkline([point('2026-W41', '2026-10-05', 0.1)])).toBeNull();
    expect(
      sparkline([
        point('2026-W41', '2026-10-05', 0.1),
        { ...point('2026-W42', '2026-10-12', 0), rps: null, uniform_rps: null },
      ]),
    ).toBeNull();
  });
});
