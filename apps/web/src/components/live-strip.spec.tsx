import type { ScoreCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { message } from '@/i18n/messages';
import { chipState } from '@/lib/live-strip';
import { scoresWords } from '@/lib/words-server';
import { LiveStripView } from './live-strip';

/**
 * The live strip drawn (T-1381, D-199): the three chip states, each a link to
 * its match, and the Persian chip mirrored with the home goals beside the
 * home team (D-193).
 */

const NOW = Date.parse('2026-10-11T15:00:00.000Z');

function card(id: string, over: Partial<ScoreCard>): ScoreCard {
  return {
    id,
    kickoff_at: '2026-10-11T13:30:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'pgpl', name: 'Pro League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Tractor', short_name: null, code: 'TRA' },
    away: { id: 'a', name: 'Esteghlal', short_name: null, code: 'EST' },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-10-11T14:59:50.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

const goals = (home: number, away: number): ScoreCard['scores'] => ({
  current: { home, away },
  half_time: null,
  full_time: { home, away },
  extra_time: null,
  penalties: null,
  aggregate: null,
});

const CARDS = [
  card('before', {}),
  card('live', { status: 'live', minute: 78, scores: goals(1, 1) }),
  card('final', {
    status: 'finished',
    home: { id: 'h2', name: 'Sepahan', short_name: null, code: 'SEP' },
    away: { id: 'a2', name: 'Fajr', short_name: null, code: 'FAJ' },
    scores: goals(6, 1),
  }),
];

function render(locale: 'en' | 'fa', behind = false): string {
  const words = scoresWords(locale).m;
  const label = message(locale, 'shell.strip.label');
  return renderToStaticMarkup(
    <LiveStripView
      locale={locale}
      group={{
        country: null,
        competition: { id: 'pgpl', name: 'Pro League', short_name: null },
        fixtures: CARDS,
      }}
      chips={CARDS.map((c) => ({ card: c, state: chipState(c, locale, 'UTC', NOW, words) }))}
      label={{ ...label, text: label.text.replace('{competition}', 'Pro League') }}
      versus={message(locale, 'shell.strip.versus')}
      note={message(locale, 'shell.strip.behind')}
      behindAt={NOW + 120_000}
      behind={behind}
    />,
  );
}

/** One chip's markup, by its match id. */
const chip = (html: string, id: string): string =>
  new RegExp(`<a [^>]*href="/(?:en|fa)/match/${id}">[\\s\\S]*?</a>`).exec(html)?.[0] ?? '';

/** The chip's parts in document order, which is their inline order. */
const parts = (markup: string): string[] =>
  [...markup.matchAll(/data-testid="strip-(status|home|score|away)"/g)].map((m) => m[1]!);

describe('the strip', () => {
  const html = render('en');

  it('is labelled "Today · <competition>", on white in both themes', () => {
    expect(html).toContain('Today · Pro League');
    const root = /<nav[^>]*data-testid="live-strip"[^>]*>/.exec(html)?.[0] ?? '';
    expect(root).toContain('data-mode="editorial"');
    expect(root).toContain('bg-surface');
    expect(root).toContain('aria-labelledby="live-strip-label"');
  });

  it('scrolls sideways', () => {
    expect(html).toMatch(/<ul class="[^"]*overflow-x-auto[^"]*" data-testid="live-strip-chips">/);
  });

  it('links every chip to its match, 44px tall, radius 10, white', () => {
    for (const id of ['before', 'live', 'final']) {
      const markup = chip(html, id);
      expect(markup).toContain(`href="/en/match/${id}"`);
      expect(markup).toMatch(/class="[^"]*\bh-11\b[^"]*rounded-control[^"]*bg-surface/);
    }
  });

  it('says nothing is behind while it is current, and "May be behind" when it is not', () => {
    expect(html).toMatch(/data-testid="live-strip-behind" data-behind="false"><\/p>/);
    expect(render('en', true)).toContain('May be behind');
  });
});

describe('a chip before kick-off', () => {
  const markup = chip(render('en'), 'before');

  it('gives the time in Geist Mono and "v" between the names', () => {
    expect(markup).toMatch(/<time dateTime="2026-10-11T13:30:00.000Z" class="[^"]*font-mono[^"]*"/);
    expect(markup).toContain('>13:30<');
    expect(markup).toContain('>v<');
    expect(markup).not.toContain('strip-score');
    expect(parts(markup)).toEqual(['status', 'home', 'away']);
  });
});

describe('a live chip', () => {
  const markup = chip(render('en'), 'live');

  it('gives the minute in red with the live dot, and the score', () => {
    expect(markup).toContain('data-kind="live"');
    expect(markup).toMatch(/text-live[^"]*"[^>]*data-testid="strip-status"/);
    expect(markup).toContain('live-dot');
    expect(markup).toContain('78′');
    expect(parts(markup)).toEqual(['status', 'home', 'score', 'away']);
  });
});

describe('a chip at full time', () => {
  const markup = chip(render('en'), 'final');

  it('says FT, with the score', () => {
    expect(markup).toContain('>FT<');
    expect(markup).toContain('data-kind="final"');
    expect(markup).toMatch(/>6<\/b><span[^>]*>–<\/span><b[^>]*>1<\/b>/);
  });
});

describe('a chip in Persian (D-193)', () => {
  const html = render('fa');

  it('lays status, home, score, away from the inline start: the home team on the right', () => {
    expect(parts(chip(html, 'final'))).toEqual(['status', 'home', 'score', 'away']);
    expect(chip(html, 'final')).toMatch(/data-testid="strip-home">Sepahan</);
  });

  it('isolates the score right to left with the home goals first, in Persian digits', () => {
    const score =
      /<span dir="(\w+)" class="\[unicode-bidi:isolate\][^"]*" data-testid="strip-score">([\s\S]*?)<\/span><bdi/.exec(
        chip(html, 'final'),
      );
    expect(score?.[1]).toBe('rtl');
    expect(score?.[2]).toMatch(/^<b[^>]*>۶<\/b><span[^>]*>–<\/span><b[^>]*>۱<\/b>$/);
  });

  it('says پایان at full time, the kick-off in Persian digits, "–" between the names', () => {
    expect(chip(html, 'final')).toContain('>پایان<');
    const before = chip(html, 'before');
    expect(before).toContain('>۱۳:۳۰<');
    expect(before).not.toContain('font-mono');
    expect(before).toMatch(/text-caption">–</);
    expect(chip(html, 'live')).toContain('۷۸′');
  });

  it('is labelled in Persian', () => {
    expect(html).toContain('امروز · Pro League');
  });
});
