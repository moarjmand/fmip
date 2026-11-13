import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccuracyCalibration,
  AccuracyMetrics,
  AccuracyPoint,
  PublicAccuracyPoint,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
  PublicVersionSeries,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelAccuracy, ModelAccuracyBand } from './model-accuracy';

/**
 * The public page's figures (T-1369), rendered: never a figure without a
 * match behind it (`not_supplied`), the count beside a figure below the
 * minimum (`limited`), the metrics explained, the model alone (rule 6), in
 * the reader's language and digits, and logical properties only (rule 7).
 * Since T-1750 (D-370): the opening card and its warning, the weekly chart,
 * the competition list and the measures under their disclosure.
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

/**
 * The fixtures are loose where step two added fields (T-1751): a point may
 * leave out its end and its flag (complete unless it says otherwise), the
 * overall series its calibration (nothing scored), the answer its versions
 * (none). `full` fills them in as the API would.
 */
type LoosePoint = AccuracyPoint & Partial<Pick<PublicAccuracyPoint, 'period_end' | 'complete'>>;
type LooseSeries = Omit<PublicAccuracySeries, 'points'> & {
  points: LoosePoint[];
  calibration?: AccuracyCalibration;
};
type Loose = Omit<Partial<PublicModelAccuracyResponse>, 'overall' | 'competitions'> & {
  overall?: LooseSeries;
  competitions?: LooseSeries[];
};

/** Ten steps with nothing in them: the API's calibration of an empty record. */
const NO_CALIBRATION: AccuracyCalibration = {
  minimum_forecasts: 30,
  coverage: 'not_supplied',
  bins: Array.from({ length: 10 }, (_, i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    forecasts: 0,
    happened: 0,
    said: null,
  })),
};

const point = (p: LoosePoint): PublicAccuracyPoint => ({
  period_end: p.period_start,
  complete: true,
  ...p,
});
const points = (s: LooseSeries) => ({ ...s, points: s.points.map(point) });
const full = (r: PublicModelAccuracyResponse | Loose): PublicModelAccuracyResponse => {
  const loose = r as Loose & PublicModelAccuracyResponse;
  const { calibration, ...overall } = loose.overall;
  return {
    ...loose,
    overall: { ...points(overall), competition: null, calibration: calibration ?? NO_CALIBRATION },
    competitions: loose.competitions.map(points),
    versions: loose.versions ?? [],
  };
};

const series = (overrides: Partial<LooseSeries>): LooseSeries => ({
  competition: null,
  model_versions: ['dixon-coles-elo@0.1.0'],
  total: metrics({}),
  points: [{ period: '2026-10', period_start: '2026-10-01', ...metrics({}) }],
  ...overrides,
});

