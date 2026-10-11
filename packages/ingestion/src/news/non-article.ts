/**
 * Items a feed carries that are not articles (T-1396, D-211): a page whose
 * headline says it is a running ticker, a guide to where a match can be
 * watched or heard, or a betting offer. Each is told by words the publisher
 * put in its own headline, never by a guess about its body, so the rule is
 * one a reader can check against the headline. The job does not write such
 * an item, and the read side does not list one stored before: the same
 * function on both sides.
 */
export type NonArticleKind = 'live_ticker' | 'watch_guide' | 'betting_offer';

export interface NonArticleRule {
  kind: NonArticleKind;
  /** The pattern, for `new RegExp`. */
  pattern: string;
  /** Whether letter case is part of the rule ("LIVE", the ticker's label, not "live"). */
  caseSensitive: boolean;
}

const START = '(^|[^A-Za-z])';
const END = '([^A-Za-z]|$)';

export const NON_ARTICLE_RULES: readonly NonArticleRule[] = [
  // "Liverpool vs Manchester City LIVE: Cherki adds third", "LIVE! Arsenal v Spurs".
  { kind: 'live_ticker', pattern: `${START}LIVE${END}`, caseSensitive: true },
  // "Serie A Liveblog including ...", "Live updates: ...", "Live score, updates",
  // "Live Game Thread & Updates for ...", "... as it happened".
  {
    kind: 'live_ticker',
    pattern: `${START}(live ?blog|live updates|live score|score updates|live game thread|as it happened)${END}`,
    caseSensitive: false,
  },
  // "How to watch Liverpool v Manchester City ...", "Serie A: Where to watch Como vs. Roma
  // on TV", "... streaming and TV information for ...", "What TV channel is ...",
  // "Where to Stream ...", and the radio pages: "Listen live: ...".
  {
    kind: 'watch_guide',
    pattern: `${START}(how to watch|where to watch|where to stream|streaming and tv information|what tv channel|what channel is|listen live)${END}`,
    caseSensitive: false,
  },
  // "Best Kalshi promo code CBSSPORTS55: Earn $55 bonus ...", "... $150 bonus bets ...".
  { kind: 'betting_offer', pattern: `${START}(promo code|bonus bets)${END}`, caseSensitive: false },
];

const COMPILED = NON_ARTICLE_RULES.map((rule) => ({
  kind: rule.kind,
  re: new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i'),
}));

/** What the headline says the item is when that is not an article, or `null` for an article. */
export function nonArticleKind(headline: string): NonArticleKind | null {
  for (const rule of COMPILED) {
    if (rule.re.test(headline)) return rule.kind;
  }
  return null;
}
