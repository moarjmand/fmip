import type { AccuracyCalibration, AccuracyMetrics, PublicVersionSeries } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_CHART,
  calibrationForecasts,
  calibrationGeometry,
  calibrationState,
  versionCards,
} from './accuracy-calibration';

/**
 * The calibration chart and the version cards (T-1751, D-408), as arithmetic:
 * which state the section is in, where each dot goes and which is hollow, and
 * what a version's card may claim.
 */

const calibration = (steps: [number, number, number | null][]): AccuracyCalibration => ({
  minimum_forecasts: 30,
  coverage: 'available',
  bins: steps.map(([forecasts, happened, said], i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    forecasts,
    happened,
    said,
  })),
});

const TEN: [number, number, number | null][] = [
  [0, 0, null],
  [40, 6, 0.16],
  [80, 22, 0.26],
  [60, 21, 0.35],
  [50, 22, 0.45],
  [40, 21, 0.55],
  [30, 19, 0.64],
  [12, 9, 0.73],
  [5, 4, 0.82],
  [1, 1, 0.92],
];

describe('calibrationState', () => {
  it('is drawn when a step reaches the minimum, thin when none does, empty with nothing', () => {
    expect(calibrationState(calibration(TEN))).toBe('drawn');
    const thin = TEN.map(([f, h, s]): [number, number, number | null] => [Math.min(f, 29), h, s]);
    expect(calibrationState(calibration(thin))).toBe('thin');
    expect(calibrationState(calibration(TEN.map(() => [0, 0, null])))).toBe('empty');
    // The API's own state is trusted: not_supplied is no chart, whatever the steps hold.
    expect(calibrationState({ ...calibration(TEN), coverage: 'not_supplied' })).toBe('empty');
    expect(calibrationForecasts(calibration(TEN))).toBe(318);
  });
});

describe('calibrationGeometry', () => {
  const { top, plot, gutter, end } = CALIBRATION_CHART;

  it('places a dot at the mean said and the share that happened, none for an empty step', () => {
    const chart = calibrationGeometry(calibration(TEN), 'ltr');
    expect(chart.points.map((p) => p.from)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    const sixty = chart.points.find((p) => p.from === 0.6)!;
    expect(sixty.share).toBeCloseTo(19 / 30, 9);
    expect(sixty.x).toBeCloseTo(gutter + 0.64 * (100 - gutter - end), 9);
    expect(sixty.y).toBeCloseTo(top + (1 - 19 / 30) * plot, 9);
    expect(sixty.thin).toBe(false);
    expect(chart.points.filter((p) => p.thin).map((p) => p.from)).toEqual([0.7, 0.8, 0.9]);
    expect(chart.yOf(1)).toBe(top);
    expect(chart.yOf(0)).toBe(chart.bottom);
  });

  it('mirrors across on a right-to-left page and keeps the heights', () => {
    const ltr = calibrationGeometry(calibration(TEN), 'ltr');
    const rtl = calibrationGeometry(calibration(TEN), 'rtl');
    rtl.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(100 - ltr.points[i]!.x, 9);
      expect(p.y).toBe(ltr.points[i]!.y);
    });
    expect(rtl.xOf(0)).toBeCloseTo(100 - gutter, 9);
  });
});

describe('versionCards', () => {
  const metrics = (matches: number, rps: number, uniform: number): AccuracyMetrics => ({
    forecasts: matches,
    matches,
    coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
    log_loss: 0.95,
    brier: 0.56,
    rps,
    accuracy: 0.55,
    uniform_rps: uniform,
  });
  const version = (
    model: string,
    total: AccuracyMetrics,
    starts: string[],
  ): PublicVersionSeries => ({
    model_version: model,
    total,
    points: starts.map((start) => ({
      period: start,
      period_start: start,
      period_end: start,
      complete: true,
      ...total,
    })),
    calibration: calibration(TEN),
  });

  it('gives an available version its edge, and claims none under the sample rule', () => {
    const [newer, older] = versionCards([
      version('m@0.6.0', metrics(700, 0.202, 0.245), ['2026-10-01', '2026-11-01']),
      version('m@0.1.0', metrics(27, 0.18, 0.244), ['2026-10-01']),
    ]);
    expect(newer?.edge?.percent).toBe(18);
    expect([newer?.first, newer?.last]).toEqual(['2026-10-01', '2026-11-01']);
    // 26% better than a guess over 27 matches is not a finding: no figure.
    expect(older?.edge).toBeNull();
    expect([older?.first, older?.last]).toEqual(['2026-10-01', '2026-10-01']);
  });
});
