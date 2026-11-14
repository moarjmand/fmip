import type { AccuracyMetrics, PublicAccuracyPoint, PublicAccuracySeries } from '@fmip/contracts';
import { formatPercent } from '@/lib/words';

/**
 * The accuracy page's arithmetic (T-1750, D-370), pure: how much less error
 * the model's probabilities had than a guess of one third each, the weeks of
 * the weekly chart and its geometry, and the competition list's groups and
 * orders. Every figure is computed from the API's numbers; nothing here is a
 * constant of the day it was written.
 *
 * "A guess" is the page's own know-nothing forecast (`uniform_rps`, D-187):
 * the weakest benchmark there is, and the only one the data holds. No
 * stronger one is computed, drawn or implied.
 */

/** The model against a guess, over one set of matches. */
export interface Edge {
  /** The model's RPS as the page prints it, to three decimals. */
  model: number;
  /** The one-third guess's RPS on the same matches, to three decimals. */
  guess: number;
  /**
   * How much lower the model's error was, as a signed whole percent of the
   * guess's: 17 for 17% less error, -25 for 25% more.
   */
  percent: number;
  /** `percent / 100`, the quotient the printed arithmetic ends on. */
  ratio: number;
}

/**
 * `(guess - model) / guess` from the two figures **as printed** (three
 * decimals), so the arithmetic the page writes out can be checked by a
 * reader with the numbers in front of them: (0.245 - 0.203) / 0.245 = 0.17.
 * Worked in thousandths, as integers, so a half lands the same way on every
 * machine. Null without both figures or with a guess of zero: no edge is
 * made out of nothing (rule 3).
 */
export function edgeOverGuess(rps: number | null, uniformRps: number | null): Edge | null {
  if (rps === null || uniformRps === null) return null;
  const model = Math.round(rps * 1000);
  const guess = Math.round(uniformRps * 1000);
  if (!Number.isFinite(model) || !Number.isFinite(guess) || guess <= 0) return null;
  const size = Math.round((Math.abs(guess - model) * 100) / guess);
  const percent = guess >= model ? size : -size;
  return {
    model: model / 1000,
    guess: guess / 1000,
    percent: percent === 0 ? 0 : percent,
    ratio: percent === 0 ? 0 : percent / 100,
  };
}

/**
 * An edge as a reader sees it, in the locale's digits: `+5%` / `−25%` in the
 * list, where the sign is the point, or `23%` / `−25%` (`plus: false`) where
 * a bar's place already says which side of a guess it is. The minus is
 * U+2212, as `formatSigned` writes it. The caller isolates it left to right
 * (`<bdi dir="ltr">`), or a right-to-left page moves the sign to the far side.
 */
export function formatEdge(locale: string, percent: number, plus = true): string {
  const size = formatPercent(locale, Math.abs(percent), 0);
  if (percent < 0) return `−${size}`;
  return plus && percent > 0 ? `+${size}` : size;
}

// ---------------------------------------------------------------------------
// The opening card
// ---------------------------------------------------------------------------

/**
 * What the opening card may say. `available`: the two plain facts, with the
 * weakest-benchmark warning beside them. `limited`: under the sample rule
 * the card states the count and draws no headline figure, since 17% from a
 * dozen matches is not a finding. `empty`: nothing scored, nothing shown.
 */
export type VerdictState = 'available' | 'limited' | 'empty';

export function verdictState(total: AccuracyMetrics): VerdictState {
  if (total.coverage === 'not_supplied' || total.matches === 0) return 'empty';
  const complete = total.accuracy !== null && edgeOverGuess(total.rps, total.uniform_rps) !== null;
  return total.coverage === 'available' && complete ? 'available' : 'limited';
}

// ---------------------------------------------------------------------------
// The weekly chart
// ---------------------------------------------------------------------------

/** One ISO week of the chart. */
export interface WeekBar {
  /** `2026-W41`. */
  period: string;
  /** The week's Monday, `YYYY-MM-DD` (UTC). */
  periodStart: string;
  matches: number;
  edge: Edge;
  /** The week is still running, as the API says (`complete: false`). */
  partial: boolean;
  /** Fewer matches than the sample rule asks for: drawn dashed. */
  limited: boolean;
}

