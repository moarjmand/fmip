import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardForecast } from '@/lib/score-card-products';
import { forecastBarWords } from '@/lib/words-server';
import { MatchRow, type MatchRowSide, type MatchRowStatus } from './match-row';

/**
 * The match row (the Design System's `MatchRow`, T-1508): status, the sides
 * stacked home first, and the score or the model's three percentages with
 * the receipt under the row, or a badge when there is no forecast.
 */

const AVAILABLE: CardForecast = {
  state: 'available',
  home: 46,
  draw: 34,
  away: 20,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-11T09:30:00.000Z',
};

const row = (
  status: MatchRowStatus,
  extra: {
    home?: Partial<MatchRowSide>;
    away?: Partial<MatchRowSide>;
    forecast?: CardForecast;
    locale?: string;
    sub?: string;
  } = {},
) => {
  const locale = extra.locale ?? 'en';
  return renderToStaticMarkup(
    <ul>
      <MatchRow
        href={`/${locale}/match/m1`}
        status={status}
        when={status === 'live' ? '67′' : status === 'ft' ? 'FT' : '20:00'}
        sub={extra.sub}
        home={{ name: 'Arsenal', score: null, ...extra.home }}
        away={{ name: 'Chelsea', score: null, ...extra.away }}
        model={
          extra.forecast === undefined
            ? undefined
            : { forecast: extra.forecast, words: forecastBarWords(locale) }
        }
        locale={locale}
        timeZone="UTC"
      />
    </ul>,
  );
};

describe('MatchRow', () => {
  it('is one link to the match centre, a 52px row, home stacked above away', () => {
    const html = row('scheduled');
    expect(html).toContain('href="/en/match/m1"');
    expect(html).toContain('min-h-13');
    expect(html).toMatch(/data-side="home".*Arsenal.*data-side="away".*Chelsea/);
    expect(html).toContain('data-testid="match-row"');
  });

  it('before kick-off shows the model’s three percentages, with the receipt under the row', () => {
    const html = row('scheduled', { forecast: AVAILABLE, sub: 'Sun' });
    expect(html).toContain('data-forecast="available"');
    expect(html).toContain('>20:00<');
    expect(html).toContain('>Sun<');
    expect(html).toMatch(/<span data-outcome="home">46.0%<\/span>/);
    expect(html).toContain('role="img" aria-label="Model forecast: Arsenal 46.0%');
    expect(html).toContain('data-testid="forecast-bar-meta"');
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).not.toContain('data-testid="match-row-score"');
  });

  it('says "No forecast" in a badge when there is none, never an empty bar', () => {
    for (const forecast of [
      { state: 'none' },
      { state: 'unavailable', reason: null, version: 2, computed_at: AVAILABLE.computed_at },
    ] as CardForecast[]) {
      const html = row('scheduled', { forecast });
      expect(html).toMatch(/data-coverage-badge="not_supplied".*No forecast/);
      expect(html).not.toContain('role="img"');
      expect(html).not.toContain('forecast-bar-meta');
    }
  });

  it('says a forecast that could not be loaded was not loaded, not that there is none', () => {
    const html = row('scheduled', { forecast: { state: 'unreachable' } });
    expect(html).toMatch(/data-coverage-badge="delayed".*Not loaded/);
    expect(html).not.toContain('No forecast');
  });

  it('claims nothing about the model where the list does not carry it', () => {
    const html = row('scheduled');
    expect(html).not.toContain('data-coverage-badge');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain('data-forecast');
  });

  it('at full time stacks the scores, the winner bold and the loser muted', () => {
    const html = row('ft', {
      home: { score: 2 },
      away: { score: 1 },
      forecast: AVAILABLE,
      sub: 'pens',
    });
    expect(html).toContain('data-testid="match-row-score"><span>2</span><span>1</span>');
    expect(html).toMatch(/font-bold" data-side="home"/);
    expect(html).toMatch(/font-medium text-muted" data-side="away"/);
    expect(html).toMatch(/text-muted" data-testid="match-row-when">FT</);
    expect(html).toContain('>pens<');
    // After kick-off the row is about the result: no forecast in it.
    expect(html).not.toContain('role="img"');
  });

  it('keeps a draw in ink, both sides alike', () => {
    const html = row('ft', { home: { score: 1 }, away: { score: 1 } });
    expect(html).not.toContain('text-muted" data-side');
    expect(html).not.toContain('font-bold" data-side');
  });

  it('writes a live minute and score in the live colour, and none rather than a 0 when unknown', () => {
    const html = row('live', { home: { score: null }, away: { score: null } });
    expect(html).toMatch(/text-live" data-testid="match-row-when">67′</);
    expect(html).toMatch(/text-live" data-testid="match-row-score"><span>–<\/span><span>–<\/span>/);
  });

  it('draws an empty circle for a crest the feed did not supply, and none where the list has no crests', () => {
    expect(row('scheduled', { home: { crest: null } })).toContain('data-crest="missing"');
    expect(row('scheduled')).not.toContain('data-crest');
  });

  it('in Persian keeps home first in the source, with Persian digits and no physical side', () => {
    const html = row('ft', { home: { score: 6 }, away: { score: 1 }, locale: 'fa' });
    expect(html).toContain('<span>۶</span><span>۱</span>');
    expect(html.indexOf('data-side="home"')).toBeLessThan(html.indexOf('data-side="away"'));
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });
});
