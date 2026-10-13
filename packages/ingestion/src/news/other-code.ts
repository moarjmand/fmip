/**
 * Items about another sport that shares the word "football" (T-1400, D-215).
 *
 * GNews is a search: an item reaches us because its title or description
 * carries one of the query's words, and "football" is also the word for
 * American, Canadian, Gaelic and Australian football, while "Premier League"
 * and "Champions League" also name cricket, handball and volleyball
 * competitions. This says which other code an item's own words name, or
 * `null` when they name none -- read from the publisher's title and
 * description only, never guessed from the publisher's country.
 *
 * Two rules keep it honest:
 *   - Each marker is a word or phrase that association football writing does
 *     not use: "touchdown", "quarterback", "NFL", "GAA", "hurling", "AFL",
 *     "wicket". Words both codes use ("interception", "overtime", "punt",
 *     "fantasy football", "Monday Night Football", which is also Sky's
 *     Premier League slot) are not markers. Acronyms match in capitals only
 *     ("SEC", "TD", "QB"), so an ordinary word never trips them.
 *   - An item that says "soccer" anywhere is association football, whatever
 *     else it mentions: a high-school sports round-up that lists the soccer
 *     results stays.
 *
 * The GNews job does not write such an item, and the news lists do not show
 * one stored before from a search source: the same function on both sides,
 * as `nonArticleKind` is (D-211). A publisher's own football feed is not
 * judged by it: a feed the publisher files as football is football, and a
 * piece on an owner who once played in the NFL is still about his club.
 */
export type OtherCode =
  'american_football' | 'gaelic_games' | 'australian_rules' | 'rugby_league' | 'other_sport';

export interface OtherCodeRule {
  code: OtherCode;
  /** The pattern, for `new RegExp`. */
  pattern: string;
  /** Whether letter case is part of the rule (the acronyms). */
  caseSensitive: boolean;
}

const START = '(^|[^A-Za-z0-9])';
const END = '([^A-Za-z0-9]|$)';
const words = (alternatives: string): string => `${START}(${alternatives})${END}`;

export const OTHER_CODE_RULES: readonly OtherCodeRule[] = [
  // "Bills rule out Ed Oliver ...", "Kansas football vs Utah", "OHSAA Division III playoffs".
  {
    code: 'american_football',
    pattern: words('NFL|NCAA|NCAAF|FBS|FCS|CFP|CFL|XFL|UFL|SEC|ACC|TDs?|QBs?|SNF|TNF'),
    caseSensitive: true,
  },
  {
    code: 'american_football',
    pattern: words(
      [
        'super bowl',
        'heisman',
        'touchdowns?',
        'quarterbacks?',
        'running backs?',
        'wide receivers?',
        'linebackers?',
        'tight ends?',
        'field goals?',
        'gridiron',
        'college football',
        'high school football',
        'hs football',
        'flag football',
        'friday night football',
        'football friday',
        'friday night lights',
        'big ten',
        'big 12',
        'pac-12',
        'bowl game',
        'rushing yards',
        'passing yards',
        'sunday night football',
        'thursday night football',
        'grey cup',
      ].join('|'),
    ),
    caseSensitive: false,
  },
  // "Nemo Rangers v Carrigaline ... Cork Senior Football Championship semi".
  { code: 'gaelic_games', pattern: words('GAA|LGFA'), caseSensitive: true },
  {
    code: 'gaelic_games',
    pattern: words(
      [
        'gaelic',
        'hurling',
        'hurlers?',
        'camogie',
        'all-ireland',
        'croke park',
        'sam maguire',
        'ladies football',
        'county finals?',
        '(senior|intermediate|junior) (football|hurling) (championship|final)s?',
      ].join('|'),
    ),
    caseSensitive: false,
  },
  { code: 'australian_rules', pattern: words('AFL|AFLW|VFL|WAFL|SANFL'), caseSensitive: true },
  {
    code: 'australian_rules',
    pattern: words('brownlow|aussie rules|australian rules'),
    caseSensitive: false,
  },
  { code: 'rugby_league', pattern: words('NRL'), caseSensitive: true },
  {
    code: 'rugby_league',
    pattern: words('rugby league|super league grand final'),
    caseSensitive: false,
  },
  // The competition names the query uses are also cricket's, handball's and
  // volleyball's: "Indian Premier League", "EHF Champions League". Not
  // "handball": association football's own word for the foul.
  { code: 'other_sport', pattern: words('IPL|EHF|T20|ODI'), caseSensitive: true },
  {
    code: 'other_sport',
    pattern: words('cricket|wickets?|volleyball|netball'),
    caseSensitive: false,
  },
];

const SOCCER = new RegExp(words('soccer'), 'i');

const COMPILED = OTHER_CODE_RULES.map((rule) => ({
  code: rule.code,
  re: new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i'),
}));

/**
 * The other sport an item's own title and description name, or `null` when
 * they name none or say "soccer" (association football).
 */
export function otherCodeOf(headline: string, summary: string | null): OtherCode | null {
  const text = `${headline}\n${summary ?? ''}`;
  if (SOCCER.test(text)) return null;
  for (const rule of COMPILED) {
    if (rule.re.test(text)) return rule.code;
  }
  return null;
}
