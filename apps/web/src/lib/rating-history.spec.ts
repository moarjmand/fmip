import type { RatingHistoryPoint } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { CHART, accuracyLabel, chartGeometry, chartSummary, dayInstant } from './rating-history';

const point = (date: string, rating: number, over: Partial<RatingHistoryPoint> = {}) => ({
  date,
  settled_at: `${date}T21:00:00.000Z`,
  rating,
  settled_total: 1,
  provisional: true,
  ...over,
});

const POINTS = [point('2026-01-01', 40), point('2026-01-03', 60), point('2026-01-11', 50)];

describe('chartGeometry', () => {
  it('runs time from the left edge in a left-to-right page, spaced by date', () => {
    const { points, path } = chartGeometry(POINTS, 'ltr');
    expect(points.map((p) => p.x)).toEqual([CHART.pad, 124.8, CHART.width - CHART.pad]);
    expect(path.startsWith(`M${CHART.pad} `)).toBe(true);
    expect(path.split(' L')).toHaveLength(3);
  });

  it('runs time from the right edge in a right-to-left page, and only x changes', () => {
    const ltr = chartGeometry(POINTS, 'ltr');
    const rtl = chartGeometry(POINTS, 'rtl');
    expect(rtl.points.map((p) => p.x)).toEqual(ltr.points.map((p) => CHART.width - p.x));
    expect(rtl.points.map((p) => p.y)).toEqual(ltr.points.map((p) => p.y));
    expect(rtl.points[0]!.x).toBeGreaterThan(rtl.points.at(-1)!.x);
  });

  it('uses the rating’s own 0–100 scale, higher ratings higher up', () => {
    const { points, guides } = chartGeometry(POINTS, 'ltr');
    expect(guides.map((g) => g.rating)).toEqual([0, 50, 100]);
    expect(guides[0]!.y).toBe(CHART.height - CHART.pad);
    expect(guides[2]!.y).toBe(CHART.pad);
    expect(points[1]!.y).toBeLessThan(points[0]!.y);
    expect(points[2]!.y).toBe(guides[1]!.y);
  });

  it('puts a single day in the middle and draws no line through one point', () => {
    const { points, path } = chartGeometry([point('2026-02-02', 70)], 'rtl');
    expect(points[0]!.x).toBe(CHART.width / 2);
    expect(path).toBe('');
    expect(chartGeometry([], 'ltr').points).toEqual([]);
  });
});

describe('labels', () => {
  it('states accuracy with its sample, and never a percentage of nothing', () => {
    expect(accuracyLabel({ settled_count: 12, outcome_correct: 7 })).toBe('7 of 12 correct (58%)');
    expect(accuracyLabel({ settled_count: 0, outcome_correct: 0 })).toBe('Nothing settled');
  });

  it('summarises the chart in a sentence for a reader who cannot see it', () => {
    expect(chartSummary(POINTS, (d) => d)).toBe(
      'Rating from 40.0 on 2026-01-01 to 50.0 on 2026-01-11, over 3 days with settled predictions.',
    );
    expect(chartSummary([point('2026-01-01', 40)], (d) => d)).toMatch(/only day/);
    expect(dayInstant('2026-01-01')).toBe('2026-01-01T00:00:00.000Z');
  });
});
