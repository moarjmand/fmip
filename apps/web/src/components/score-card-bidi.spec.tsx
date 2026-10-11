import type { ScoreCard as ScoreCardData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreCard } from './score-card';
import { Score, nameIsolate, pairIsolate } from './score';
import { scoresWords } from '@/lib/words-server';

/**
 * T-1375: on a right-to-left page the home goals sit beside the home team.
 *
 * A score row is home, score, away from the inline start, so in Persian the
 * home team is on the right. The score was isolated left to right (T-153),
 * which put its first number -- the home goals -- on the left, beside the away
 * team: Sepahan 6 Fajr Sepasi 1 read as the visitors' six on /fa. The pair is
 * now one run in the page's direction. The browser's geometry is asserted by
 * `tests/e2e/journeys/rtl-content.spec.ts`; this pins the markup it rests on.
 */
const card: ScoreCardData = {
  id: '00000000-0000-4000-8000-000000001375',
  kickoff_at: '2026-10-08T15:15:00.000Z',
  status: 'finished',
  minute: null,
  competition: { id: 'c', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
  season: { id: 's', label: '2026/27' },
  stage: { id: 'st', name: 'Regular Season', kind: 'league' },
  round: 'Regular Season - 8',
  leg: null,
  home: { id: 'h', name: 'سپاهان', short_name: null, code: 'SEP' },
  away: { id: 'a', name: 'Fajr Sepasi', short_name: null, code: 'FAJ' },
  scores: {
    current: { home: 6, away: 1 },
    half_time: { home: 2, away: 1 },
    full_time: { home: 6, away: 1 },
    extra_time: null,
    penalties: null,
    aggregate: { home: 7, away: 2 },
  },
  red_cards: { home: 0, away: 0 },
  incidents: [],
  venue: null,
  coverage: 'available',
  last_updated_at: '2026-10-08T17:15:00.000Z',
  freshness: null,
  pinned: false,
};

const render = (locale: 'en' | 'fa'): string =>
  renderToStaticMarkup(
    <ul>
      <ScoreCard words={scoresWords(locale)} card={card} timeZone="UTC" locale={locale} />
    </ul>,
  );

/** The row's three parts in document order, which is their inline order. */
function rowOrder(html: string): string[] {
  return [...html.matchAll(/data-testid="(home-team|score|away-team)"/g)].map((m) => m[1]!);
}

describe('a score row in Persian (T-1375)', () => {
  const html = render('fa');

  it('lays out home, score, away from the inline start, the right in Persian', () => {
    expect(rowOrder(html)).toEqual(['home-team', 'score', 'away-team']);
  });

  it('isolates the score right to left, the home goals first, so they sit beside the home team', () => {
    const score =
      /<span dir="(\w+)" class="\[unicode-bidi:isolate\][^"]*" data-testid="score">([^<]*)</.exec(
        html,
      );
    expect(score?.[1]).toBe('rtl');
    // Home first in the document, in Persian digits: read right to left,
    // "۶ – ۱" is Sepahan's six and then Fajr Sepasi's one.
    expect(score?.[2]).toBe('۶ – ۱');
    expect(html).not.toMatch(/dir="ltr"[^>]*data-testid="score"/);
  });

  it('isolates an aggregate on the row the same way', () => {
    expect(html).toContain('⁧۷–۲⁩');
    expect(html).not.toContain('⁦۷–۲⁩');
  });
});

describe('a score row in English', () => {
  it('reads home first from the left, as before', () => {
    const html = render('en');
    expect(rowOrder(html)).toEqual(['home-team', 'score', 'away-team']);
    expect(html).toMatch(/<span dir="ltr"[^>]*data-testid="score">6 – 1</);
  });
});

describe('the score primitives', () => {
  it('isolates a pair in the page’s direction, or the inherited one without a locale', () => {
    expect(renderToStaticMarkup(<Score home={2} away={1} locale="fa" />)).toBe(
      '<span dir="rtl" class="[unicode-bidi:isolate]">۲–۱</span>',
    );
    expect(renderToStaticMarkup(<Score home={2} away={1} locale="en" />)).toBe(
      '<span dir="ltr" class="[unicode-bidi:isolate]">2–1</span>',
    );
    expect(renderToStaticMarkup(<Score home={2} away={1} />)).toBe(
      '<span class="[unicode-bidi:isolate]">2–1</span>',
    );
  });

  it('isolates a pair and a name inside a string', () => {
    expect(pairIsolate('fa', '۲–۱')).toBe('⁧۲–۱⁩');
    expect(pairIsolate('ar', '2–1')).toBe('⁧2–1⁩');
    expect(pairIsolate('en', '2–1')).toBe('⁦2–1⁩');
    expect(nameIsolate('Leeds')).toBe('⁨Leeds⁩');
  });
});
