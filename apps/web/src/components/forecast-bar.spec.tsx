import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { modelPick } from '@/lib/moments-rail';
import type { CardForecast } from '@/lib/score-card-products';
import { forecastBarWords } from '@/lib/words-server';
import {
  ForecastBar,
  type ForecastBarSize,
  type Outcome,
  labelLines,
  nameEm,
  ninetyOutcome,
  rankSteps,
} from './forecast-bar';
import { ForecastBarWithReceipt } from './forecast-receipt';

/**
 * The model's three probabilities, one component and one language (T-1748,
 * D-368; T-1749, D-369; boards P3-2 and P3-3): the steps by rank, the fixed
 * order, a label on each segment with the name whole or absent, what
 * happened as an outline and a tick; and, around the bar where a page holds
 * a `CardForecast` (`forecast-receipt.tsx`), the receipt and a sentence for
 * every way there can be no forecast.
 */

const AVAILABLE: CardForecast = {
  state: 'available',
  home: 46.4,
  draw: 33.6,
  away: 20,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-11T09:30:00.000Z',
};

const bar = (
  forecast: CardForecast,
  extra: {
    locale?: string;
    started?: boolean;
    outcome?: Outcome;
    size?: ForecastBarSize;
    labels?: 'numbers' | 'named';
  } = {},
) => {
  const locale = extra.locale ?? 'en';
  return renderToStaticMarkup(
    <ForecastBarWithReceipt
      forecast={forecast}
      home="Tractor"
      away="Esteghlal"
      started={extra.started}
      outcome={extra.outcome}
      size={extra.size}
      labels={extra.labels}
      locale={locale}
      timeZone="UTC"
      words={forecastBarWords(locale)}
    />,
  );
};

/** The bar alone, as a caller that prints the receipt itself draws it. */
const alone = (
  shares: { home: number; draw: number; away: number },
  extra: { size?: ForecastBarSize; outcome?: Outcome; locale?: string } = {},
) =>
  renderToStaticMarkup(
    <ForecastBar
      forecast={shares}
      home="Tractor"
      away="Esteghlal"
      size={extra.size}
      outcome={extra.outcome}
      locale={extra.locale ?? 'en'}
      words={forecastBarWords(extra.locale ?? 'en')}
    />,
  );

/** The segments in document order: [outcome, step, classes]. */
const segments = (html: string) =>
  [...html.matchAll(/<span data-segment="(\w+)" data-step="(\d)"[^>]*? class="([^"]*)"/g)].map(
    (m) => [m[1] ?? '', m[2] ?? '', m[3] ?? ''] as const,
  );

/** The label cells in document order, each with its own markup. */
const cells = (html: string) =>
  [
    ...html.matchAll(/<span data-outcome="(\w+)"[\s\S]*?(?=<span data-outcome=|<div role="img")/g),
  ].map((m) => [m[1] ?? '', m[0]] as const);

const SIZES: ForecastBarSize[] = ['row', 'card', 'headline'];
const OUTCOMES: Outcome[] = ['home', 'draw', 'away'];

