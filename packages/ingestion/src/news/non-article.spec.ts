import { describe, expect, it } from 'vitest';
import { NON_ARTICLE_RULES, nonArticleKind } from './non-article';

/**
 * Items that are not articles (T-1396, D-211). The headlines are as they
 * stood on the English news page of production on 2026-10-12.
 */
describe('nonArticleKind', () => {
  it.each([
    [
      'Liverpool vs Manchester City LIVE: Rayan Cherki adds third goal as City cruise to victory at Anfield',
      'live_ticker',
    ],
    ['Serie A Liveblog including Como-Roma, Sassuolo-Milan, Cagliari-Juventus', 'live_ticker'],
    ['Live updates: Kalen DeBoer speaks after Alabama’s Georgia loss', 'live_ticker'],
    ['Syracuse football at Virginia: Live score, updates', 'live_ticker'],
    ['Live Game Thread & Updates for Kansas Football vs. Utah Utes', 'live_ticker'],
    [
      'How to watch Liverpool v Manchester City as City return to action after guilty verdict',
      'watch_guide',
    ],
    ['Serie A: Where to watch Como vs. Roma on TV', 'watch_guide'],
    ['Serie A: Cagliari vs. Juventus – probable line-ups, where to watch on TV', 'watch_guide'],
    [
      'Courtwood vs Portarlington streaming and TV information for Laois Football Final',
      'watch_guide',
    ],
    ['Where to Stream Georgia vs. Alabama Football Game Online Free', 'watch_guide'],
    [
      'What TV channel is Boise State vs Fresno State football on? Streaming options, kickoff time',
      'watch_guide',
    ],
    [
      'Best Kalshi promo code CBSSPORTS55: Earn $55 bonus for Georgia-Alabama, Penn State-USC, college football',
      'betting_offer',
    ],
    [
      'Use DraftKings promo code to get $150 bonus bets by betting Georgia-Alabama, USC-Penn State, college football',
      'betting_offer',
    ],
  ])('%s is %s', (headline, kind) => {
    expect(nonArticleKind(headline)).toBe(kind);
  });

  it.each([
    // "Live" in a sentence, and words that merely contain "live".
    'College Football Week 6 Live Winners and Losers: Nebraska Can’t Capitalize on Matt Rhule’s Superpowers',
    'Liverpool counting the cost of £85m Richard Hughes transfer botch',
    'Real Madrid TV launches fresh criticism at referees as relationship reaches breaking point',
    'Oliver Glasner delivers verdict on a lively draw',
    'Chiesa earns first minutes of 2026-27 season for Liverpool in 3-0 Man City defeat',
    'Man City blow Liverpool away at Anfield – but was it all meaningless?',
  ])('%s is an article', (headline) => {
    expect(nonArticleKind(headline)).toBeNull();
  });

  it('keeps the ticker label to its capitals', () => {
    const cased = NON_ARTICLE_RULES.filter((r) => r.caseSensitive);
    expect(cased.map((r) => r.kind)).toEqual(['live_ticker']);
    expect(nonArticleKind('Arsenal v Spurs LIVE!')).toBe('live_ticker');
    expect(nonArticleKind('Arsenal v Spurs live')).toBeNull();
    expect(nonArticleKind('PROMO CODE inside')).toBe('betting_offer');
  });
});
