import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchCentre } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchWords } from '@/lib/words-server';
import { MatchCentreView } from './match-centre-view';
import { ScoreBar, bandState } from './match-score-bar';

/**
 * The compact score bar and the sticky tab row (T-1742, D-363; boards P2-1a
 * and P2-1b): what the bar says in each state, in English and Persian; that
 * it is drawn from the band's own answer in the band's own render; and the
 * CSS that sticks the row and reveals the bar without a script.
 */

const KICKOFF = '2026-11-06T20:00:00.000Z';
const NOW = Date.parse('2026-11-06T20:15:00.000Z');
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({ id, name, short_name: null, code: null });
const centre = (over: Partial<MatchCentre['fixture']> = {}): MatchCentre =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'live',
      minute: 14,
      competition: { id: 'c', name: 'Brasileirão', short_name: null, country_id: null },
      season: { id: 's', label: '2026' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Palmeiras'),
      away: team('a', 'Remo'),
      scores: {
        current: { home: 2, away: 0 },
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-11-06T20:14:30.000Z',
      freshness: null,
      ...over,
    },
    timeline: { coverage: 'available', last_updated_at: null, data: [] },
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: empty,
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
  }) as MatchCentre;

const scheduled = (over: Partial<MatchCentre['fixture']> = {}) =>
  centre({
    status: 'scheduled',
    minute: null,
    home: team('h', 'Everton') as MatchCentre['fixture']['home'],
    away: team('a', 'Coventry') as MatchCentre['fixture']['away'],
    scores: { ...centre().fixture.scores, current: null },
    ...over,
  });
const finished = (over: Partial<MatchCentre['fixture']> = {}) =>
  centre({
    status: 'finished',
    minute: null,
    home: team('h', 'Wrexham') as MatchCentre['fixture']['home'],
    away: team('a', 'Middlesbrough') as MatchCentre['fixture']['away'],
    scores: { ...centre().fixture.scores, full_time: { home: 2, away: 0 } },
    ...over,
  });