describe('rankSteps', () => {
  it('gives the steps by the rank of the share, whatever its place', () => {
    expect(rankSteps({ home: 55, draw: 28.8, away: 16.2 })).toEqual({ home: 1, draw: 2, away: 3 });
    // The away side is the favourite: it is the full step, not the faintest.
    expect(rankSteps({ home: 28.6, draw: 22.9, away: 48.5 })).toEqual({
      home: 2,
      draw: 3,
      away: 1,
    });
    // The draw leads.
    expect(rankSteps({ home: 32.6, draw: 37.3, away: 30.1 })).toEqual({
      home: 2,
      draw: 1,
      away: 3,
    });
  });

  it('settles ties home, then away, then the draw', () => {
    expect(rankSteps({ home: 40, draw: 20, away: 40 })).toEqual({ home: 1, draw: 3, away: 2 });
    expect(rankSteps({ home: 20, draw: 40, away: 40 })).toEqual({ home: 3, draw: 2, away: 1 });
    expect(rankSteps({ home: 40, draw: 40, away: 20 })).toEqual({ home: 1, draw: 2, away: 3 });
    expect(rankSteps({ home: 30, draw: 35, away: 35 })).toEqual({ home: 3, draw: 2, away: 1 });
    const third = 100 / 3;
    expect(rankSteps({ home: third, draw: third, away: third })).toEqual({
      home: 1,
      away: 2,
      draw: 3,
    });
  });

  it('never names a likeliest outcome other than the model’s pick, ties included', () => {
    const shares = [
      { home: 40, draw: 20, away: 40 },
      { home: 20, draw: 40, away: 40 },
      { home: 40, draw: 40, away: 20 },
      { home: 100 / 3, draw: 100 / 3, away: 100 / 3 },
      { home: 10, draw: 30, away: 60 },
    ];
    for (const triple of shares) {
      const steps = rankSteps(triple);
      expect(steps[modelPick(triple)]).toBe(1);
      // Always one of each step.
      expect(Object.values(steps).sort()).toEqual([1, 2, 3]);
    }
  });
});

describe('ninetyOutcome', () => {
  const line = (home: number, away: number) => ({ home, away });
  const scores = (over: object) => ({
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
    ...over,
  });

  it('is what happened in the ninety minutes of a finished match (T-1749)', () => {
    expect(
      ninetyOutcome({
        status: 'finished',
        scores: scores({ current: line(2, 0), full_time: line(2, 0) }),
      }),
    ).toBe('home');
    expect(
      ninetyOutcome({
        status: 'finished',
        scores: scores({ current: line(0, 2), full_time: line(0, 2) }),
      }),
    ).toBe('away');
    expect(ninetyOutcome({ status: 'finished', scores: scores({ current: line(1, 1) }) })).toBe(
      'draw',
    );
    // Won in extra time and on penalties: the model forecast the ninety minutes.
    expect(
      ninetyOutcome({
        status: 'finished',
        scores: scores({
          current: line(1, 3),
          full_time: line(1, 1),
          extra_time: line(0, 2),
          penalties: line(4, 2),
        }),
      }),
    ).toBe('draw');
  });

  it('is nothing before full time, with no score, or when the result is disputed', () => {
    for (const status of ['scheduled', 'live', 'postponed', 'abandoned'] as const) {
      expect(ninetyOutcome({ status, scores: scores({ current: line(1, 0) }) })).toBeNull();
    }
    expect(ninetyOutcome({ status: 'finished', scores: scores({}) })).toBeNull();
    expect(
      ninetyOutcome({
        status: 'finished',
        scores: scores({ current: line(1, 0), full_time: line(1, 0) }),
        score_dispute: { recorded_goals: 3, reported: line(1, 0) },
      }),
    ).toBeNull();
  });
});