/** A small record, under the sample rule everywhere: the page's limited state. */
const report = (overrides: Loose): PublicModelAccuracyResponse =>
  full({
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

// ---------------------------------------------------------------------------
// The live page's figures of 6 November 2026 (T-1750): 727 matches, five
// weeks, 22 competitions of which 13 have 30 matches or more.
// ---------------------------------------------------------------------------

const scored = (
  matches: number,
  accuracy: number,
  rps: number,
  uniform: number,
): AccuracyMetrics => ({
  forecasts: matches + 3,
  matches,
  coverage: matches < 30 ? 'limited' : 'available',
  log_loss: 0.954,
  brier: 0.564,
  rps,
  accuracy,
  uniform_rps: uniform,
});

const week = (
  period: string,
  start: string,
  matches: number,
  accuracy: number,
  rps: number,
  uniform: number,
  complete = true,
): PublicAccuracyPoint => ({
  period,
  period_start: start,
  period_end: start,
  complete,
  ...scored(matches, accuracy, rps, uniform),
});

// The week of 2 November was still running on the 6th: the API says so (T-1751).
const WEEKS: PublicAccuracyPoint[] = [
  week('2026-W41', '2026-10-05', 104, 0.587, 0.179, 0.233),
  week('2026-W42', '2026-10-12', 176, 0.563, 0.21, 0.249),
  week('2026-W43', '2026-10-19', 182, 0.517, 0.217, 0.239),
  week('2026-W44', '2026-10-26', 171, 0.673, 0.189, 0.252),
  week('2026-W45', '2026-11-02', 94, 0.532, 0.215, 0.244, false),
];

const MONTHS: LoosePoint[] = [
  { period: '2026-10', period_start: '2026-10-01', ...scored(599, 0.573, 0.201, 0.243) },
  {
    period: '2026-11',
    period_start: '2026-11-01',
    complete: false,
    ...scored(128, 0.594, 0.211, 0.25),
  },
];

/**
 * A calibration over the 727 matches' 2,181 probabilities. Not the live
 * page's: the API had no bins on 6 November. Invented for the test, adding
 * up as the API's must (one outcome a match happened, 727 in all); the top
 * step is under the minimum.
 */
const BINS: [number, number, number][] = [
  [160, 12, 0.07],
  [310, 46, 0.155],
  [520, 135, 0.255],
  [330, 112, 0.345],
  [300, 131, 0.45],
  [240, 128, 0.55],
  [170, 100, 0.645],
  [95, 63, 0.74],
  [42, 35, 0.84],
  [14, 13, 0.93],
];
const CALIBRATION: AccuracyCalibration = {
  minimum_forecasts: 30,
  coverage: 'available',
  bins: BINS.map(([forecasts, happened, said], i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    forecasts,
    happened,
    said,
  })),
};

/** Two published versions: the newer at the sample rule, the older under it. */
const version = (
  model: string,
  total: AccuracyMetrics,
  monthly: LoosePoint[],
): PublicVersionSeries => ({
  model_version: model,
  total,
  points: monthly.map(point),
  calibration: NO_CALIBRATION,
});
const SPLIT: PublicVersionSeries[] = [
  version('dixon-coles-elo@0.6.0', scored(700, 0.58, 0.202, 0.245), [
    { period: '2026-10', period_start: '2026-10-01', ...scored(572, 0.57, 0.2, 0.243) },
    { period: '2026-11', period_start: '2026-11-01', ...scored(128, 0.594, 0.211, 0.25) },
  ]),
  version('dixon-coles-elo@0.1.0', scored(27, 0.48, 0.23, 0.244), [
    { period: '2026-10', period_start: '2026-10-01', ...scored(27, 0.48, 0.23, 0.244) },
  ]),
];

// name, matches, share right, RPS, the guess's RPS; in the API's order, by name.
const COMPETITIONS: [string, number, number, number, number][] = [
  ['AFC Champions League Elite', 45, 0.511, 0.21, 0.237],
  ['AFC Champions League Two', 2, 0.5, 0.118, 0.194],
  ['Belgian Pro League', 27, 0.63, 0.201, 0.253],
  ['Bundesliga', 36, 0.444, 0.231, 0.236],
  ['Championship', 73, 0.521, 0.221, 0.244],
  ['CONMEBOL Libertadores', 4, 0, 0.266, 0.194],
  ['Copa del Rey', 19, 0.737, 0.16, 0.251],
  ['DFB-Pokal', 16, 0.813, 0.187, 0.267],
  ['Eredivisie', 36, 0.472, 0.227, 0.231],
  ['FA Cup', 11, 0.273, 0.328, 0.263],
  ['La Liga', 40, 0.65, 0.174, 0.236],
  ['Ligue 1', 36, 0.556, 0.188, 0.25],
  ['Persian Gulf Pro League', 37, 0.568, 0.173, 0.219],
  ['Premier League', 40, 0.5, 0.227, 0.24],
  ['Primeira Liga', 28, 0.714, 0.208, 0.272],
  ['Scottish League Cup', 2, 0.5, 0.219, 0.278],
  ['Scottish Premiership', 27, 0.482, 0.212, 0.235],
  ['Serie A', 50, 0.68, 0.192, 0.254],
  ['Süper Lig', 36, 0.694, 0.179, 0.255],
  ['UEFA Champions League', 54, 0.685, 0.199, 0.262],
  ['UEFA Conference League', 54, 0.537, 0.183, 0.231],
  ['UEFA Europa League', 54, 0.574, 0.208, 0.247],
];

const VERSIONS = ['dixon-coles-elo@0.1.0', 'dixon-coles-elo@0.6.0'];

const sixNov = (overrides: Loose = {}): PublicModelAccuracyResponse =>
  full({
    period: 'month',
    minimum_matches: 30,
    reference: { uniform_log_loss: 1.098612, uniform_brier: 0.666667, uniform_accuracy: 0.333333 },
    overall: {
      competition: null,
      model_versions: VERSIONS,
      total: scored(727, 0.576, 0.203, 0.245),
      points: MONTHS,
      calibration: CALIBRATION,
    },
    competitions: COMPETITIONS.map(([name, matches, accuracy, rps, uniform], index) => ({
      competition: { id: `c${index + 1}`, name },
      model_versions: VERSIONS,
      total: scored(matches, accuracy, rps, uniform),
      points: [
        {
          period: '2026-10',
          period_start: '2026-10-01',
          ...scored(matches, accuracy, rps, uniform),
        },
      ],
    })),
    versions: SPLIT,
    last_updated_at: '2026-11-05T22:10:00Z',
    ...overrides,
  });

type Props = Omit<Parameters<typeof ModelAccuracy>[0], 'locale' | 'report' | 'weekly'> & {
  weekly?: readonly LoosePoint[] | null;
};

// The page as it composes them: the band, then the figures (T-1620).
const html = (r: PublicModelAccuracyResponse | null, locale = 'en', props: Props = {}) =>
  renderToStaticMarkup(
    <>
      <ModelAccuracyBand locale={locale} />
      <ModelAccuracy
        locale={locale}
        report={r === null ? null : full(r)}
        {...props}
        weekly={props.weekly == null ? props.weekly : props.weekly.map(point)}
      />
    </>,
  );
/** The page of 6 November as the route renders it: months for the tables, weeks for the chart. */
const rendered = new Map<string, string>();
const live = (locale = 'en', props: Props = {}) => {
  const key = `${locale} ${JSON.stringify(props)}`;
  const out = rendered.get(key) ?? html(sixNov(), locale, { weekly: WEEKS, ...props });
  rendered.set(key, out);
  return out;
};
const text = (out: string) => out.replace(/<[^>]+>/g, '');
/** The element with this test id, to its closing tag (the first one: fine for a leaf or a section of leaves). */
const part = (out: string, testid: string, tag: string) =>
  new RegExp(`<${tag}[^>]*data-testid="${testid}"[\\s\\S]*?</${tag}>`).exec(out)?.[0] ?? '';
const NONE_SCORED = report({
  overall: series({ total: NONE, points: [], model_versions: [] }),
  competitions: [],
  last_updated_at: null,
});

describe('ModelAccuracy (T-1369)', () => {
  it('shows the figures below the minimum as limited, with the count', () => {
    const out = html(report({}));
    expect(out).toContain('data-testid="accuracy-limited"');
    expect(out).toContain('Only 12 matches have been scored so far, fewer than 30');
    expect(out).toContain('October 2026');
    // The text as read: the version's `@` is an element of its own (T-1580).
    const read = text(out);
    for (const figure of ['50.0%', '0.201', '0.249', '0.581', '0.988', 'dixon-coles-elo@0.1.0']) {
      expect(read).toContain(figure);
    }
    expect(out).not.toMatch(PHYSICAL);
  });

  it('shows no figure for a competition with nothing scored, and still lists it', () => {
    const out = html(report({}));
    expect(out).toContain('Serie A');
    expect(out).toContain('data-testid="accuracy-not-supplied"');
    // Every competition together, and the one competition with a record.
    expect(out.match(/data-testid="accuracy-months"/g)).toHaveLength(2);
  });

  it('makes each sideways-scrolling table a named region the keyboard reaches (T-1571)', () => {
    const out = html(report({}));
    const regions = [
      ...out.matchAll(/<div[^>]*role="region" aria-labelledby="([^"]+)" tabindex="0"[^>]*>/g),
    ];
    expect(regions).toHaveLength(2);
    // Named by the caption written above the box, so a phone reads it whole
    // (T-1620); the table keeps its own caption for a screen reader's table list.
    for (const [, id] of regions) expect(out).toMatch(new RegExp(`<p id="${id}"[^>]*>By month`));
    expect(out.match(/<caption class="sr-only">/g)).toHaveLength(2);
  });

  it('says there is no accuracy at all when nothing has been scored', () => {
    const out = html(NONE_SCORED);
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

  it('shows ISO weeks by their Monday, and offers month and week as links (T-1414)', () => {
    const weekly = report({
      period: 'week',
      overall: series({
        points: [{ period: '2026-W42', period_start: '2026-10-12', ...metrics({}) }],
      }),
    });
    const out = html(weekly, 'en', { chosenPeriod: true });
    expect(out).toContain('data-period="week"');
    expect(out).toContain('Week of 12 Oct 2026');
    expect(out).toContain('<time dateTime="2026-10-12">');
    expect(out).toContain('All weeks');
    expect(out).toContain('By week of kick-off, Monday first (UTC)');
    expect(out).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/en\/model-accuracy\?period=week#accuracy-measures")/,
    );
    expect(out).not.toMatch(PHYSICAL);
    const monthly = html(report({}));
    expect(monthly).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/en\/model-accuracy\?period=month#accuracy-measures")/,
    );
    expect(monthly).toContain('All months');
    const fa = html(weekly, 'fa');
    expect(fa).toContain('همه‌ی هفته‌ها');
    expect(fa).not.toContain('data-translation="untranslated"');
  });

  it('names the model versions with no "name@x.y.z" run in the HTML (T-1580)', () => {
    const out = html(report({}));
    // Cloudflare's Email Obfuscation rewrites such a run into "[email protected]".
    expect(out).not.toMatch(/\S+@\d+\.\d+\.\d+/);
    expect(text(out)).toContain('dixon-coles-elo@0.1.0');
  });

  it('says so when the API cannot be reached, guessing no version, date or figure', () => {
    const out = html(null);
    expect(out).toContain('data-testid="accuracy-unreachable"');
    expect(text(out)).toContain('The model’s accuracy cannot be shown right now.');
    expect(out).toContain('data-testid="title"');
    expect(out).not.toContain('data-testid="accuracy-meta"');
    expect(out).not.toContain('data-testid="accuracy-period"');
    // Today's behaviour, kept (T-1750): the band and the one sentence, nothing drawn.
    for (const absent of [
      'accuracy-overall',
      'accuracy-weekly',
      'accuracy-competitions',
      'accuracy-measures',
      'accuracy-cta',
    ]) {
      expect(out).not.toContain(`data-testid="${absent}"`);
    }
    expect(out).not.toMatch(/<svg[^>]*role="img"/);
    expect(out).not.toMatch(/\d%/);
  });

  describe('the Stadiomind page (T-1620, D-291)', () => {
    it('names the model alone in its band; its versions and the last scoring day sit under the verdict', () => {
      const out = html(report({}));
      const band = /<header[^>]*data-testid="accuracy-band"[\s\S]*?<\/header>/.exec(out)?.[0] ?? '';
      expect(text(band)).toContain('Statistical model');
      expect(text(band)).toContain('How accurate is our model?');
      // Rule 6: the model only, the other two products named as not counted.
      expect(text(band)).toContain('The statistical model’s published forecasts only');
      // Under the verdict, not in the band: a phone's first screen keeps the two figures.
      expect(band).not.toContain('data-testid="accuracy-meta"');
      const meta = part(out, 'accuracy-meta', 'ul');
      expect(text(meta)).toContain('Model versions: dixon-coles-elo@0.1.0.');
      expect(text(meta)).toContain('Last scored on 12 October 2026.');
      expect(meta).not.toMatch(PHYSICAL);
      expect(out.indexOf('data-testid="accuracy-meta"')).toBeGreaterThan(
        out.indexOf('data-testid="accuracy-verdict-sentence"'),
      );
      const page = live();
      expect(page.indexOf('data-testid="accuracy-meta"')).toBeGreaterThan(
        page.indexOf('data-testid="accuracy-verdict-sentence"'),
      );
      expect(page.indexOf('data-testid="accuracy-meta"')).toBeLessThan(
        page.indexOf('data-testid="accuracy-weekly-chart"'),
      );
      expect(band).not.toMatch(PHYSICAL);
      // No serif and no paper: the interface face on the theme's grounds.
      expect(out).not.toMatch(/font-serif|font-article|data-mode/);
    });

    it('draws the switch as a segmented control of two links, 44px each', () => {
      const out = html(report({}));
      const links = [...out.matchAll(/<a[^>]*data-testid="accuracy-period-(month|week)"[^>]*>/g)];
      expect(links.map((m) => m[1])).toEqual(['month', 'week']);
      for (const [tag] of links) expect(tag).toContain('min-h-touch');
      expect(links[0]![0]).toContain('aria-current="page"');
      expect(links[1]![0]).not.toContain('aria-current');
    });

    it('shows the totals as five tiles, each with what a guess scores and what it means', () => {
      const out = html(report({}));
      const tiles = [...out.matchAll(/data-testid="accuracy-kpi" data-metric="([^"]+)"/g)];
      expect(tiles.map((m) => m[1])).toEqual(['matches', 'correct', 'rps', 'brier', 'log-loss']);
      const read = text(out);
      for (const guess of ['33%', '0.249', '0.667', '1.099']) {
        expect(read).toContain(`If guessing: ${guess}`);
      }
      const kpis = /<dl[^>]*data-testid="accuracy-kpis"[\s\S]*?<\/dl>/.exec(out)?.[0] ?? '';
      expect(text(kpis).match(/Lower is better/g)).toHaveLength(3);
      expect(read).toContain('0 is perfect');
      // The small sample is said beside the tiles, not hidden (rule 3).
      expect(part(out, 'accuracy-measures', 'details')).toContain('data-testid="accuracy-limited"');
    });

    it('draws no tile and no table when nothing has been scored', () => {
      const out = html(NONE_SCORED);
      expect(out).not.toContain('data-testid="accuracy-kpis"');
      expect(out).not.toContain('data-testid="accuracy-meta"');
      expect(out).toContain('data-coverage-badge="not_supplied"');
    });

    it('says the band, the tiles and the weekly disclosure in Persian on /fa', () => {
      const read = text(html(report({ period: 'week' }), 'fa'));
      expect(read).toContain('هفته به هفته');
      expect(read).toContain('کمتر بهتر است');
      expect(read).toContain('با حدس تصادفی: ۳۳٪');
      // The last scoring day in the reader's calendar, as every date on /fa.
      expect(read).toContain('آخرین ارزیابی: ۲۰ مهر ۱۴۰۵.');
      expect(html(report({ period: 'week' }), 'fa')).not.toContain(
        'data-translation="untranslated"',
      );
    });
  });

  it('renders the model alone: no other product in its files (rule 6)', () => {
    for (const file of [
      'model-accuracy.tsx',
      'accuracy-verdict.tsx',
      'accuracy-weekly-chart.tsx',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/FounderAnalysis|Consensus|PredictionOutcome/);
      expect(source, file).not.toMatch(/from '@\/components\/(founder|community)/);
      expect(source, file).not.toMatch(/source\s*[:?]/);
    }
  });
});

describe('the accuracy page a reader can read (T-1750, D-370)', () => {
  describe('the opening card', () => {
    it('opens with two plain facts computed from the API’s numbers, not with RPS', () => {
      const out = live();
      const card = part(out, 'accuracy-overall', 'section');
      expect(card).toContain('data-verdict="available"');
      expect(text(part(card, 'accuracy-verdict-sentence', 'p'))).toBe(
        'Over 727 matches, the model picked the right result 58% of the time; a blind guess gets about 33%. Its probabilities also had 17% less error than a guess of one third each.',
      );
      // The card comes before every table and every score's name.
      expect(out.indexOf('data-testid="accuracy-overall"')).toBeLessThan(
        out.indexOf('data-testid="accuracy-kpis"'),
      );
      const figures = [...card.matchAll(/data-testid="accuracy-big" data-figure="([^"]+)"/g)];
      expect(figures.map((m) => m[1])).toEqual(['right', 'error']);
      const read = text(card);
      expect(read).toContain('of 727 matches called right');
      expect(read).toContain('Exactly 57.6%. A blind guess gets about 33%.');
      expect(read).toContain('less error than a guess of one third each');
      expect(read).toContain(
        'Ranked probability score (RPS): 0.203 for the model, 0.245 for the guess. Lower is better.',
      );
    });

    it('prints the arithmetic with its sample and its dates (D2)', () => {
      const line = part(live(), 'accuracy-arithmetic', 'p');
      expect(text(line)).toBe(
        '(0.245 − 0.203) ÷ 0.245 = 0.17, so 17% · 727 matches, 5 Oct to 5 Nov 2026',
      );
      // The sum stays left to right on a right-to-left page.
      expect(line).toContain('<bdi dir="ltr">(0.245 − 0.203) ÷ 0.245 = 0.17</bdi>');
    });

    it('never ships the sentence without the weakest-benchmark warning, in the open (D1)', () => {
      const out = live();
      const card = part(out, 'accuracy-overall', 'section');
      const caveat = text(part(card, 'accuracy-caveat', 'p'));
      expect(caveat).toBe(
        'A guess of one third each is the weakest benchmark. It shows the model knows something; it does not show that it beats bookmakers or other models, and this page cannot say. 5 weeks and 727 matches are an early record, not a verdict.',
      );
      // Not behind a disclosure: the card holds no <details> at all.
      expect(card).not.toContain('<details');
      // And in every language the sentence is in, the warning is too.
      for (const locale of ['fa', 'ar', 'de', 'x-rtl']) {
        const other = part(live(locale), 'accuracy-overall', 'section');
        expect(other, locale).toContain('data-testid="accuracy-verdict-sentence"');
        expect(other, locale).toContain('data-testid="accuracy-caveat"');
      }
    });

    it('draws the model against a guess as two named bars, turquoise against grey', () => {
      const card = part(live(), 'accuracy-overall', 'section');
      const marks = [...card.matchAll(/<span class="([^"]+)" style="([^"]+)" data-mark="(\w+)"/g)];
      expect(marks.map((m) => m[3])).toEqual(['model', 'guess', 'model', 'guess']);
      expect(marks.map((m) => m[2])).toEqual([
        'inline-size:57.599999999999994%',
        'inline-size:33.3333%',
        // The error bars share one scale: the larger of the two is the whole track.
        `inline-size:${(0.203 / 0.245) * 100}%`,
        'inline-size:100%',
      ]);
      expect(marks[0]![1]).toContain('bg-model');
      expect(marks[1]![1]).toContain('bg-caption');
      expect(text(card)).toContain('Model');
      expect(text(card)).toContain('A guess');
    });

    it('says more error, not less, when the model was worse than a guess', () => {
      const out = html(
        sixNov({
          overall: {
            competition: null,
            model_versions: VERSIONS,
            total: scored(727, 0.3, 0.26, 0.245),
            points: MONTHS,
          },
        }),
        'en',
        { weekly: WEEKS },
      );
      const read = text(part(out, 'accuracy-overall', 'section'));
      expect(read).toContain('Its probabilities had 6% more error than a guess of one third each.');
      expect(read).toContain('(0.245 − 0.260) ÷ 0.245 = −0.06, so −6%');
      expect(read).not.toContain('less error');
    });

    it('claims no percentage from a record under the sample rule', () => {
      const out = html(report({}), 'en', {
        weekly: [week('2026-W41', '2026-10-05', 12, 0.5, 0.2011, 0.2489)],
      });
      const card = part(out, 'accuracy-overall', 'section');
      expect(card).toContain('data-verdict="limited"');
      expect(card).toContain('data-coverage-badge="limited"');
      expect(text(card)).toContain(
        'Only 12 matches have been scored so far, fewer than 30: an early record, not a verdict.',
      );
      expect(text(card)).toContain('no headline figure and no chart');
      // (0.249 - 0.201) / 0.249 would be 19%: not said from twelve matches.
      expect(card).not.toContain('data-testid="accuracy-verdict-sentence"');
      expect(card).not.toContain('data-testid="accuracy-big"');
      expect(card).not.toContain('data-mark');
      expect(text(card)).not.toMatch(/\d%/);
      // No chart either; the figures stay one click away, marked limited.
      expect(out).not.toContain('data-testid="accuracy-weekly"');
      expect(part(out, 'accuracy-measures', 'details')).toContain('data-testid="accuracy-kpis"');
    });

    it('shows no figure, no chart and no measure with nothing scored', () => {
      const out = html(NONE_SCORED, 'en', { weekly: [] });
      const card = part(out, 'accuracy-overall', 'section');
      expect(card).toContain('data-verdict="empty"');
      expect(text(card)).toContain(
        'No forecast made before kick-off has been scored here yet, so there is no accuracy to show.',
      );
      expect(text(card)).not.toMatch(/\d/);
      expect(card).not.toContain('data-mark');
      expect(out).not.toContain('data-testid="accuracy-weekly"');
      expect(out).not.toContain('data-testid="accuracy-measures"');
      expect(out).not.toContain('data-testid="accuracy-competitions"');
      // What the measures will mean is still said, and the way on is still there.
      expect(out).toContain('data-testid="accuracy-explained"');
      expect(out).toContain('data-testid="accuracy-cta"');
      // Standing alone it is a second-level heading; inside the measures a third.
      expect(out).toContain('<h2 id="accuracy-explained-heading"');
      expect(live()).toContain('<h3 id="accuracy-explained-heading"');
    });
  });

  describe('the weekly chart', () => {
    const chartOf = (out: string) => part(out, 'accuracy-weekly-chart', 'svg');
    const weeksOf = (svg: string) =>
      [...svg.matchAll(/<g data-testid="accuracy-week"([^>]*)>/g)].map((m) => m[1]!);

    it('draws five weeks of edge over a guess as server-rendered SVG with a spoken sentence', () => {
      const out = live();
      const svg = chartOf(out);
      expect(svg).toMatch(/^<svg role="img" aria-label="/);
      expect(svg).toContain(
        'aria-label="Bar chart of how much better than a guess the model was in each of 5 weeks: 23%, 16%, 9%, 25% and 12%; 17% over all 727 matches."',
      );
      const weeks = weeksOf(svg);
      expect(weeks).toHaveLength(5);
      expect(weeks.map((attrs) => /data-edge="(-?\d+)"/.exec(attrs)?.[1])).toEqual([
        '23',
        '16',
        '9',
        '25',
        '12',
      ]);
      expect(weeks.every((attrs) => !attrs.includes('data-below'))).toBe(true);
      // No library and no script: a plain element tree, sized in percent and pixels.
      expect(svg).not.toContain('viewBox');
      expect(out).not.toContain('<script');
      const read = text(svg);
      for (const label of ['30%', '20%', '10%', '0%', '5 Oct', '2 Nov', '104', '94']) {
        expect(read).toContain(label);
      }
      expect(text(part(out, 'accuracy-weekly', 'section'))).toContain(
        'Every week so far beat a guess; the margin moved between 9% and 25%.',
      );
      expect(text(out)).toContain('All 727 matches: 17%');
    });

    it('marks the last, still-running week as incomplete, in shape and in words', () => {
      const out = live();
      const weeks = weeksOf(chartOf(out));
      expect(weeks.map((attrs) => attrs.includes('data-partial="true"'))).toEqual([
        false,
        false,
        false,
        false,
        true,
      ]);
      const bars = [...chartOf(out).matchAll(/<rect[^>]*data-mark="week"[^>]*>/g)].map((m) => m[0]);
      expect(bars[3]).toContain('class="fill-model"');
      expect(bars[3]).not.toContain('stroke-dasharray');
      expect(bars[4]).toContain('fill-model/25');
      expect(bars[4]).toContain('stroke-dasharray="4 3"');
      expect(text(part(out, 'accuracy-weekly-partial', 'li'))).toBe(
        'A week still running or waiting for a score is incomplete (scored to 5 Nov), so its bar is lighter and dashed.',
      );
      // Once the API calls the week complete, it is a week like the others: the
      // page infers nothing from the last scoring time (T-1751).
      const later = html(sixNov(), 'en', {
        weekly: WEEKS.map((week) => ({ ...week, complete: true })),
      });
      expect(chartOf(later)).not.toContain('data-partial');
      expect(later).not.toContain('data-testid="accuracy-weekly-partial"');
      // And a week the API calls running stays incomplete however late it was scored.
      const running = html(sixNov({ last_updated_at: '2026-11-12T06:00:00Z' }), 'en', {
        weekly: WEEKS,
      });
      expect(weeksOf(chartOf(running)).at(-1)).toContain('data-partial="true"');
      // An earlier week still waiting for a late result is marked and said too.
      const earlier = html(sixNov(), 'en', {
        weekly: WEEKS.map((week, i) => ({ ...week, complete: i !== 3 })),
      });
      expect(weeksOf(chartOf(earlier)).map((w) => w.includes('data-partial="true"'))).toEqual([
        false,
        false,
        false,
        true,
        false,
      ]);
      expect(earlier).toContain('data-testid="accuracy-weekly-partial"');
    });

    it('draws a week worse than a guess below the axis and says so', () => {
      const out = html(sixNov(), 'en', {
        weekly: [...WEEKS.slice(0, 4), week('2026-W45', '2026-11-02', 94, 0.4, 0.27, 0.244)],
      });
      const svg = chartOf(out);
      const weeks = weeksOf(svg);
      expect(weeks[4]).toContain('data-edge="-11"');
      expect(weeks[4]).toContain('data-below="true"');
      expect(weeks.slice(0, 4).every((attrs) => !attrs.includes('data-below'))).toBe(true);
      expect(text(svg)).toContain('−11%');
      expect(text(svg)).toContain('−10%');
      expect(svg).toContain('23%, 16%, 9%, 25% and −11%');
      expect(text(part(out, 'accuracy-weekly-reading', 'span'))).toBe(
        '1 week of 5 was worse than a guess; its bar is drawn below the line.',
      );
      expect(text(out)).not.toContain('Every week so far beat a guess');
    });

    it('says "every week" of the whole record, not of the weeks it draws (rule 3)', () => {
      // Thirteen weeks: the chart draws the latest twelve, and the one it leaves out lost to a guess.
      const later = Array.from({ length: 12 }, (_, index) => {
        const monday = new Date(Date.UTC(2026, 7, 10 + index * 7)).toISOString().slice(0, 10);
        return week(`2026-W${33 + index}`, monday, 60, 0.5, 0.2, 0.245);
      });
      const out = html(sixNov(), 'en', {
        weekly: [week('2026-W32', '2026-08-03', 60, 0.3, 0.3, 0.245), ...later],
      });
      expect(weeksOf(chartOf(out))).toHaveLength(12);
      expect(text(out)).not.toContain('Every week so far beat a guess');
      // Nor is a bar that is not drawn said to be drawn below the line.
      expect(text(part(out, 'accuracy-weekly-reading', 'span'))).toBe('');
      expect(text(part(out, 'accuracy-weekly-table', 'details'))).toContain('−22%');
    });

    it('names the table for a screen reader', () => {
      expect(part(live(), 'accuracy-weekly-table', 'details')).toMatch(
        /<caption class="sr-only">(<[^>]+>)*The chart as a table/,
      );
    });

    it('gives the same numbers as a table, every week of them', () => {
      const out = live();
      const table = part(out, 'accuracy-weekly-table', 'details');
      expect(table).not.toMatch(/<details[^>]* open/);
      expect(text(table)).toContain('The chart as a table');
      const rows = table.split('data-testid="accuracy-weekly-row"').slice(1).map(text);
      expect(rows).toHaveLength(5);
      expect(rows[0]).toContain('Week of 5 Oct 2026');
      expect(rows[0]).toContain('104');
      expect(rows[0]).toContain('0.179');
      expect(rows[0]).toContain('0.233');
      expect(rows[0]).toContain('+23%');
      expect(rows[4]).toContain('Week of 2 Nov 2026');
      expect(rows[4]).toContain('(incomplete)');
      expect(rows[4]).toContain('+12%');
    });

    it('replaces the chart with a sentence under two complete weeks', () => {
      // One complete week and the running one: a single point is not a trend.
      const out = html(sixNov(), 'en', { weekly: WEEKS.slice(3) });
      const section = part(out, 'accuracy-weekly', 'section');
      expect(section).toContain('data-chart="too-few"');
      expect(text(section)).toContain(
        'The weekly chart appears once two complete weeks have been scored. So far: 2 weeks. 265 matches scored.',
      );
      expect(section).not.toContain('<svg');
      expect(section).not.toContain('data-mark');
      // Two complete weeks are enough.
      expect(html(sixNov(), 'en', { weekly: WEEKS.slice(2) })).toContain('data-chart="drawn"');
    });

    it('says so when only the weekly figures did not arrive, and keeps the rest', () => {
      const out = html(sixNov(), 'en', { weekly: null });
      const section = part(out, 'accuracy-weekly', 'section');
      expect(section).toContain('data-chart="unreachable"');
      expect(text(section)).toContain('The weekly figures cannot be shown right now.');
      expect(section).not.toContain('<svg');
      // The card stands on the totals; without the weeks it names no first day.
      expect(text(part(out, 'accuracy-arithmetic', 'p'))).toBe(
        '(0.245 − 0.203) ÷ 0.245 = 0.17, so 17% · 727 matches scored.',
      );
      expect(text(part(out, 'accuracy-caveat', 'p'))).not.toContain('weeks');
      expect(out).toContain('data-testid="accuracy-competitions"');
    });

    it('uses a weekly report as its own chart when the tables are by week', () => {
      const out = html(
        sixNov({
          period: 'week',
          overall: {
            competition: null,
            model_versions: VERSIONS,
            total: scored(727, 0.576, 0.203, 0.245),
            points: WEEKS,
          },
        }),
      );
      expect(weeksOf(chartOf(out))).toHaveLength(5);
    });

    it('marks a week under the sample rule as an early one', () => {
      const out = html(sixNov(), 'en', {
        weekly: [week('2026-W40', '2026-09-28', 9, 0.4, 0.2, 0.25), ...WEEKS],
      });
      expect(weeksOf(chartOf(out))[0]).toContain('data-limited="true"');
      expect(text(part(out, 'accuracy-weekly-thin', 'li'))).toBe(
        'Lighter and dashed: fewer than 30 matches that week.',
      );
      expect(live()).not.toContain('data-testid="accuracy-weekly-thin"');
    });
  });

  describe('the competition list', () => {
    const groupsOf = (out: string) => {
      const list = out.slice(out.indexOf('data-testid="accuracy-competitions"'));
      const [, full = '', early = ''] = list.split('data-testid="accuracy-group"');
      return { full, early };
    };
    /** Each row to the end of its list item; a row holds no list of its own. */
    const rowsOf = (group: string) =>
      group
        .split('data-testid="accuracy-competition"')
        .slice(1)
        .map((row) => row.slice(0, row.indexOf('</li>')));
    const nameOf = (row: string) => /font-bold break-words">([^<]+)</.exec(row)?.[1];

    it('is one compact row a competition, in two groups split at 30 matches', () => {
      const out = live();
      const { full, early } = groupsOf(out);
      expect(full).toMatch(/^ data-group="full"/);
      expect(early).toMatch(/^ data-group="early"/);
      expect(rowsOf(full)).toHaveLength(13);
      expect(rowsOf(early)).toHaveLength(9);
      expect(text(full)).toContain('30 matches or more · 13 competitions');
      expect(text(early)).toContain(
        'Early record: fewer than 30 matches · 9 competitions. An early record, not a verdict.',
      );
      // Solid over the sample rule, dashed under it: a shape, not only a shade.
      expect(full).not.toContain('border-dashed');
      for (const row of rowsOf(early))
        expect(row).toMatch(/border-dashed[^"]*"[^>]*data-mark="edge"/);
      expect(out).not.toMatch(PHYSICAL);
    });

    it('is sorted by matches by default, with a plain link to sort by edge', () => {
      const out = live();
      expect(out).toContain('data-sort="matches"');
      expect(rowsOf(groupsOf(out).full).slice(0, 4).map(nameOf)).toEqual([
        'Championship',
        'UEFA Champions League',
        'UEFA Conference League',
        'UEFA Europa League',
      ]);
      const sort = part(out, 'accuracy-sort', 'p');
      expect(text(sort)).toBe('Sorted by matches·Sort by edge over a guess');
      expect(sort).toMatch(
        /<a[^>]*href="\/en\/model-accuracy\?sort=edge#accuracy-competitions-heading"/,
      );
      expect(sort).toMatch(/<a[^>]*class="[^"]*min-h-touch/);
    });

    it('sorts by edge over a guess on ?sort=edge, each group on its own', () => {
      const out = live('en', { sort: 'edge' });
      expect(out).toContain('data-sort="edge"');
      const { full, early } = groupsOf(out);
      expect(rowsOf(full).slice(0, 3).map(nameOf)).toEqual(['Süper Lig', 'La Liga', 'Ligue 1']);
      expect(rowsOf(full).slice(-3).map(nameOf)).toEqual([
        'Premier League',
        'Bundesliga',
        'Eredivisie',
      ]);
      expect(rowsOf(early).slice(-2).map(nameOf)).toEqual(['FA Cup', 'CONMEBOL Libertadores']);
      const sort = part(out, 'accuracy-sort', 'p');
      expect(text(sort)).toBe('Sorted by edge over a guess·Sort by matches');
      expect(sort).toMatch(/<a[^>]*href="\/en\/model-accuracy#accuracy-competitions-heading"/);
      // The reader's period travels with the sort, and the sort with the period.
      const weekly = live('en', { sort: 'edge', chosenPeriod: true });
      expect(part(weekly, 'accuracy-sort', 'p')).toContain(
        'href="/en/model-accuracy?period=month#accuracy-competitions-heading"',
      );
      expect(weekly).toContain(
        'href="/en/model-accuracy?period=week&amp;sort=edge#accuracy-measures"',
      );
    });

    it('shows the signed edge beside a bar on the better or the worse side', () => {
      const rows = rowsOf(live().slice(0));
      const row = (name: string) => rows.find((r) => nameOf(r) === name) ?? '';
      const premier = row('Premier League');
      expect(premier).toMatch(/data-testid="accuracy-edge">.*?<bdi dir="ltr">\+5%<\/bdi>/);
      expect(premier).toMatch(/style="inline-size:6%" data-mark="edge" data-side="better"/);
      expect(premier).toMatch(/class="[^"]*start-1\/2[^"]*bg-model"/);
      const cup = row('FA Cup');
      expect(cup).toMatch(/data-testid="accuracy-edge">.*?<bdi dir="ltr">−25%<\/bdi>/);
      expect(cup).toMatch(/data-mark="edge" data-side="worse" data-early="true"/);
      expect(cup).toMatch(/class="[^"]*end-1\/2[^"]*border-dashed/);
      // The bar repeats the figure beside it, so a screen reader is told once.
      expect(premier).toMatch(/<span aria-hidden="true"[^>]*data-testid="accuracy-edge-bar"/);
      expect(text(premier)).toContain('Matches: 40');
      expect(text(premier)).toContain('Better than a guess: +5%');
    });

    it('opens a row, without script, to the five figures and its months', () => {
      const rows = rowsOf(live());
      const premier = rows.find((r) => nameOf(r) === 'Premier League') ?? '';
      expect(premier).toMatch(/<details class="group\/row">\s*<summary/);
      expect(premier).not.toMatch(/<details[^>]* open/);
      const read = text(premier);
      for (const figure of [
        '40 matches scored.',
        '50.0%',
        '0.227',
        'If guessing: 0.240',
        '0.564',
      ]) {
        expect(read).toContain(figure);
      }
      expect(premier).toMatch(/<details class="group\/period[^"]*">[\s\S]*Month by month/);
      expect(premier).toContain('data-testid="accuracy-months"');
      expect(premier).toMatch(/<a[^>]*href="\/en\/competition\/c14"/);
      expect(read).toContain('Premier League: the competition’s page');
      // Under the sample rule the opened row says so, with the badge and the count.
      const copa = rows.find((r) => nameOf(r) === 'Copa del Rey') ?? '';
      expect(copa).toContain('data-coverage-badge="limited"');
      expect(text(copa)).toContain(
        'Only 19 matches have been scored so far, fewer than 30: an early record, not a verdict.',
      );
      expect(premier).not.toContain('data-testid="accuracy-limited"');
      expect(premier).not.toContain('data-coverage-badge="limited"');
      expect(text(live('en', { chosenPeriod: true }))).toContain('Month by month');
    });

    it('lists a competition with nothing scored with no figure, no bar and no zero', () => {
      const out = html(
        sixNov({
          competitions: [
            ...sixNov().competitions.slice(0, 3),
            {
              competition: {
                id: 'none',
                name: 'Coppa Italia',
                logo: { coverage: 'not_supplied', url: null },
              },
              model_versions: [],
              total: NONE,
              points: [],
            },
          ],
        }),
        'en',
        { weekly: WEEKS, sort: 'edge' },
      );
      const rows = rowsOf(groupsOf(out).early);
      // Last in the early group, whatever the order asked for.
      const row = rows.at(-1) ?? '';
      expect(nameOf(row)).toBe('Coppa Italia');
      expect(row).toMatch(/^ data-coverage="not_supplied"/);
      expect(row).toContain('data-coverage-badge="not_supplied"');
      expect(text(row)).toContain('there is no accuracy to show');
      expect(row).not.toContain('<details');
      expect(row).not.toContain('data-testid="accuracy-edge-bar"');
      expect(row).not.toContain('data-testid="accuracy-edge"');
      expect(row).not.toContain('data-mark');
      expect(text(row).split('Coppa Italia')[1]).not.toMatch(/\d/);
      // No logo held: the lettered mark, never a stand-in (rule 3).
      expect(row).toContain('data-letters="CI"');
      expect(row).not.toContain('<img');
    });

    it('shows a competition’s logo when one is held', () => {
      const out = html(
        sixNov({
          competitions: [
            {
              ...sixNov().competitions[13]!,
              competition: {
                id: 'c14',
                name: 'Premier League',
                logo: { coverage: 'available', url: '/api/media/logo/c14.ab12cd34.png' },
              },
            },
          ],
        }),
        'en',
        { weekly: WEEKS },
      );
      expect(rowsOf(out)[0]).toMatch(/<img[^>]*src="\/api\/media\/logo\/c14\.ab12cd34/);
    });
  });

  describe('the measures', () => {
    it('keeps RPS, Brier and log loss under one closed disclosure, each with a plain sentence', () => {
      const out = live();
      const measures = part(out, 'accuracy-measures', 'details');
      expect(measures).toMatch(/^<details id="accuracy-measures" class=/);
      expect(text(measures)).toContain('Show all measures');
      expect(measures).toContain('data-testid="accuracy-months"');
      for (const inside of ['accuracy-kpis', 'accuracy-period', 'accuracy-explained']) {
        expect(measures, inside).toContain(`data-testid="${inside}"`);
        // Nowhere else on the page: the opening is the sentence, not the scores.
        expect(out.split(`data-testid="${inside}"`).length - 1, inside).toBe(
          measures.split(`data-testid="${inside}"`).length - 1,
        );
      }
      const read = text(measures);
      for (const sentence of [
        'How far the three probabilities were from what happened, with part credit for a near miss. 0 is perfect.',
        'The average squared gap between each probability and what happened.',
        'How surprised the model was by the results; being confidently wrong costs the most.',
        '727 matches scored.',
        'October 2026',
        'All months',
        'What the figures mean',
      ]) {
        expect(read).toContain(sentence);
      }
      // What the page opens with, the card and the chart, names no score but RPS in passing.
      const before = text(out.slice(0, out.indexOf('data-testid="accuracy-competitions"')));
      expect(before).not.toContain('Brier');
      expect(before).not.toContain('Log loss');
    });

    it('opens on the period the reader chose, since the switch reloads the page', () => {
      const out = live('en', { chosenPeriod: true });
      expect(part(out, 'accuracy-measures', 'details')).toMatch(
        /^<details id="accuracy-measures" open=""/,
      );
    });
  });

  describe('the calibration chart (T-1751, D-408)', () => {
    const section = (out: string) => part(out, 'accuracy-calibration', 'section');
    const steps = (out: string) =>
      [
        ...part(out, 'accuracy-calibration-chart', 'svg').matchAll(
          /<g data-testid="accuracy-calibration-step"([^>]*)><circle cx="([\d.]+)%" cy="([\d.]+)"([^>]*)>/g,
        ),
      ].map((m) => ({ attrs: m[1] ?? '', x: Number(m[2]), y: Number(m[3]), circle: m[4] ?? '' }));

    it('draws a dot a step at what the model said and how often it happened', () => {
      const out = live();
      expect(section(out)).toContain('data-chart="drawn"');
      expect(text(section(out))).toContain('When it says 60%, how often does it happen?');
      expect(text(section(out))).toContain(
        'Every probability of 727 matches, 2,181 in all: home, draw and away of each match’s last forecast before kick-off.',
      );
      const dots = steps(out);
      expect(dots).toHaveLength(10);
      // Higher probabilities happened more often: the dots climb (y falls) from left to right.
      expect(dots.map((d) => d.x)).toEqual([...dots.map((d) => d.x)].sort((a, b) => a - b));
      // 60% to 70%: 100 of 170 happened, 59%, placed at the step's mean, 0.645.
      const sixty = dots[6]!;
      expect(sixty.attrs).toContain('data-forecasts="170"');
      expect(sixty.y).toBeCloseTo(16 + (1 - 100 / 170) * 220, 6);
      expect(sixty.x).toBeCloseTo(9 + 0.645 * 88, 6);
      const label =
        /<svg role="img" aria-label="([^"]*)"[^>]*data-testid="accuracy-calibration-chart"/.exec(
          out,
        )?.[1];
      expect(label).toContain('said 60% to 70%, 59% of 170 forecasts happened');
      expect(label).toContain('On the diagonal is a perfect forecaster.');
    });

    it('draws a step under the minimum hollow, with its count, and says why', () => {
      const out = live();
      const top = steps(out)[9]!;
      expect(top.attrs).toContain('data-thin="true"');
      expect(top.circle).toContain('fill-surface stroke-model');
      expect(steps(out)[8]!.circle).toContain('fill-model stroke-model');
      // Near the inline end (0.93) the count sits on the inline-start side, in
      // both directions, so it never runs past the drawing on a phone.
      expect(part(out, 'accuracy-calibration-chart', 'svg')).toMatch(
        /data-thin="true"><circle[^>]*><\/circle><text[^>]*dx="-10"[^>]*text-anchor="end"[^>]*>14<\/text>/,
      );
      expect(part(live('fa'), 'accuracy-calibration-chart', 'svg')).toMatch(
        /data-thin="true"><circle[^>]*><\/circle><text[^>]*dx="10"[^>]*text-anchor="start"[^>]*>۱۴<\/text>/,
      );
      expect(text(part(out, 'accuracy-calibration-hollow', 'li'))).toBe(
        'Fewer than 30: hollow, with its count beside it',
      );
    });

    it('gives the same ten rows as a table, an empty step as dashes, never zeros', () => {
      const empty = CALIBRATION.bins.map((bin, i) =>
        i === 0 ? { ...bin, forecasts: 0, happened: 0, said: null } : bin,
      );
      const out = html(
        sixNov({
          overall: {
            competition: null,
            model_versions: VERSIONS,
            total: scored(727, 0.576, 0.203, 0.245),
            points: MONTHS,
            calibration: { ...CALIBRATION, bins: empty },
          },
        }),
        'en',
        { weekly: WEEKS },
      );
      expect(steps(out)).toHaveLength(9);
      const table = part(out, 'accuracy-calibration-table', 'details');
      expect(table).not.toMatch(/<details[^>]* open/);
      const rows = [
        ...table.matchAll(/<tr[^>]*data-testid="accuracy-calibration-row"[^>]*>([\s\S]*?)<\/tr>/g),
      ].map((m) => text(m[1] ?? ''));
      expect(rows).toHaveLength(10);
      expect(rows[0]).toBe('0% to 10%———');
      expect(rows[6]).toBe('60% to 70%17010059%');
      expect(rows[9]).toBe('90% to 100%(fewer than 30)141393%');
    });

    it('draws no chart when every step is under the minimum, only a sentence (rule 3)', () => {
      const thin = {
        ...CALIBRATION,
        coverage: 'limited' as const,
        bins: CALIBRATION.bins.map((bin) => ({ ...bin, forecasts: Math.min(bin.forecasts, 29) })),
      };
      const out = html(
        sixNov({
          overall: {
            competition: null,
            model_versions: VERSIONS,
            total: scored(727, 0.576, 0.203, 0.245),
            points: MONTHS,
            calibration: thin,
          },
        }),
        'en',
        { weekly: WEEKS },
      );
      const s = section(out);
      expect(s).toContain('data-chart="too-thin"');
      expect(s).not.toContain('<svg');
      expect(s).not.toContain('data-mark');
      expect(s).not.toContain('accuracy-calibration-table');
      expect(text(s)).toContain(
        'The chart appears once one step of ten points holds 30 forecasts. So far 275 probabilities have been scored, and no step holds 30.',
      );
    });

    it('is not on the page under the sample rule, with nothing scored, or unreachable', () => {
      for (const out of [html(report({})), html(NONE_SCORED), html(null)]) {
        expect(out).not.toContain('data-testid="accuracy-calibration"');
        expect(text(out)).not.toContain('When it says 60%');
      }
    });

    it('mirrors in Persian: 0% at the inline start, on the right, digits left to right', () => {
      const en = steps(live());
      const fa = steps(live('fa'));
      fa.forEach((dot, i) => expect(dot.x).toBeCloseTo(100 - en[i]!.x, 6));
      const svg = part(live('fa'), 'accuracy-calibration-chart', 'svg');
      expect(svg).toContain('data-direction="rtl"');
      expect(svg).toMatch(/<text x="100%"[^>]*text-anchor="end" direction="ltr"[^>]*>۱۰۰٪</);
      expect(text(svg)).not.toMatch(/[0-9]/);
      const s = section(live('fa'));
      expect(text(s)).toContain('وقتی می‌گوید ۶۰٪، چند بار رخ می‌دهد؟');
      expect(s).not.toContain('data-translation="untranslated"');
      expect(s).not.toMatch(PHYSICAL);
    });
  });

  describe('each version on its own (T-1751, D-408)', () => {
    const cards = (out: string) =>
      part(out, 'accuracy-versions-split', 'section')
        .split('data-testid="accuracy-version"')
        .slice(1);

    it('gives each published version a card with its own coverage, newest first', () => {
      const out = live();
      const [newer = '', older = ''] = cards(out);
      expect(cards(out)).toHaveLength(2);
      expect(text(part(out, 'accuracy-versions-split', 'section'))).toContain(
        'Each match is counted once, under the version of its last forecast before kick-off. Candidate models still in testing are not shown.',
      );
      expect(newer).toMatch(/^ data-coverage="available"/);
      expect(text(newer)).toContain('dixon-coles-elo@0.6.0');
      expect(text(newer)).toContain('Kick-offs from October 2026 to November 2026.');
      expect(text(part(newer, 'accuracy-version-figures', 'dl'))).toBe(
        'Matches700Correct58.0%Better than a guess+18%RPS0.202If guessing: 0.245',
      );
      expect(newer).not.toContain('data-coverage-badge');
      // Under the sample rule: the badge, the count and the sentence; no figure claimed.
      expect(older).toMatch(/^ data-coverage="limited"/);
      expect(older).toContain('data-coverage-badge="limited"');
      expect(text(older)).toContain(
        'Only 27 matches have been scored with this version, fewer than 30: an early record, not a verdict.',
      );
      expect(older).not.toContain('accuracy-version-figures');
      expect(text(older)).not.toMatch(/%/);
    });

    it('says no longer that the figures combine the versions, and names no version in an attribute', () => {
      const out = live();
      expect(text(part(out, 'accuracy-meta', 'ul'))).toContain(
        'Model versions: dixon-coles-elo@0.1.0, dixon-coles-elo@0.6.0.',
      );
      expect(text(out)).not.toContain('The figures combine these versions');
      expect(out).not.toMatch(/\S+@\d+\.\d+\.\d+/);
    });

    it('is not drawn for one version, under the sample rule overall, or with nothing scored', () => {
      expect(html(sixNov({ versions: SPLIT.slice(0, 1) }), 'en', { weekly: WEEKS })).not.toContain(
        'accuracy-versions-split',
      );
      expect(html(NONE_SCORED)).not.toContain('accuracy-versions-split');
      expect(html(sixNov({ versions: [] }), 'en', { weekly: WEEKS })).not.toContain(
        'accuracy-versions-split',
      );
    });

    it('reads in Persian, with the count and the edge in Persian digits', () => {
      const out = live('fa');
      const section = part(out, 'accuracy-versions-split', 'section');
      expect(text(section)).toContain('هر نسخه‌ی مدل جدا');
      expect(section).toContain('<bdi dir="ltr">+۱۸٪</bdi>');
      expect(text(section)).toContain('تا اینجا فقط ۲۷ بازی با این نسخه ارزیابی شده');
      expect(section).not.toContain('data-translation="untranslated"');
      expect(section).not.toMatch(PHYSICAL);
    });
  });

  it('draws the page in this order: card, weekly, calibration, versions, competitions', () => {
    const out = live();
    const at = (id: string) => out.indexOf(`data-testid="${id}"`);
    expect(at('accuracy-overall')).toBeLessThan(at('accuracy-weekly'));
    expect(at('accuracy-weekly')).toBeLessThan(at('accuracy-calibration'));
    expect(at('accuracy-calibration')).toBeLessThan(at('accuracy-versions-split'));
    expect(at('accuracy-versions-split')).toBeLessThan(at('accuracy-competitions'));
    // Two pictures: the weekly chart and the calibration.
    expect(out.match(/<svg[^>]*role="img"/g)).toHaveLength(2);
  });

  it('draws the model’s data in turquoise only: no saffron on a data mark', () => {
    for (const out of [live(), live('fa'), live('en', { sort: 'edge', chosenPeriod: true })]) {
      const marks = [
        ...out.matchAll(/<(?:span|rect|line|circle)[^>]*data-mark="[^"]+"[^>]*>/g),
      ].map((m) => m[0]);
      // Two pairs on the card, five bars and the overall line on the chart, 22
      // competitions; the calibration's ten dots and its perfect forecaster.
      expect(marks).toHaveLength(4 + 5 + 1 + 22 + 10 + 1);
      for (const mark of marks) {
        expect(mark).not.toMatch(/brand|accent|saffron|warning|danger|live/);
        // The guess and the perfect forecaster are grey and named; the rest is the model's.
        if (!mark.includes('data-mark="guess"') && !mark.includes('data-mark="perfect"'))
          expect(mark).toMatch(/(?:bg|fill|stroke|border)-model/);
      }
      expect(marks.find((mark) => mark.includes('data-mark="perfect"'))).toContain(
        'stroke-caption',
      );
      const svg = part(out, 'accuracy-weekly-chart', 'svg');
      expect(svg).not.toMatch(/brand|accent/);
      expect(part(out, 'accuracy-calibration-chart', 'svg')).not.toMatch(/brand|accent/);
      // Saffron is the one closing button.
      expect(out.match(/bg-brand(?![/\w-])/g)).toHaveLength(1);
      expect(part(out, 'accuracy-cta', 'section')).toMatch(
        /<a[^>]*class="[^"]*bg-brand [^"]*"[^>]*href="\/en\/scores"|<a[^>]*class="[^"]*bg-brand [^"]*"[^>]*href="\/fa\/scores"/,
      );
    }
  });

  it('ends on the way to today’s forecasts', () => {
    const cta = part(live(), 'accuracy-cta', 'section');
    expect(text(cta)).toContain('See today’s forecasts');
    expect(text(cta)).toContain(
      'Every forecast is stored before kick-off and never edited, so this record can be checked against the next match.',
    );
    expect(cta).toMatch(/<a[^>]*class="[^"]*min-h-touch[^"]*"[^>]*href="\/en\/scores"/);
  });

  describe('in Persian', () => {
    it('says the card in Persian digits and the Jalali calendar', () => {
      const out = live('fa');
      expect(out).not.toContain('data-translation="untranslated"');
      const card = part(out, 'accuracy-overall', 'section');
      expect(text(part(card, 'accuracy-verdict-sentence', 'p'))).toBe(
        'در ۷۲۷ بازی، مدل نتیجه‌ی درست را ۵۸٪ مواقع انتخاب کرد؛ حدس تصادفی حدود ۳۳٪ درست درمی‌آید. احتمال‌های مدل هم ۱۷٪ خطای کمتر از حدسِ یک‌سوم برای هر نتیجه داشت.',
      );
      expect(text(part(card, 'accuracy-arithmetic', 'p'))).toBe(
        '(۰٫۲۴۵ − ۰٫۲۰۳) ÷ ۰٫۲۴۵ = ۰٫۱۷، یعنی ۱۷٪ · ۷۲۷ بازی، ۱۳ مهر تا ۱۴ آبان ۱۴۰۵',
      );
      expect(card).toContain('<bdi dir="ltr">(۰٫۲۴۵ − ۰٫۲۰۳) ÷ ۰٫۲۴۵ = ۰٫۱۷</bdi>');
      expect(text(part(card, 'accuracy-caveat', 'p'))).toContain('ضعیف‌ترین معیار مقایسه است');
      expect(text(card)).not.toMatch(/[0-9]/);
    });

    it('mirrors the chart: the oldest week at the inline start, on the right', () => {
      const centres = (out: string) =>
        [
          ...part(out, 'accuracy-weekly-chart', 'svg').matchAll(
            /<rect x="([\d.]+)%" width="([\d.]+)%"/g,
          ),
        ].map((m) => Number(m[1]) + Number(m[2]) / 2);
      const en = centres(live());
      const fa = centres(live('fa'));
      expect(en).toHaveLength(5);
      expect(en).toEqual([...en].sort((a, b) => a - b));
      expect(fa).toEqual([...fa].sort((a, b) => b - a));
      fa.forEach((centre, index) => expect(centre).toBeCloseTo(100 - en[index]!, 6));
      const svg = part(live('fa'), 'accuracy-weekly-chart', 'svg');
      expect(svg).toContain('data-direction="rtl"');
      // The gridline labels sit at the inline start: the right edge, digits left to right.
      expect(svg).toMatch(/<text x="100%"[^>]*text-anchor="end" direction="ltr"[^>]*>۳۰٪</);
      expect(part(live(), 'accuracy-weekly-chart', 'svg')).toMatch(
        /<text x="0"[^>]*text-anchor="start" direction="ltr"[^>]*>30%</,
      );
      expect(text(svg)).toContain('۱۳ مهر');
      expect(text(svg)).toContain('۱۰۴');
      // Persian's list separator carries a right-to-left mark.
      expect(svg.replace(/‏/g, '')).toContain('۲۳٪، ۱۶٪، ۹٪، ۲۵٪، و ۱۲٪');
      expect(text(svg)).not.toMatch(/[0-9]/);
    });

    it('keeps a signed percentage left to right inside the right-to-left list', () => {
      const out = live('fa');
      expect(out).toContain('<bdi dir="ltr">+۵٪</bdi>');
      expect(out).toContain('<bdi dir="ltr">−۲۵٪</bdi>');
      expect(out).toContain('<bdi dir="ltr">−۳۷٪</bdi>');
      const read = text(out);
      expect(read).toContain('۳۰ بازی یا بیشتر · ۱۳ رقابت');
      expect(read).toContain(
        'سابقه‌ی اولیه: کمتر از ۳۰ بازی · ۹ رقابت. یک سابقه‌ی اولیه است، نه یک داوری.',
      );
      expect(read).toContain('نمایش همه‌ی معیارها');
      expect(read).toContain('پیش‌بینی‌های امروز را ببینید');
      // The bars mirror by logical properties alone: no class or style names a side.
      expect(out).not.toMatch(PHYSICAL);
      expect(out).not.toMatch(/style="[^"]*(?:left|right)/);
    });
  });
});