/**
 * The weeks the chart can draw, oldest first: every weekly point with a
 * match and both figures. A week is partial when the API says it is not
 * complete (T-1751, D-408): its end has not passed, or one of its matches is
 * still waiting for its score. The page no longer infers it from the last
 * scoring time.
 */
export function weeklyEdges(points: readonly PublicAccuracyPoint[]): WeekBar[] {
  const bars: WeekBar[] = [];
  for (const point of points) {
    const edge = edgeOverGuess(point.rps, point.uniform_rps);
    if (point.matches === 0 || edge === null) continue;
    bars.push({
      period: point.period,
      periodStart: point.period_start,
      matches: point.matches,
      edge,
      partial: !point.complete,
      limited: point.coverage !== 'available',
    });
  }
  return bars;
}

/** A single point is not a trend: the chart needs two complete weeks. */
export const WEEKLY_CHART_MINIMUM = 2;

/** The chart draws the latest weeks; the table under it has every week. */
export const WEEKLY_CHART_MAXIMUM = 12;

export function completeWeeks(bars: readonly WeekBar[]): number {
  return bars.filter((bar) => !bar.partial).length;
}

/** The chart's fixed measures, in CSS pixels; widths are percentages. */
export const WEEKLY_CHART = {
  /** Room above the plot for the tallest bar's figure. */
  top: 22,
  /** The plot's height, from its highest gridline to its lowest. */
  plot: 150,
  /** Room under the plot for the figure of a bar below the axis. */
  under: 18,
  /** The week's date and its matches. */
  labels: 34,
  /** The share of the width kept for the gridline labels, at the inline start. */
  gutter: 9,
  /** A bar's share of its slot, and its widest, in percent of the width. */
  fill: 0.56,
  widest: 10,
} as const;

export interface WeeklyChartBar extends WeekBar {
  /** The bar's centre and width, in percent of the chart's width. */
  centre: number;
  width: number;
  /** The bar's box, in pixels from the top. */
  y: number;
  height: number;
  /** The baseline of the figure: above a bar over the axis, under one below it. */
  labelY: number;
  /** Worse than a guess: drawn below the axis. */
  below: boolean;
}

export interface WeeklyChartGeometry {
  height: number;
  /** The zero line: a guess. */
  zeroY: number;
  /** Gridlines, top first, in whole percents. */
  ticks: { value: number; y: number }[];
  bars: WeeklyChartBar[];
  /** The whole record's edge as a line across, when it is inside the scale. */
  overallY: number | null;
  /** The baselines of the two label rows under the plot. */
  dateY: number;
  matchesY: number;
  /** Weeks left out because the chart draws only the latest. */
  omitted: number;
}

/**
 * Where the weekly chart's marks go. Time runs from the inline start to the
 * inline end, so on a right-to-left page the oldest week is on the right:
 * the centres are mirrored, the text is not. The scale is in steps of ten
 * (twenty when the range is wide), always includes zero, and reaches below
 * it only when a week was worse than a guess.
 */
export function weeklyChartGeometry(
  weeks: readonly WeekBar[],
  direction: 'ltr' | 'rtl',
  overall: Edge | null,
): WeeklyChartGeometry {
  const shown = weeks.slice(-WEEKLY_CHART_MAXIMUM);
  const values = shown.map((week) => week.edge.percent);
  const highest = Math.max(0, ...values);
  const lowest = Math.min(0, ...values);
  const step = highest - lowest > 60 ? 20 : 10;
  const top = Math.max(step, Math.ceil(highest / step) * step);
  const bottom = Math.floor(lowest / step) * step;
  const { top: pad, plot, under, labels, gutter, fill, widest } = WEEKLY_CHART;
  const yOf = (value: number): number => pad + ((top - value) / (top - bottom)) * plot;
  const zeroY = yOf(0);

  const ticks: { value: number; y: number }[] = [];
  for (let value = top; value >= bottom; value -= step) ticks.push({ value, y: yOf(value) });

  const slot = (100 - gutter) / Math.max(shown.length, 1);
  const width = Math.min(widest, slot * fill);
  const bars = shown.map((week, index): WeeklyChartBar => {
    const fromStart = gutter + slot * (index + 0.5);
    const below = week.edge.percent < 0;
    const edgeY = yOf(week.edge.percent);
    // A week level with a guess still gets a mark: two pixels on the axis.
    const height = Math.max(Math.abs(edgeY - zeroY), 2);
    const y = below ? zeroY : zeroY - height;
    return {
      ...week,
      centre: direction === 'rtl' ? 100 - fromStart : fromStart,
      width,
      y,
      height,
      labelY: below ? y + height + 13 : y - 6,
      below,
    };
  });

  const plotBottom = pad + plot;
  const inside = overall !== null && overall.percent <= top && overall.percent >= bottom;
  return {
    height: plotBottom + under + labels,
    zeroY,
    ticks,
    bars,
    overallY: inside && overall !== null ? yOf(overall.percent) : null,
    dateY: plotBottom + under + 12,
    matchesY: plotBottom + under + 28,
    omitted: weeks.length - shown.length,
  };
}