describe('ForecastBar', () => {
  it('fills the segments by rank in the model’s three steps and nothing else', () => {
    expect(
      segments(bar(AVAILABLE)).map(([key, step, fill]) => [key, step, fill.split(' ')[0]]),
    ).toEqual([
      ['home', '1', 'bg-model'],
      ['draw', '2', 'bg-model/75'],
      ['away', '3', 'bg-model/50'],
    ]);
    // The away side likeliest: the full step is at the end of the bar.
    const away = alone({ home: 28.6, draw: 22.9, away: 48.5 });
    expect(segments(away).map(([key, , fill]) => [key, fill.split(' ')[0]])).toEqual([
      ['home', 'bg-model/75'],
      ['draw', 'bg-model/50'],
      ['away', 'bg-model'],
    ]);
  });

  it.each(SIZES)('keeps home, draw, away in the source at %s size, labels and segments', (size) => {
    const html = bar(AVAILABLE, { size });
    expect(html).toContain(`data-size="${size}"`);
    expect(segments(html).map(([key]) => key)).toEqual(OUTCOMES);
    expect(cells(html).map(([key]) => key)).toEqual(OUTCOMES);
    // The labels come before the bar, each cell growing by its segment's share.
    expect(html.indexOf('data-outcome="home"')).toBeLessThan(html.indexOf('role="img"'));
    for (const share of ['46.4', '33.6', '20']) {
      expect(html.match(new RegExp(`flex-grow:${share};flex-basis:0`, 'g'))).toHaveLength(2);
    }
  });

  it('mirrors by direction alone on a right-to-left page, in Persian digits', () => {
    const html = bar(AVAILABLE, { locale: 'fa' });
    // Home is first in the source, so the direction puts it on the right.
    expect(segments(html).map(([key]) => key)).toEqual(OUTCOMES);
    expect(cells(html).map(([key]) => key)).toEqual(OUTCOMES);
    expect(html).toContain('۴۶٫۴٪');
    expect(html).toContain('مساوی');
    expect(html).toContain('محاسبه‌شده');
    expect(html).toContain('نسخه ۳');
    // The model id stays a left-to-right island inside Persian.
    expect(html).toContain('<span dir="ltr">dixon-coles-elo<span>@</span>0.6.0</span>');
    // Nothing physical: the ends of the bar are logical radii (rule 7).
    expect(html).toContain('rounded-s-pill');
    expect(html).toContain('rounded-e-pill');
    for (const size of SIZES) {
      expect(bar(AVAILABLE, { locale: 'fa', size, outcome: 'away' })).not.toMatch(
        /\b(ml|mr|pl|pr|left|right|rounded-l|rounded-r|text-left|text-right)-/,
      );
    }
  });

  it('writes the number first and the name after it, on each segment’s own cell', () => {
    const html = bar(AVAILABLE);
    const [home, draw, away] = cells(html).map(([, cell]) => cell);
    expect(home).toMatch(
      /<span dir="ltr">46\.4%<\/span><\/span><span data-name=""[^>]*><bdi>Tractor<\/bdi>/,
    );
    expect(draw).toMatch(
      /<span dir="ltr">33\.6%<\/span><\/span><span data-name=""[^>]*><span>Draw<\/span>/,
    );
    expect(away).toMatch(
      /<span dir="ltr">20\.0%<\/span><\/span><span data-name=""[^>]*><bdi>Esteghlal<\/bdi>/,
    );
    // The last label ends where the bar ends; the others start with their segments.
    expect(away).toContain('justify-end');
    expect(home).not.toContain('justify-end');
    expect(draw).not.toContain('justify-end');
    // The names are muted, the numbers ink; the labels are for the eye only.
    expect(html).toMatch(/aria-hidden="true" class="[^"]*text-fg[^"]*tabular-nums/);
    expect(home).toContain('forecast-name text-muted');
  });

  it.each(SIZES)('never draws a segment without its number at %s size', (size) => {
    for (const labels of ['numbers', 'named'] as const) {
      const html = bar(AVAILABLE, { size, labels });
      for (const [, cell] of cells(html)) expect(cell).toMatch(/<span dir="ltr">[\d.]+%<\/span>/);
      expect(cells(html)).toHaveLength(3);
    }
  });

  it('at row size writes whole percentages that total 100, with the sign, and no names', () => {
    const html = bar(AVAILABLE, { size: 'row' });
    expect(cells(html).map(([, cell]) => /<span dir="ltr">([^<]+)</.exec(cell)?.[1])).toEqual([
      '46%',
      '34%',
      '20%',
    ]);
    expect(html).not.toContain('data-name');
    expect(html).not.toContain('<bdi>Tractor</bdi>');
    // 8px at every width: no narrower bar on a phone.
    expect(html).toMatch(/role="img"[^>]* class="flex gap-0\.5 h-2"/);
    expect(html).not.toMatch(/\bh-1\.5\b|sm:h-2/);
    expect(bar(AVAILABLE, { size: 'row', locale: 'fa' })).toContain('۴۶٪');
    // The version list's rows: the same bar with one decimal and the names.
    const named = bar(AVAILABLE, { size: 'row', labels: 'named' });
    expect(named).toContain('46.4%');
    expect(named).toContain('<bdi>Tractor</bdi>');
  });

  it('draws 12px in a card and 18px on the headline', () => {
    expect(bar(AVAILABLE)).toContain('data-size="card"');
    expect(bar(AVAILABLE)).toMatch(/role="img"[^>]* class="flex gap-0\.5 h-3"/);
    expect(bar(AVAILABLE, { size: 'headline' })).toMatch(
      /role="img"[^>]* class="flex gap-0\.5 h-4\.5"/,
    );
  });

  it('shows a name whole or not at all: no ellipsis, no break, a clipped line of its own', () => {
    for (const size of SIZES) {
      const html = bar(AVAILABLE, { size, labels: 'named', outcome: 'home' });
      expect(html).not.toMatch(/truncate|text-ellipsis|line-clamp|break-(all|words)|hyphens-/);
      expect(html).not.toContain('overflow-wrap');
      // The name is in the box the stylesheet clips, with the server's estimate of its width.
      expect(html).toMatch(
        /class="forecast-name[^"]*" style="--forecast-name:3\.3em"><bdi>Tractor/,
      );
    }
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'globals.css'),
      'utf8',
    );
    const rule = /\.forecast-name \{[\s\S]*?\n {2}\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('flex-wrap: wrap');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('max-inline-size: 100%');
    // The strut the name wraps under, and the line given up when it cannot fit.
    expect(rule).toContain("content: '\\200b'");
    expect(rule).toContain('100cqi - var(--forecast-name');
    expect(rule).not.toMatch(/text-overflow|ellipsis/);
    // Each cell is the query container its name is measured against.
    expect(bar(AVAILABLE).match(/@container/g)).toHaveLength(3);
  });

  it('keeps a cell as wide as its own number, so a tiny share never runs into its neighbour', () => {
    const html = bar(AVAILABLE, { outcome: 'away' });
    for (const [, cell] of cells(html)) expect(cell).toContain('min-width:5.5ch');
    const stress = alone({ home: 82, draw: 12, away: 6 }, { size: 'row' });
    expect(cells(stress).map(([, cell]) => /min-width:([\d.]+ch)/.exec(cell)?.[1])).toEqual([
      '3.5ch',
      '3.5ch',
      '2.5ch',
    ]);
  });

  it('names every figure for a screen reader once, in the bar’s own label', () => {
    for (const size of SIZES) {
      const html = bar(AVAILABLE, { size });
      expect(html).toContain(
        'role="img" aria-label="Model forecast: Tractor 46.4%, draw 33.6%, Esteghlal 20.0%"',
      );
      // The visible labels are hidden from it, so the figures are heard once.
      expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(1);
      expect(html.indexOf('aria-hidden="true"')).toBeLessThan(html.indexOf('data-outcome="home"'));
    }
  });

  it('always carries the receipt: model version, forecast version and computation time', () => {
    for (const size of SIZES) {
      const html = bar(AVAILABLE, { size });
      expect(html).toMatch(/data-testid="forecast-bar-meta"/);
      expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
      expect(html).toContain('<span>v3</span>');
      expect(html).toMatch(/computed <time dateTime="2026-10-11T09:30:00.000Z">11 Oct, 09:30 UTC/);
    }
    // A caller that prints the receipt itself gets the bar alone.
    expect(alone({ home: 46.4, draw: 33.6, away: 20 })).not.toContain('forecast-bar-meta');
  });

  describe('what happened', () => {
    it.each(SIZES.flatMap((size) => OUTCOMES.map((outcome) => [size, outcome] as const)))(
      'at %s size outlines the %s segment and marks its number',
      (size, outcome) => {
        const html = bar(AVAILABLE, { outcome, size, started: true });
        expect(html).toContain(`data-outcome-happened="${outcome}"`);
        for (const [key, , classes] of segments(html)) {
          if (key === outcome) {
            expect(classes).toContain('outline-2 outline-offset-1 outline-fg');
          } else expect(classes).not.toContain('outline');
        }
        // The fill is still the rank's step: what happened is a shape, not a colour.
        expect(segments(html).map(([, , classes]) => classes.split(' ')[0])).toEqual([
          'bg-model',
          'bg-model/75',
          'bg-model/50',
        ]);
        for (const [key, cell] of cells(html)) {
          if (key === outcome) {
            expect(cell).toMatch(
              /data-happened=""[\s\S]*<svg[^>]*data-icon="check"[^>]*>[\s\S]*<span dir="ltr" class="underline decoration-2 underline-offset-2 /,
            );
          } else {
            expect(cell).not.toContain('data-icon="check"');
            expect(cell).not.toContain('data-happened');
            expect(cell).not.toContain('underline');
          }
        }
        expect(html.match(/data-icon="check"/g)).toHaveLength(1);
        // A tick where the cell has room for it beside the number, an
        // underline where it has not: the cell is the query container, and
        // the room is the number and the tick as that size sets them.
        const [tick, plain] = {
          row: ['hidden @min-[2.75rem]:block', '@min-[2.75rem]:no-underline'] as const,
          card: ['hidden @min-[3.5rem]:block', '@min-[3.5rem]:no-underline'] as const,
          headline: [
            'hidden max-md:@min-[3.5rem]:block md:@min-[4.25rem]:block',
            'max-md:@min-[3.5rem]:no-underline md:@min-[4.25rem]:no-underline',
          ] as const,
        }[size];
        expect(/data-icon="check" class="([^"]*)"/.exec(html)?.[1]).toContain(tick);
        expect(html).toContain(`${plain}"`);
        // A row with names has one decimal, so its number needs the wider room.
        if (size === 'row') {
          expect(bar(AVAILABLE, { outcome, size, labels: 'named' })).toContain(
            'hidden @min-[3.5rem]:block',
          );
        }
        // The tick is decoration; the bar does not clip the outline.
        expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-icon="check"/);
        expect(html).not.toContain('overflow-hidden');
      },
    );

    it.each(OUTCOMES)('says in the accessible name that the %s outcome happened', (outcome) => {
      const said = {
        home: 'Model forecast: Tractor 46.4% (happened), draw 33.6%, Esteghlal 20.0%',
        draw: 'Model forecast: Tractor 46.4%, draw 33.6% (happened), Esteghlal 20.0%',
        away: 'Model forecast: Tractor 46.4%, draw 33.6%, Esteghlal 20.0% (happened)',
      }[outcome];
      for (const size of SIZES) {
        expect(bar(AVAILABLE, { outcome, size })).toContain(`role="img" aria-label="${said}"`);
      }
      expect(bar(AVAILABLE, { outcome, locale: 'fa' })).toMatch(/aria-label="[^"]*\(رخ داد\)/);
    });

    it('writes the word only on the headline', () => {
      const headline = bar(AVAILABLE, { outcome: 'home', size: 'headline' });
      expect(headline).toMatch(
        /<bdi>Tractor<\/bdi><span class="ms-1\.5 text-fg" data-happened-word="">· happened<\/span>/,
      );
      expect(headline.match(/data-happened-word/g)).toHaveLength(1);
      for (const size of ['row', 'card'] as const) {
        for (const labels of ['numbers', 'named'] as const) {
          const html = bar(AVAILABLE, { outcome: 'home', size, labels });
          expect(html).not.toContain('data-happened-word');
          // The word is in the accessible name and nowhere on the screen.
          expect(html.replace(/<[^>]*>/g, '')).not.toContain('happened');
          expect(html).toContain('(happened)');
        }
      }
      expect(bar(AVAILABLE, { outcome: 'draw', size: 'headline', locale: 'fa' })).toContain(
        'رخ داد',
      );
    });

    it('marks no outcome before full time', () => {
      for (const size of SIZES) {
        const html = bar(AVAILABLE, { size });
        expect(html).not.toContain('data-outcome-happened');
        expect(html).not.toContain('data-happened');
        expect(html).not.toContain('happened');
        expect(html).not.toContain('outline');
        expect(html).not.toContain('data-icon="check"');
      }
    });
  });

  it('never wears saffron, the accent or another product’s colour, at any size or outcome', () => {
    const all = SIZES.flatMap((size) => [
      bar(AVAILABLE, { size }),
      bar(AVAILABLE, { size, labels: 'named' }),
      ...OUTCOMES.map((outcome) => bar(AVAILABLE, { size, outcome })),
      ...OUTCOMES.map((outcome) => bar(AVAILABLE, { size, outcome, locale: 'fa' })),
    ]).join('');
    expect(all).not.toMatch(
      /\b(bg|text|border|outline|ring|decoration)-(accent|accent-strong|brand|live|warning|community|founder|prob-draw|prob-away)\b/,
    );
    expect(all).not.toMatch(/saffron/i);
    // And writes no colour of its own.
    expect(all).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
    for (const file of ['forecast-bar.tsx', 'forecast-receipt.tsx']) {
      const source = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), file),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, file).not.toMatch(/-(accent|brand|live|prob-draw|prob-away)\b/);
    }
  });

  it('keeps the receipt, the reasons and the sentences out of the bar’s own module', () => {
    // The scores row is drawn by the page's live view, so whatever this
    // module imports is in that page's script: it imports the drawing's
    // needs and nothing of the receipt's.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'forecast-bar.tsx'),
      'utf8',
    );
    const imports = [...source.matchAll(/^import (type )?.* from '([^']+)';$/gm)]
      .filter((m) => m[1] === undefined)
      .map((m) => m[2]);
    expect(imports.sort()).toEqual([
      '@/components/message-text',
      '@/components/ui/cx',
      '@/components/ui/icons',
      '@/i18n/locales',
      '@/lib/triple',
      '@/lib/words',
    ]);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/FORECAST_REASON_KEY|formatVersionStamp|ModelVersion|<Receipt\b/);
    expect(source).not.toMatch(/^'use client'/m);
  });

  it('says in words when there is no forecast, never an empty bar', () => {
    const none = bar({ state: 'none' });
    expect(none).toContain('data-state="none"');
    expect(none).toContain('No model forecast for this match yet.');
    expect(none).not.toContain('role="img"');
    expect(none).not.toContain('data-segment');
    expect(none).not.toContain('forecast-bar-meta');
    expect(bar({ state: 'none' }, { started: true })).toContain(
      'The model had no forecast for this match before kick-off.',
    );
    expect(
      bar({
        state: 'unavailable',
        reason: 'no_history',
        version: 2,
        computed_at: AVAILABLE.computed_at,
      }),
    ).toContain('The model gave no probabilities in version 2.');
    expect(bar({ state: 'unreachable' })).toContain('could not be loaded');
    expect(bar({ state: 'none' }, { locale: 'fa' })).toContain('مدل آماری هنوز');
    for (const size of SIZES) {
      expect(bar({ state: 'none' }, { size, outcome: 'home' })).not.toContain('data-segment');
    }
  });
});

