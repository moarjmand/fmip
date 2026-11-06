import type { AccuracyMetrics, AccuracyPoint, PublicAccuracySeries } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  WEEKLY_CHART_MAXIMUM,
  accuracyHref,
  accuracySort,
  completeWeeks,
  edgeBarWidth,
  edgeOverGuess,
  formatEdge,
  groupCompetitions,
  verdictState,
  weeklyChartGeometry,
  weeklyEdges,
} from './accuracy-edge';

/**
 * The accuracy page's arithmetic (T-1750, D-370), on the figures the live
 * page showed on 6 November 2026: 727 matches, RPS 0.203 against 0.245 for a
 * guess of one third each, five weeks, 22 competitions of which 13 have 30
 * matches or more.
 */

const metrics = (
  matches: number,
  rps: number | null,
  uniform: number | null,
  overrides: Partial<AccuracyMetrics> = {},
): AccuracyMetrics => ({
  forecasts: matches,
  matches,
  coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
  log_loss: rps === null ? null : 0.95,
  brier: rps === null ? null : 0.56,
  rps,
  accuracy: rps === null ? null : 0.55,
  uniform_rps: uniform,
  ...overrides,
});

const week = (start: string, matches: number, rps: number, uniform: number): AccuracyPoint => ({
  period: `week-of-${start}`,
  period_start: start,
  ...metrics(matches, rps, uniform),
});

const WEEKS: AccuracyPoint[] = [
  week('2026-10-05', 104, 0.179, 0.233),
  week('2026-10-12', 176, 0.21, 0.249),
  week('2026-10-19', 182, 0.217, 0.239),
  week('2026-10-26', 171, 0.189, 0.252),
  week('2026-11-02', 94, 0.215, 0.244),
];
const LAST_SCORED = '2026-11-05T22:10:00Z';

// name, matches, RPS, the guess's RPS: the 22 competitions of 6 Nov, in the API's order (by name).
const COMPETITIONS: [string, number, number, number][] = [
  ['AFC Champions League Elite', 45, 0.21, 0.237],
  ['AFC Champions League Two', 2, 0.118, 0.194],
  ['Belgian Pro League', 27, 0.201, 0.253],
  ['Bundesliga', 36, 0.231, 0.236],
  ['Championship', 73, 0.221, 0.244],
  ['CONMEBOL Libertadores', 4, 0.266, 0.194],
  ['Copa del Rey', 19, 0.16, 0.251],
  ['DFB-Pokal', 16, 0.187, 0.267],
  ['Eredivisie', 36, 0.227, 0.231],
  ['FA Cup', 11, 0.328, 0.263],
  ['La Liga', 40, 0.174, 0.236],
  ['Ligue 1', 36, 0.188, 0.25],
  ['Persian Gulf Pro League', 37, 0.173, 0.219],
  ['Premier League', 40, 0.227, 0.24],
  ['Primeira Liga', 28, 0.208, 0.272],
  ['Scottish League Cup', 2, 0.219, 0.278],
  ['Scottish Premiership', 27, 0.212, 0.235],
  ['Serie A', 50, 0.192, 0.254],
  ['Süper Lig', 36, 0.179, 0.255],
  ['UEFA Champions League', 54, 0.199, 0.262],
  ['UEFA Conference League', 54, 0.183, 0.231],
  ['UEFA Europa League', 54, 0.208, 0.247],
];

const competitions = (): PublicAccuracySeries[] =>
  COMPETITIONS.map(([name, matches, rps, uniform], index) => ({
    competition: { id: `c${index + 1}`, name },
    model_versions: ['dixon-coles-elo@0.6.0'],
    total: metrics(matches, rps, uniform),
    points: [],
  }));

const names = (rows: { series: PublicAccuracySeries }[]): string[] =>
  rows.map((row) => row.series.competition?.name ?? '');