function bar(
  c: MatchCentre,
  locale = 'en',
  now: number | undefined = NOW,
  hero: { awaiting?: unknown; disputed?: unknown } = {},
  stale = false,
): string {
  const words = matchWords(locale);
  const state = bandState(c.fixture, hero, { locale, timeZone: 'Europe/London', now, words });
  return renderToStaticMarkup(
    <ScoreBar fixture={c.fixture} state={state} stale={stale} locale={locale} words={words} />,
  );
}
/** The bar's words in reading order, tags dropped. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the compact score bar (T-1742)', () => {
  it('before kick-off: the kick-off time, then the sides, and never a score', () => {
    const html = bar(scheduled(), 'en', Date.parse(KICKOFF) - 3_600_000);
    expect(html).toContain('data-state="scheduled"');
    expect(text(html)).toBe('20:00 · Everton v Coventry');
    expect(html).not.toContain('data-live-badge');
    // Persian: the reader's digits and word, the sides in the same order.
    const fa = bar(scheduled(), 'fa', Date.parse(KICKOFF) - 3_600_000);
    expect(text(fa)).toBe('۲۰:۰۰ · Everton مقابل Coventry');
  });

  it('live: the score in the live colour, the live badge with the word and the minute', () => {
    const html = bar(centre());
    expect(html).toContain('data-state="live"');
    expect(text(html)).toBe('Palmeiras 2–0 Remo Live · 14′');
    expect(html).toMatch(/<span dir="ltr" class="[^"]*text-live[^"]*">2–0<\/span>/);
    expect(html).toMatch(/data-live-badge=""[^>]*>.*?live-dot/);
    // Persian: the pair isolated in the page's direction, home first (D-193).
    const fa = bar(centre(), 'fa');
    expect(text(fa)).toBe('Palmeiras ۲–۰ Remo زنده · ۱۴′');
    expect(fa).toMatch(/<span dir="rtl" class="\[unicode-bidi:isolate\][^"]*">۲–۰<\/span>/);
    // Half-time says so, as the band does.
    expect(text(bar(centre({ minute: 45, at_half_time: true })))).toBe(
      'Palmeiras 2–0 Remo Live · HT',
    );
  });

  it('finished: the result and the status word, a shoot-out beside it', () => {
    const html = bar(finished());
    expect(html).toContain('data-state="finished"');
    expect(text(html)).toBe('Wrexham 2–0 Middlesbrough FT');
    expect(html).not.toContain('text-live');
    expect(text(bar(finished(), 'fa'))).toBe('Wrexham ۲–۰ Middlesbrough پایان');
    const pens = finished({
      scores: {
        ...centre().fixture.scores,
        current: { home: 1, away: 1 },
        full_time: { home: 1, away: 1 },
        extra_time: { home: 0, away: 0 },
        penalties: { home: 6, away: 5 },
      },
    });
    expect(text(bar(pens))).toBe('Wrexham 1–1 Middlesbrough Pens 6–5');
  });

  it('a feed that is behind is amber words, never the live badge (rule 4)', () => {
    const late = NOW + 10 * 60_000;
    const html = bar(centre(), 'en', late);
    expect(html).toContain('data-state="behind"');
    expect(html).not.toContain('data-live-badge');
    expect(html).not.toContain('text-live');
    expect(html).toMatch(/text-warning[^"]*">Behind/);
  });

  it('a live stream that has broken is not called live either (rule 4)', () => {
    // The data is not yet past the live threshold, but the page's stream is
    // stale or unreachable: the band's line about it has scrolled away, so
    // the bar drops the live badge and the live colour.
    const html = bar(centre(), 'en', NOW, {}, true);
    expect(html).toContain('data-state="behind"');
    expect(html).not.toContain('data-live-badge');
    expect(html).not.toContain('text-live');
    expect(html).toContain('text-warning');
    // The same match with the stream working is live.
    expect(bar(centre(), 'en', NOW)).toContain('data-state="live"');
  });

  it('a kick-off long past with no word is not shown as a match to come', () => {
    const html = bar(scheduled({ freshness: 'awaiting_update' }), 'en', NOW, { awaiting: true });
    expect(html).toContain('data-state="scheduled"');
    expect(text(html)).toBe('Everton v Coventry Awaiting update');
    expect(html).not.toContain('20:00');
  });

  it('draws no score that was not supplied, and none as final when the goals disagree', () => {
    const none = centre({ scores: { ...centre().fixture.scores, current: null } });
    expect(text(bar(none))).toBe('Palmeiras – Remo Live · 14′');
    const off = centre({
      status: 'postponed',
      minute: null,
      scores: { ...centre().fixture.scores, current: null },
    });
    expect(text(bar(off))).toBe('Palmeiras v Remo Postponed');
    const disputed = bar(finished(), 'en', NOW, { disputed: {} });
    expect(disputed).toMatch(/class="[^"]*text-muted[^"]*">2–0</);
  });

  it('repeats the band for the eye only: hidden from assistive technology, nothing to focus', () => {
    for (const html of [bar(scheduled()), bar(centre()), bar(finished())]) {
      expect(html).toMatch(/^<div aria-hidden="true"/);
      expect(html).not.toMatch(/<a |<button|tabindex/);
      // The band's own test ids are not repeated (one score, one status).
      expect(html).not.toMatch(/data-testid="(score|match-status)"/);
      expect(html).not.toMatch(PHYSICAL);
    }
  });
});

describe('the band and the bar in one render (T-1742, rule 4)', () => {
  const view = (c: MatchCentre, now = NOW, locale = 'en') =>
    renderToStaticMarkup(
      <MatchCentreView
        words={matchWords(locale)}
        centre={c}
        timeZone="Europe/London"
        locale={locale}
        now={now}
      />,
    );
  const barOf = (html: string) => {
    const from = html.indexOf('<div aria-hidden="true"');
    return html.slice(from, html.indexOf('<nav', from));
  };

  it('a new snapshot moves both: the same score and minute in the band and the bar', () => {
    for (const c of [
      centre(),
      centre({ minute: 63, scores: { ...centre().fixture.scores, current: { home: 2, away: 1 } } }),
    ]) {
      const html = view(c);
      const { home, away } = c.fixture.scores.current!;
      expect(html).toMatch(new RegExp(`data-testid="score">${home}<span[^>]*>–</span>${away}<`));
      expect(barOf(html)).toContain(`>${home}–${away}<`);
      expect(html).toMatch(new RegExp(`data-testid="match-status">${c.fixture.minute}′<`));
      expect(text(barOf(html))).toContain(`Live · ${c.fixture.minute}′`);
    }
  });

  it('both stop calling the match live when its data is behind', () => {
    const html = view(centre(), NOW + 10 * 60_000);
    expect(html).toContain('data-testid="live-badge" data-live="false"');
    expect(html).toContain('data-testid="feed-behind"');
    expect(barOf(html)).toContain('data-state="behind"');
    expect(barOf(html)).not.toContain('data-live-badge');
  });
});

describe('the sticky stack’s CSS (T-1742)', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const from = css.indexOf("The match page's sticky stack");
  const block = css.slice(from, css.indexOf("The match page's pick bar", from));

  it('sticks the tab row at the top, and 3rem down only where the bar can show', () => {
    expect(from).toBeGreaterThan(0);
    expect(block).toMatch(/\[data-match-sticky\] \{\s*inset-block-start: 0;/);
    const supported = block.slice(block.indexOf('@supports'));
    expect(supported).toMatch(
      /^@supports \(animation-timeline: view\(\)\) and \(timeline-scope: --match-band\)/,
    );
    expect(supported).toMatch(/\[data-match-sticky\] \{\s*inset-block-start: 3rem;/);
  });

  it('keeps the bar hidden until the band’s view timeline says it has gone, with no script', () => {
    // Hidden by default: a browser without the feature never shows it.
    expect(block).toMatch(/\[data-score-bar\] \{\s*visibility: hidden;/);
    expect(block).toMatch(/\[data-match-root\] \{[^}]*timeline-scope: --match-band;/);
    expect(block).toMatch(/\[data-match-band\] \{\s*view-timeline: --match-band block;/);
    expect(block).toMatch(/animation-timeline: --match-band;/);
    // Whole from the moment the tabs stick, 3rem short of the band's end: a
    // tab's jump lands just past that point, so the bar is never left
    // half-drawn over the band's last line.
    expect(block).toMatch(
      /animation-range: exit calc\(100% - 3rem - 1px\) exit calc\(100% - 3rem\);/,
    );
    expect(block).not.toMatch(/animation-range: [^;]*exit 100%;/);
    expect(block).toMatch(/@keyframes score-bar-show \{\s*to \{\s*visibility: visible;/);
    // The fade only where motion is welcome, and over before the tabs stick.
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[^@]*:root:not\(\[data-motion='reduce'\]\) \[data-score-bar\] \{\s*animation-name: score-bar-fade;[^}]*animation-range: exit calc\(100% - 6rem\) exit calc\(100% - 3rem\);/,
    );
  });

  it('a section a tab jumps to clears the stack', () => {
    expect(block).toMatch(/\[data-match-root\] \{\s*--match-stack: 3\.25rem;/);
    expect(block).toMatch(/--match-stack: 6\.25rem;/);
    const view = readFileSync(join(__dirname, 'match-centre-view.tsx'), 'utf8');
    expect(view).not.toContain('scroll-mt-16');
    expect(view.split('scroll-mt-(--match-stack)').length - 1).toBe(2);
  });

  it('stays under the pick bar, the open Menu and the tab bar, and lets go on a short screen', () => {
    const view = readFileSync(join(__dirname, 'match-centre-view.tsx'), 'utf8');
    expect(view).toMatch(/className="sticky z-10 [^"]*" data-match-sticky=""/);
    expect(block).toMatch(
      /@media \(height < 28rem\) \{[^@]*\[data-match-sticky\] \{\s*position: static;/,
    );
  });

  it('adds no client script: the bar is plain markup in the view', () => {
    const source = readFileSync(join(__dirname, 'match-score-bar.tsx'), 'utf8');
    expect(source).not.toMatch(/^'use client'/m);
    expect(source).not.toMatch(
      /use(State|Effect|Ref|LayoutEffect)\b|addEventListener|IntersectionObserver/,
    );
  });
});