describe('the name-or-number rule at the board’s widths (P3-2)', () => {
  // The board's own estimates: a digit of the number and a letter of the name, in px.
  const CARD = { digit: 7.6, letter: 6.7 };
  const HEADLINE = { digit: 9.6, letter: 8 };
  const lines = (
    width: number,
    shares: [number, number, number],
    names: [string, string, string],
    type = CARD,
    persian = false,
  ) =>
    shares.map((share, i) =>
      labelLines({
        cell: ((width - 4) * share) / 100,
        number: 5 * type.digit,
        name: [...(names[i] ?? '')].length * type.letter * (persian ? 0.9 : 1),
      }),
    );

  it('a card on a phone (309px) and a desktop (443px)', () => {
    // Everton 55.0 / 28.8 / 16.2: Coventry's 49px cell is too narrow for its name.
    expect(lines(309, [55, 28.8, 16.2], ['Everton', 'Draw', 'Coventry'])).toEqual([
      'one',
      'one',
      'number',
    ]);
    expect(lines(443, [55, 28.8, 16.2], ['Everton', 'Draw', 'Coventry'])).toEqual([
      'one',
      'one',
      'two',
    ]);
    // Malavan at 11%: a 34px cell, the number alone.
    expect(lines(309, [61.1, 27.9, 11], ['Sepahan', 'Draw', 'Malavan'])[2]).toBe('number');
    // A long name whole on its own line, and on one line once there is room.
    expect(lines(309, [39.2, 26.8, 34], ['Hamburg', 'Draw', 'Mönchengladbach'])).toEqual([
      'one',
      'one',
      'two',
    ]);
    expect(lines(443, [39.2, 26.8, 34], ['Hamburg', 'Draw', 'Mönchengladbach'])[2]).toBe('one');
  });

  it('the 6% stress test and a 21-letter Persian name in a 105px cell', () => {
    expect(lines(309, [82, 12, 6], ['Home team', 'Draw', 'Away team'])).toEqual([
      'one',
      'two',
      'number',
    ]);
    expect(
      lines(309, [39.2, 26.8, 34], ['هامبورگ', 'مساوی', 'بوروسیا مونشن‌گلادباخ'], CARD, true)[2],
    ).toBe('number');
  });

  it('the headline at 309px and 802px', () => {
    // Wrexham 28.6 / 22.9 / 48.5: on a phone the names go under their numbers.
    expect(lines(309, [28.6, 22.9, 48.5], ['Wrexham', 'Draw', 'Middlesbrough'], HEADLINE)).toEqual([
      'two',
      'two',
      'two',
    ]);
    expect(lines(802, [28.6, 22.9, 48.5], ['Wrexham', 'Draw', 'Middlesbrough'], HEADLINE)).toEqual([
      'one',
      'one',
      'one',
    ]);
  });

  it('never returns a cut name: the name fits whole or the number stands alone', () => {
    expect(labelLines({ cell: 100, number: 38, name: 56 })).toBe('one');
    expect(labelLines({ cell: 99.9, number: 38, name: 56 })).toBe('two');
    expect(labelLines({ cell: 56, number: 38, name: 56 })).toBe('two');
    expect(labelLines({ cell: 55.9, number: 38, name: 56 })).toBe('number');
  });

  it('estimates a name’s width letter by letter, close to what a browser measured', () => {
    // Measured in the built page at 13px (Archivo, Vazirmatn), in em.
    const measured: [string, number][] = [
      ['Everton', 3.49],
      ['Coventry', 4.04],
      ['Sepahan', 4.0],
      ['Hamburg', 4.16],
      ['Mönchengladbach', 8.26],
      ['Chadormalu', 5.5],
      ['Wrexham', 4.25],
      ['Middlesbrough', 6.63],
      ['Draw', 2.32],
      ['رکسام', 2.39],
      ['هامبورگ', 3.41],
      ['سپاهان', 3.05],
    ];
    for (const [name, em] of measured) {
      expect(Math.abs(nameEm(name) - em), name).toBeLessThan(0.35);
    }
    // Narrow and wide letters are not counted alike, and a joiner has no width.
    expect(nameEm('Illi')).toBeLessThan(nameEm('Mwmw') / 2);
    expect(nameEm('مونشن‌گلادباخ')).toBe(nameEm('مونشنگلادباخ'));
    expect(nameEm('Tractor')).toBe(3.3);
    expect(nameEm('')).toBe(0);
  });
});