// ---------------------------------------------------------------------------
// The competition list
// ---------------------------------------------------------------------------

export type AccuracySort = 'matches' | 'edge';

/** `?sort=edge`; anything else is the default, by matches. */
export function accuracySort(value: string | string[] | undefined): AccuracySort {
  return value === 'edge' ? 'edge' : 'matches';
}

export interface CompetitionRow {
  series: PublicAccuracySeries;
  /** Null with nothing scored: no figure, no bar, no zero. */
  edge: Edge | null;
}

export interface CompetitionGroups {
  /** At or over the sample rule (`available`). */
  full: CompetitionRow[];
  /** Under it (`limited`): an early record, drawn dashed. */
  early: CompetitionRow[];
  /** Nothing scored (`not_supplied`): listed, with no figure. */
  none: CompetitionRow[];
}

/**
 * The list's groups, by the coverage state the API gives each competition,
 * each in the asked order: by matches (most first) or by edge over a guess
 * (best first), ties left in the API's order, which is by name.
 */
export function groupCompetitions(
  competitions: readonly PublicAccuracySeries[],
  sort: AccuracySort,
): CompetitionGroups {
  const groups: CompetitionGroups = { full: [], early: [], none: [] };
  for (const series of competitions) {
    if (series.competition === null) continue;
    const total = series.total;
    if (total.coverage === 'not_supplied' || total.matches === 0) {
      groups.none.push({ series, edge: null });
      continue;
    }
    const row = { series, edge: edgeOverGuess(total.rps, total.uniform_rps) };
    (total.coverage === 'available' ? groups.full : groups.early).push(row);
  }
  const byMatches = (a: CompetitionRow, b: CompetitionRow): number =>
    b.series.total.matches - a.series.total.matches;
  const byEdge = (a: CompetitionRow, b: CompetitionRow): number => {
    if (a.edge === null || b.edge === null) {
      return a.edge === b.edge ? byMatches(a, b) : a.edge === null ? 1 : -1;
    }
    return b.edge.percent - a.edge.percent || byMatches(a, b);
  };
  const order = sort === 'edge' ? byEdge : byMatches;
  // `sort` is stable, so equal rows keep the API's order.
  groups.full.sort(order);
  groups.early.sort(order);
  return groups;
}

/**
 * The width of a competition's bar from the centre line, in percent of the
 * track: half the track is an edge of 40%, anything beyond stops just short
 * of the end (the figure beside it says how far), and the smallest edge
 * still draws a mark.
 */
export function edgeBarWidth(percent: number): number {
  return Math.min(48, Math.max(1, Math.round(Math.abs(percent) * 1.25)));
}

// ---------------------------------------------------------------------------
// The page's addresses
// ---------------------------------------------------------------------------

/**
 * The page's address with its two plain-link choices. A period is written
 * only when the reader chose one (it also opens the measures); the default
 * order, by matches, is the address without `sort`.
 */
export function accuracyHref(
  locale: string,
  query: { period?: 'week' | 'month' | undefined; sort?: AccuracySort | undefined },
  fragment?: string,
): string {
  const params: string[] = [];
  if (query.period !== undefined) params.push(`period=${query.period}`);
  if (query.sort === 'edge') params.push('sort=edge');
  return `/${locale}/model-accuracy${params.length > 0 ? `?${params.join('&')}` : ''}${
    fragment === undefined ? '' : `#${fragment}`
  }`;
}
