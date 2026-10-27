import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardForecast } from '@/lib/score-card-products';
import { forecastBarWords } from '@/lib/words-server';
import { ForecastBar, type Outcome } from './forecast-bar';

/**
 * The model's forecast bar (the Design System's `ForecastBar`, T-1508): the
 * labels above the bar, the receipt under it, `outcome` after full time,
 * `compact`, and a sentence for every way there can be no forecast.
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
  extra: { locale?: string; started?: boolean; outcome?: Outcome; compact?: boolean } = {},
) => {
  const locale = extra.locale ?? 'en';
  return renderToStaticMarkup(
    <ForecastBar
      forecast={forecast}
      home="Tractor"
      away="Esteghlal"
      started={extra.started}
      outcome={extra.outcome}
      compact={extra.compact}
      locale={locale}
      timeZone="UTC"
      words={forecastBarWords(locale)}
    />,
  );
};

/** The segments in document order: the reading order of the bar. */
const segments = (html: string) =>
  [...html.matchAll(/<span data-segment="(\w+)" class="([^"]*)"/g)].map((m) => [m[1], m[2]]);

describe('ForecastBar', () => {
  it('writes the three outcomes with their percentages above the bar', () => {
    const html = bar(AVAILABLE);
    expect(html).toContain('data-state="available"');
    expect(html).toContain('data-size="default"');
    expect(html).toMatch(
      /data-outcome="home" class="text-fg"><bdi>Tractor<\/bdi> <span dir="ltr">46.4%/,
    );
    expect(html).toMatch(/data-outcome="draw" class="text-muted">Draw <span dir="ltr">33.6%/);
    expect(html).toMatch(
      /data-outcome="away" class="text-fg"><bdi>Esteghlal<\/bdi> <span dir="ltr">20.0%/,
    );
    // The labels come before the bar.
    expect(html.indexOf('data-outcome="home"')).toBeLessThan(html.indexOf('role="img"'));
  });

  it('draws home in the model colour, the draw neutral and away lighter, and nothing else', () => {
    expect(segments(bar(AVAILABLE))).toEqual([
      ['home', 'bg-model'],
      ['draw', 'bg-prob-draw'],
      ['away', 'bg-prob-away'],
    ]);
    expect(bar(AVAILABLE)).not.toMatch(/bg-(community|founder|accent|brand)\b/);
  });

  it('names every figure for a screen reader in the bar’s own label', () => {
    expect(bar(AVAILABLE)).toContain(
      'role="img" aria-label="Model forecast: Tractor 46.4%, draw 33.6%, Esteghlal 20.0%"',
    );
  });

  it('always carries the receipt: model version, forecast version and computation time', () => {
    const html = bar(AVAILABLE);
    expect(html).toMatch(/data-testid="forecast-bar-meta"/);
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).toContain('<span>v3</span>');
    expect(html).toMatch(/computed <time dateTime="2026-10-11T09:30:00.000Z">11 Oct, 09:30 UTC/);
    // And in compact, where the labels go.
    expect(bar(AVAILABLE, { compact: true })).toContain('data-testid="forecast-bar-meta"');
  });

  it.each(['home', 'draw', 'away'] as const)(
    'after full time turns the %s segment saffron and says it happened',
    (outcome) => {
      const html = bar(AVAILABLE, { outcome, started: true });
      expect(html).toContain(`data-outcome-happened="${outcome}"`);
      for (const [key, fill] of segments(html)) {
        if (key === outcome) expect(fill).toBe('bg-brand');
        else expect(fill).not.toBe('bg-brand');
      }
      expect(html).toMatch(
        new RegExp(`data-outcome="${outcome}" class="text-accent">.*? · happened</span>`),
      );
      expect(html.match(/ · happened/g)).toHaveLength(1);
    },
  );

  it('marks no outcome before full time', () => {
    const html = bar(AVAILABLE);
    expect(html).not.toContain('data-outcome-happened');
    expect(html).not.toContain('happened');
    expect(html).not.toContain('bg-brand');
  });

  it('in compact drops the labels and prints the three numbers under a thin bar', () => {
    const html = bar(AVAILABLE, { compact: true });
    expect(html).toContain('data-size="compact"');
    expect(html).not.toContain('<bdi>Tractor</bdi>');
    expect(html).toContain('h-2');
    expect(html).toMatch(
      /aria-hidden="true" class="[^"]*font-mono[^"]*text-model[^"]*"><span data-outcome="home">46.4%<\/span><span data-outcome="draw">33.6%<\/span><span data-outcome="away">20.0%/,
    );
    expect(html.indexOf('role="img"')).toBeLessThan(html.indexOf('data-outcome="home"'));
  });

  it('keeps home first in the source, so a right-to-left page puts it on the right, in Persian digits', () => {
    const html = bar(AVAILABLE, { locale: 'fa' });
    expect(segments(html).map(([key]) => key)).toEqual(['home', 'draw', 'away']);
    expect(html).toContain('۴۶٫۴٪');
    expect(html).toContain('محاسبه‌شده');
    expect(html).toContain('نسخه ۳');
    // The model id stays a left-to-right island inside Persian.
    expect(html).toContain('<span dir="ltr">dixon-coles-elo<span>@</span>0.6.0</span>');
    // Nothing physical: the direction does the mirroring (rule 7).
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });

  it('says in words when there is no forecast, never an empty bar', () => {
    const none = bar({ state: 'none' });
    expect(none).toContain('data-state="none"');
    expect(none).toContain('No model forecast for this match yet.');
    expect(none).not.toContain('role="img"');
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
  });

  it('writes no colour of its own', () => {
    const html = bar(AVAILABLE) + bar(AVAILABLE, { compact: true, outcome: 'draw' });
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });
});