describe('edgeOverGuess', () => {
  it('is 17% from 0.203 against 0.245, the arithmetic the page prints', () => {
    expect(edgeOverGuess(0.203, 0.245)).toEqual({
      model: 0.203,
      guess: 0.245,
      percent: 17,
      ratio: 0.17,
    });
  });

  it('works from the figures as printed, so the printed arithmetic always holds', () => {
    // Unrounded, (0.24549 - 0.20251) / 0.24549 is 17.5%, which would print 18%
    // beside "(0.245 − 0.203) ÷ 0.245", whose answer is 17%.
    expect(edgeOverGuess(0.20251, 0.24549)).toMatchObject({
      model: 0.203,
      guess: 0.245,
      percent: 17,
    });
  });

  it('gives the five weeks of 6 November their 23, 16, 9, 25 and 12 percent', () => {
    expect(WEEKS.map((w) => edgeOverGuess(w.rps, w.uniform_rps)?.percent)).toEqual([
      23, 16, 9, 25, 12,
    ]);
  });

  it('is negative when the model had more error than a guess', () => {
    expect(edgeOverGuess(0.328, 0.263)).toMatchObject({ percent: -25, ratio: -0.25 });
    expect(edgeOverGuess(0.266, 0.194)).toMatchObject({ percent: -37 });
  });

  it('rounds a half up on either side of a guess, and never says minus zero', () => {
    expect(edgeOverGuess(0.199, 0.2)?.percent).toBe(1);
    expect(edgeOverGuess(0.201, 0.2)?.percent).toBe(-1);
    const level = edgeOverGuess(0.2, 0.2);
    expect(Object.is(level?.percent, 0)).toBe(true);
    expect(Object.is(level?.ratio, 0)).toBe(true);
    // 0.2004 and 0.1996 both print 0.200.
    expect(edgeOverGuess(0.2004, 0.1996)?.percent).toBe(0);
  });

  it('makes no edge out of a missing figure or a guess of zero (rule 3)', () => {
    expect(edgeOverGuess(null, 0.245)).toBeNull();
    expect(edgeOverGuess(0.203, null)).toBeNull();
    expect(edgeOverGuess(0.203, 0)).toBeNull();
    expect(edgeOverGuess(0.203, 0.0004)).toBeNull();
  });
});

describe('formatEdge', () => {
  it('writes the sign out, with a real minus', () => {
    expect(formatEdge('en', 5)).toBe('+5%');
    expect(formatEdge('en', -25)).toBe('−25%');
    expect(formatEdge('en', 0)).toBe('0%');
  });

  it('leaves the plus off where the bar already says which side', () => {
    expect(formatEdge('en', 23, false)).toBe('23%');
    expect(formatEdge('en', -25, false)).toBe('−25%');
  });

  it('uses Persian digits and the Persian percent sign on /fa', () => {
    expect(formatEdge('fa', 36)).toBe('+۳۶٪');
    expect(formatEdge('fa', -25)).toBe('−۲۵٪');
  });
});

describe('verdictState', () => {
  it('is available at the sample rule with both figures', () => {
    expect(verdictState(metrics(727, 0.203, 0.245))).toBe('available');
  });

  it('is limited under the sample rule: no headline from a dozen matches', () => {
    expect(verdictState(metrics(12, 0.201, 0.249))).toBe('limited');
  });

  it('is limited when a figure the sentence needs is missing', () => {
    expect(verdictState(metrics(40, 0.2, null))).toBe('limited');
    expect(verdictState(metrics(40, 0.2, 0.25, { accuracy: null }))).toBe('limited');
  });

  it('is empty with nothing scored', () => {
    expect(verdictState(metrics(0, null, null))).toBe('empty');
  });
});

describe('weeklyEdges', () => {
  it('reads five weeks, the last one still running when it was last scored', () => {
    const bars = weeklyEdges(WEEKS, LAST_SCORED);
    expect(bars.map((bar) => bar.edge.percent)).toEqual([23, 16, 9, 25, 12]);
    expect(bars.map((bar) => bar.matches)).toEqual([104, 176, 182, 171, 94]);
    expect(bars.map((bar) => bar.partial)).toEqual([false, false, false, false, true]);
    expect(completeWeeks(bars)).toBe(4);
  });

  it('calls the last week complete once the record was scored after its Sunday', () => {
    expect(weeklyEdges(WEEKS, '2026-11-08T23:59:59Z').at(-1)?.partial).toBe(true);
    expect(weeklyEdges(WEEKS, '2026-11-09T00:00:00Z').at(-1)?.partial).toBe(false);
  });

  it('cannot call the last week complete without a scoring time', () => {
    expect(weeklyEdges(WEEKS, null).at(-1)?.partial).toBe(true);
  });

  it('marks a week under the sample rule, and leaves out one with no figure', () => {
    const bars = weeklyEdges(
      [
        week('2026-10-05', 12, 0.2, 0.25),
        { period: 'empty', period_start: '2026-10-12', ...metrics(0, null, null) },
        week('2026-10-19', 40, 0.2, 0.25),
      ],
      '2026-11-05T00:00:00Z',
    );
    expect(bars.map((bar) => bar.periodStart)).toEqual(['2026-10-05', '2026-10-19']);
    expect(bars.map((bar) => bar.limited)).toEqual([true, false]);
  });
});