describe('the ten places the model’s three probabilities are drawn', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (path: string) =>
    readFileSync(join(here, '..', path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\r\n])\s*\/\/.*/g, '$1');
  // [the place, its file, bars drawn directly, bars drawn with the receipt]
  const PLACES: [string, string, number, number][] = [
    ['1 the scores row', 'components/score-card-forecast.tsx', 1, 0],
    ['2 the scores preview', 'app/[locale]/scores/match-preview.tsx', 0, 1],
    ['3 the home hero', 'components/home-front.tsx', 0, 1],
    ['4 the next-match card', 'components/next-match-card.tsx', 0, 1],
    ['5 the story card', 'components/story-predictions.tsx', 0, 1],
    // The panel's bar, and the sentence when a moment has no forecast.
    ['6 the moments panel', 'components/moments-rail.tsx', 1, 1],
    [
      '7 and 8 the match headline and the version list',
      'app/[locale]/match/[id]/forecast-reality.tsx',
      2,
      0,
    ],
    ['9 the home upset card', 'components/home-rail.tsx', 1, 0],
    ['10 the match row', 'components/match-row.tsx', 1, 0],
  ];

  it.each(PLACES)('%s renders the one ForecastBar', (_, path, direct, withReceipt) => {
    const code = read(path);
    expect(code.match(/<ForecastBar[\s>]/g) ?? []).toHaveLength(direct);
    expect(code.match(/<ForecastBarWithReceipt[\s>]/g) ?? []).toHaveLength(withReceipt);
    if (direct > 0) {
      expect(code).toMatch(
        /import \{[^}]*\bForecastBar\b[^}]*\} from '@\/components\/forecast-bar'/,
      );
    }
    if (withReceipt > 0) {
      expect(code).toMatch(
        /import \{[^}]*\bForecastBarWithReceipt\b[^}]*\} from '@\/components\/forecast-receipt'/,
      );
    }
    // And draws no bar of its own: no segment grown by a share, no step, no retired token.
    expect(code).not.toMatch(/flexGrow/);
    expect(code).not.toMatch(/bg-model\/(75|55|50|25)|bg-prob-|data-segment/);
    expect(code).not.toMatch(/<ForecastStrip|<OutcomeBar|function OutcomeBar/);
  });

  it('draws the bar with its receipt through the same component, and no second drawing', () => {
    const code = read('components/forecast-receipt.tsx');
    expect(code).toMatch(/import \{ ForecastBar,[^}]*\} from '@\/components\/forecast-bar'/);
    expect(code.match(/<ForecastBar[\s>]/g)).toHaveLength(1);
    expect(code).not.toMatch(/flexGrow|bg-model|data-segment|role="img"/);
    // The only places a segment is drawn in the whole source tree.
    expect(read('components/forecast-bar.tsx')).toContain('data-segment={key}');
  });

  it('gives each place its size', () => {
    expect(read('components/score-card-forecast.tsx')).toContain('size="row"');
    expect(read('components/match-row.tsx')).toContain('size="row"');
    const reality = read('app/[locale]/match/[id]/forecast-reality.tsx');
    expect(reality).toContain('size="headline"');
    expect(reality).toMatch(/size="row"\s+labels="named"/);
    // The headline is the only place that size, and so the word, is used.
    for (const [, path] of PLACES) {
      if (path.endsWith('forecast-reality.tsx')) continue;
      expect(read(path)).not.toContain('size="headline"');
    }
  });

  it('retired the two tokens only the old bars used', () => {
    const tokens = readFileSync(join(here, '..', 'app', 'tokens.css'), 'utf8');
    const globals = readFileSync(join(here, '..', 'app', 'globals.css'), 'utf8');
    expect(tokens).not.toMatch(/--token-prob-(draw|away)/);
    expect(globals).not.toMatch(/prob-(draw|away)/);
  });
});
