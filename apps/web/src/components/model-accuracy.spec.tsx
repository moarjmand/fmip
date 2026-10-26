import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccuracyMetrics,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelAccuracy, ModelAccuracyBand } from './model-accuracy';

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

// The page as it composes them: the band, then the figures (T-1620).
const html = (r: PublicModelAccuracyResponse | null, locale = 'en') =>
  renderToStaticMarkup(
    <>
      <ModelAccuracyBand locale={locale} report={r} />
      <ModelAccuracy locale={locale} report={r} />
    </>,
  );
const text = (out: string) => out.replace(/<[^>]+>/g, '');

describe('ModelAccuracy (T-1369)', () => {
  it('shows the figures below the minimum as limited, with the count', () => {
    const out = html(report({}));
    expect(out).toContain('data-testid="accuracy-limited"');
    expect(out).toContain('Only 12 matches have been scored so far, fewer than 30');
    expect(out).toContain('October 2026');
    // The text as read: the version's `@` is an element of its own (T-1580).
    const read = out.replace(/<[^>]+>/g, '');
    for (const text of ['50.0%', '0.201', '0.249', '0.581', '0.988', 'dixon-coles-elo@0.1.0']) {
      expect(read).toContain(text);
    }
    expect(out).not.toMatch(PHYSICAL);
  });

  it('shows no figure for a competition with nothing scored, and still lists it', () => {
    const out = html(report({}));
    expect(out).toContain('Serie A');
    expect(out).toContain('data-testid="accuracy-not-supplied"');
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

  it('shows ISO weeks by their Monday, and offers month and week as links (T-1414)', () => {
    const weekly = report({
      period: 'week',
      overall: series({
        points: [{ period: '2026-W42', period_start: '2026-10-12', ...metrics({}) }],
      }),
    });
    const out = html(weekly);
    expect(out).toContain('data-period="week"');
    expect(out).toContain('Week of 12 Oct 2026');
    expect(out).toContain('<time dateTime="2026-10-12">');
    expect(out).toContain('All weeks');
    expect(out).toContain('By week of kick-off, Monday first (UTC)');
    expect(out).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/en\/model-accuracy\?period=week")/,
    );
    expect(out).not.toMatch(PHYSICAL);
    const monthly = html(report({}));
    expect(monthly).toMatch(/<a(?=[^>]*aria-current="page")(?=[^>]*href="\/en\/model-accuracy")/);
    expect(monthly).toContain('All months');
    const fa = html(weekly, 'fa');
    expect(fa).toContain('همه‌ی هفته‌ها');
    expect(fa).not.toContain('data-translation="untranslated"');
  });

  it('names the model versions with no "name@x.y.z" run in the HTML (T-1580)', () => {
    const out = html(report({}));
    // Cloudflare's Email Obfuscation rewrites such a run into "[email protected]".
    expect(out).not.toMatch(/\S+@\d+\.\d+\.\d+/);
    expect(out.replace(/<[^>]+>/g, '')).toContain('dixon-coles-elo@0.1.0');
  });

  it('says so when the API cannot be reached, guessing no version, date or switch', () => {
    const out = html(null);
    expect(out).toContain('data-testid="accuracy-unreachable"');
    expect(out).toContain('data-testid="title"');
    expect(out).not.toContain('data-testid="accuracy-meta"');
    expect(out).not.toContain('data-testid="accuracy-period"');
  });

  describe('the Stadiomind page (T-1620, D-291)', () => {
    it('names the model alone in its band, with its versions and the last scoring day', () => {
      const out = html(report({}));
      const band = /<header[^>]*data-testid="accuracy-band"[\s\S]*?<\/header>/.exec(out)?.[0] ?? '';
      expect(text(band)).toContain('Statistical model');
      expect(text(band)).toContain('How accurate is our model?');
      // Rule 6: the model only, the other two products named as not counted.
      expect(text(band)).toContain('The statistical model’s published forecasts only');
      expect(text(band)).toContain('Model versions: dixon-coles-elo@0.1.0.');
      expect(text(band)).toContain('Last scored on 12 October 2026.');
      expect(band).toContain('data-testid="accuracy-period"');
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
      expect(out).toContain('data-testid="accuracy-limited"');
    });

    it('draws no tile and no table when nothing has been scored', () => {
      const out = html(
        report({
          overall: series({ total: NONE, points: [], model_versions: [] }),
          competitions: [],
          last_updated_at: null,
        }),
      );
      expect(out).not.toContain('data-testid="accuracy-kpis"');
      expect(out).not.toContain('data-testid="accuracy-meta"');
      expect(out).toContain('data-coverage-badge="not_supplied"');
    });

    it('gives each competition a card with its logo, its link, its coverage and its months', () => {
      const out = html(
        report({
          competitions: [
            series({
              competition: {
                id: 'c1',
                name: 'Premier League',
                logo: { coverage: 'available', url: '/api/media/logo/c1.ab12cd34.png' },
              },
            }),
            series({
              competition: {
                id: 'c2',
                name: 'Serie A',
                logo: { coverage: 'not_supplied', url: null },
              },
              model_versions: [],
              total: NONE,
              points: [],
            }),
          ],
        }),
      );
      const cards = out.split('data-testid="accuracy-competition"').slice(1);
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatch(/<img[^>]*src="\/api\/media\/logo\/c1\.ab12cd34/);
      expect(cards[0]).toContain('href="/en/competition/c1"');
      expect(cards[0]).toContain('data-coverage-badge="limited"');
      // The early-record note under 30 matches, and the months under a disclosure.
      expect(text(cards[0]!)).toContain('an early record, not a verdict');
      expect(cards[0]).toMatch(/<details[^>]*>[\s\S]*<summary[^>]*>[\s\S]*Month by month/);
      // No logo held: the lettered mark, never a stand-in (rule 3); no figure, no table.
      expect(cards[1]).toContain('data-letters="SA"');
      expect(cards[1]).not.toContain('<img');
      expect(cards[1]).toContain('data-coverage-badge="not_supplied"');
      expect(cards[1]).not.toContain('<details');
    });

    it('keeps the competitions in the order the API sends them', () => {
      const out = html(report({}));
      expect(out.indexOf('Premier League')).toBeLessThan(out.indexOf('Serie A'));
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

  it('renders the model alone: no other product in its file (rule 6)', () => {
    const source = readFileSync(join(__dirname, 'model-accuracy.tsx'), 'utf8');
    expect(source).not.toMatch(/FounderAnalysis|Consensus|PredictionOutcome/);
    expect(source).not.toMatch(/from '@\/components\/(founder|community)/);
    expect(source).not.toMatch(/source\s*[:?]/);
  });
});