describe('weeklyChartGeometry', () => {
  const bars = weeklyEdges(WEEKS, LAST_SCORED);
  const overall = edgeOverGuess(0.203, 0.245);

  it('puts time from the inline start: left to right in English', () => {
    const chart = weeklyChartGeometry(bars, 'ltr', overall);
    const centres = chart.bars.map((bar) => bar.centre);
    expect(centres).toEqual([...centres].sort((a, b) => a - b));
    expect(centres[0]).toBeGreaterThan(9);
    expect(centres.at(-1)).toBeLessThan(100);
  });

  it('mirrors on a right-to-left page: the oldest week on the right', () => {
    const ltr = weeklyChartGeometry(bars, 'ltr', overall);
    const rtl = weeklyChartGeometry(bars, 'rtl', overall);
    rtl.bars.forEach((bar, index) => {
      expect(bar.centre).toBeCloseTo(100 - ltr.bars[index]!.centre, 6);
      // Only the place is mirrored: the bar is the same bar.
      expect(bar.height).toBe(ltr.bars[index]!.height);
    });
    expect(rtl.bars[0]!.centre).toBeGreaterThan(rtl.bars.at(-1)!.centre);
  });

  it('scales in tens from zero, taller for a bigger edge', () => {
    const chart = weeklyChartGeometry(bars, 'ltr', overall);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([30, 20, 10, 0]);
    const [first, , third, fourth] = chart.bars;
    expect(fourth!.height).toBeGreaterThan(first!.height);
    expect(first!.height).toBeGreaterThan(third!.height);
    for (const bar of chart.bars) {
      expect(bar.below).toBe(false);
      expect(bar.y + bar.height).toBeCloseTo(chart.zeroY, 6);
      expect(bar.labelY).toBeLessThan(bar.y);
    }
    // 17% over every match: a line between the 10% and 20% gridlines.
    expect(chart.overallY).toBeLessThan(chart.ticks[2]!.y);
    expect(chart.overallY).toBeGreaterThan(chart.ticks[1]!.y);
    expect(chart.omitted).toBe(0);
  });

  it('draws a week worse than a guess below the axis', () => {
    const withBad = weeklyEdges(
      [...WEEKS.slice(0, 4), week('2026-11-02', 94, 0.27, 0.244)],
      '2026-11-10T00:00:00Z',
    );
    const chart = weeklyChartGeometry(withBad, 'ltr', overall);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([30, 20, 10, 0, -10, -20]);
    const bad = chart.bars.at(-1)!;
    expect(bad.edge.percent).toBe(-11);
    expect(bad.below).toBe(true);
    expect(bad.y).toBeCloseTo(chart.zeroY, 6);
    expect(bad.labelY).toBeGreaterThan(bad.y + bad.height);
    expect(chart.zeroY).toBeLessThan(chart.ticks.at(-1)!.y);
  });

  it('widens its steps when the weeks are far apart', () => {
    const wide = weeklyEdges(
      [week('2026-10-05', 40, 0.1, 0.25), week('2026-10-12', 40, 0.31, 0.25)],
      '2026-11-05T00:00:00Z',
    );
    const chart = weeklyChartGeometry(wide, 'ltr', null);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([60, 40, 20, 0, -20, -40]);
    expect(chart.overallY).toBeNull();
  });

  it('draws the latest weeks only and says how many it left out', () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      week(
        `2026-${index < 9 ? '08' : '09'}-${String((index % 9) * 3 + 1).padStart(2, '0')}`,
        40,
        0.2,
        0.25,
      ),
    );
    const chart = weeklyChartGeometry(weeklyEdges(many, '2026-12-01T00:00:00Z'), 'ltr', null);
    expect(chart.bars).toHaveLength(WEEKLY_CHART_MAXIMUM);
    expect(chart.omitted).toBe(2);
    expect(chart.bars[0]!.periodStart).toBe(many[2]!.period_start);
  });

  it('keeps a mark on the axis for a week level with a guess', () => {
    const level = weeklyEdges(
      [week('2026-10-05', 40, 0.25, 0.25), week('2026-10-12', 40, 0.2, 0.25)],
      '2026-11-05T00:00:00Z',
    );
    expect(weeklyChartGeometry(level, 'ltr', null).bars[0]!.height).toBe(2);
  });
});

