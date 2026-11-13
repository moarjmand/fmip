import type { AccuracyCalibration, CalibrationBin, PublicVersionSeries } from '@fmip/contracts';
import { edgeOverGuess, type Edge } from '@/lib/accuracy-edge';

/**
 * The accuracy page's calibration and version cards (T-1751, D-370, D-408),
 * pure: where the calibration chart's points go and which are thin, and what
 * each version's card may claim. Every figure is the API's; the API reads
 * them from the stored forecasts and their evaluations alone (rule 8).
 */

/**
 * What the calibration section may show. `drawn`: at least one step has the
 * minimum, so the chart is drawn, the thin steps hollow. `thin`: forecasts
 * were scored but no step has the minimum, so there is no chart, only a
 * sentence (rule 3: points from a handful of forecasts are not a curve).
 * `empty`: nothing scored.
 */
export type CalibrationState = 'drawn' | 'thin' | 'empty';

export function calibrationState(calibration: AccuracyCalibration): CalibrationState {
  const scored = calibration.bins.some((bin) => bin.forecasts > 0);
  if (!scored || calibration.coverage === 'not_supplied') return 'empty';
  const any = calibration.bins.some((bin) => bin.forecasts >= calibration.minimum_forecasts);
  return any ? 'drawn' : 'thin';
}

/** Every probability the calibration is over: three a match. */
export const calibrationForecasts = (calibration: AccuracyCalibration): number =>
  calibration.bins.reduce((sum, bin) => sum + bin.forecasts, 0);

/** The calibration chart's fixed measures, in CSS pixels; widths are percentages. */
export const CALIBRATION_CHART = {
  /** Room above the plot for the top gridline's label. */
  top: 16,
  /** The plot's height, from 100% to 0%. */
  plot: 220,
  /** The gap under the plot and the row of the axis labels. */
  under: 18,
  labels: 14,
  /** The share of the width kept for the gridline labels, at the inline start. */
  gutter: 9,
  /** The share kept at the inline end, so a point at 100% is not cut in half. */
  end: 3,
  /** A point's radius. */
  radius: 6,
} as const;

/** The gridlines and axis labels: every twenty points. */
export const CALIBRATION_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

export interface CalibrationPoint extends CalibrationBin {
  /** The mean probability the step's forecasts gave. */
  said: number;
  /** The share of them that happened. */
  share: number;
  /** Under the minimum: drawn hollow, with its count beside it. */
  thin: boolean;
  /** The point's centre: across in percent of the width, down in pixels. */
  x: number;
  y: number;
}

export interface CalibrationGeometry {
  height: number;
  /** The plot's bottom and top, in pixels. */
  bottom: number;
  topY: number;
  /** Where a probability or a share sits across, in percent of the width. */
  xOf: (value: number) => number;
  /** Where a share sits down, in pixels. */
  yOf: (value: number) => number;
  /** The baseline of the axis labels under the plot. */
  labelY: number;
  points: CalibrationPoint[];
}

/**
 * Where the chart's marks go. "What the model said" runs from the inline
 * start, so on a right-to-left page 0% is on the right: the positions are
 * mirrored, the text is not. A point sits at the mean probability of its
 * step, not the step's middle: the top step's forecasts may average 0.92,
 * and drawing them at 0.95 would move them off the truth. A step with no
 * forecast has no point (and no zero).
 */
export function calibrationGeometry(
  calibration: AccuracyCalibration,
  direction: 'ltr' | 'rtl',
): CalibrationGeometry {
  const { top, plot, under, labels, gutter, end } = CALIBRATION_CHART;
  const xOf = (value: number): number => {
    const fromStart = gutter + value * (100 - gutter - end);
    return direction === 'rtl' ? 100 - fromStart : fromStart;
  };
  const yOf = (value: number): number => top + (1 - value) * plot;
  const points: CalibrationPoint[] = [];
  for (const bin of calibration.bins) {
    if (bin.forecasts <= 0 || bin.said === null) continue;
    const share = bin.happened / bin.forecasts;
    points.push({
      ...bin,
      said: bin.said,
      share,
      thin: bin.forecasts < calibration.minimum_forecasts,
      x: xOf(bin.said),
      y: yOf(share),
    });
  }
  const bottom = top + plot;
  return {
    height: bottom + under + labels,
    bottom,
    topY: top,
    xOf,
    yOf,
    labelY: bottom + under + 6,
    points,
  };
}

// ---------------------------------------------------------------------------
// Each version on its own
// ---------------------------------------------------------------------------

export interface VersionCard {
  series: PublicVersionSeries;
  /**
   * The version's own edge over a guess, only when its record is `available`:
   * under the sample rule a version makes no claim (rule 3).
   */
  edge: Edge | null;
  /** The first and last weeks or months its counted matches kicked off in. */
  first: string | null;
  last: string | null;
}

export function versionCards(versions: readonly PublicVersionSeries[]): VersionCard[] {
  return versions.map((series) => {
    const total = series.total;
    const edge =
      total.coverage === 'available' ? edgeOverGuess(total.rps, total.uniform_rps) : null;
    return {
      series,
      edge,
      first: series.points[0]?.period_start ?? null,
      last: series.points.at(-1)?.period_start ?? null,
    };
  });
}