describe('groupCompetitions', () => {
  it('splits the 22 competitions at 30 matches: 13 and 9', () => {
    const groups = groupCompetitions(competitions(), 'matches');
    expect(groups.full).toHaveLength(13);
    expect(groups.early).toHaveLength(9);
    expect(groups.none).toHaveLength(0);
    expect(groups.full.every((row) => row.series.total.matches >= 30)).toBe(true);
    expect(groups.early.every((row) => row.series.total.matches < 30)).toBe(true);
  });

  it('orders by matches by default, ties in the order the API sent', () => {
    const groups = groupCompetitions(competitions(), 'matches');
    expect(names(groups.full).slice(0, 5)).toEqual([
      'Championship',
      'UEFA Champions League',
      'UEFA Conference League',
      'UEFA Europa League',
      'Serie A',
    ]);
    expect(names(groups.early).slice(0, 3)).toEqual([
      'Primeira Liga',
      'Belgian Pro League',
      'Scottish Premiership',
    ]);
  });

  it('orders by edge over a guess when asked, within each group', () => {
    const groups = groupCompetitions(competitions(), 'edge');
    expect(groups.full.slice(0, 5).map((row) => [names([row])[0], row.edge?.percent])).toEqual([
      ['Süper Lig', 30],
      ['La Liga', 26],
      ['Ligue 1', 25],
      // Level at 24%: the one with more matches first.
      ['UEFA Champions League', 24],
      ['Serie A', 24],
    ]);
    expect(names(groups.full).slice(-3)).toEqual(['Premier League', 'Bundesliga', 'Eredivisie']);
    // The early records keep to their own group however good or bad they look.
    expect(names(groups.early)[0]).toBe('AFC Champions League Two');
    expect(names(groups.early).slice(-2)).toEqual(['FA Cup', 'CONMEBOL Libertadores']);
    expect(groups.early.at(-1)?.edge?.percent).toBe(-37);
  });

  it('keeps a competition with nothing scored apart, with no edge at all', () => {
    const groups = groupCompetitions(
      [
        ...competitions().slice(0, 2),
        {
          competition: { id: 'none', name: 'Coppa Italia' },
          model_versions: [],
          total: metrics(0, null, null),
          points: [],
        },
      ],
      'edge',
    );
    expect(names(groups.none)).toEqual(['Coppa Italia']);
    expect(groups.none[0]?.edge).toBeNull();
    expect(names([...groups.full, ...groups.early])).not.toContain('Coppa Italia');
  });

  it('does not reorder the response it was given', () => {
    const given = competitions();
    const before = given.map((series) => series.competition?.name);
    groupCompetitions(given, 'edge');
    expect(given.map((series) => series.competition?.name)).toEqual(before);
  });
});

describe('edgeBarWidth', () => {
  it('scales an edge to the half track and stops short of its end', () => {
    expect(edgeBarWidth(5)).toBe(6);
    expect(edgeBarWidth(-37)).toBe(46);
    expect(edgeBarWidth(80)).toBe(48);
    expect(edgeBarWidth(-0.2)).toBe(1);
  });
});

describe('the page’s addresses', () => {
  it('reads ?sort=edge and nothing else as the other order', () => {
    expect(accuracySort('edge')).toBe('edge');
    expect(accuracySort('matches')).toBe('matches');
    expect(accuracySort(undefined)).toBe('matches');
    expect(accuracySort(['edge', 'edge'])).toBe('matches');
    expect(accuracySort('EDGE')).toBe('matches');
  });

  it('writes only what the reader chose', () => {
    expect(accuracyHref('en', {})).toBe('/en/model-accuracy');
    expect(accuracyHref('en', { sort: 'matches' })).toBe('/en/model-accuracy');
    expect(accuracyHref('fa', { sort: 'edge' }, 'accuracy-competitions-heading')).toBe(
      '/fa/model-accuracy?sort=edge#accuracy-competitions-heading',
    );
    expect(accuracyHref('en', { period: 'week', sort: 'edge' }, 'accuracy-measures')).toBe(
      '/en/model-accuracy?period=week&sort=edge#accuracy-measures',
    );
    expect(accuracyHref('en', { period: 'month' })).toBe('/en/model-accuracy?period=month');
  });
});
