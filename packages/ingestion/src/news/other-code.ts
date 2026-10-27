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
 * as `nonArticleKind` is (D-211). A publisher's own football feed is judged
 * by it only for an item filed to no club, competition or player of ours
 * (T-1619, D-290): a piece on an owner who once played in the NFL is still
 * about his club, but a feed that slips in a rugby story names none of ours.
 */
export type OtherCode =
  | 'american_football'
  | 'gaelic_games'
  | 'australian_rules'
  | 'rugby_league'
  | 'rugby_union'
  | 'other_sport';

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

/**
 * US colleges whose football team the American press names "<college>
 * football" (T-1411, D-217), from the stored GNews items that named no other
 * code. Not a list of every college: the ones that reached us, and their
 * conference rivals in the same items.
 */
const US_COLLEGES = [
  'alabama',
  'arizona state',
  'arkansas',
  'auburn',
  'baylor',
  'boise state',
  'byu',
  'cal',
  'clemson',
  'duke',
  'florida',
  'florida state',
  'fresno state',
  'fsu',
  'georgia tech',
  'gvsu',
  'illinois',
  'indiana',
  'iowa',
  'iowa state',
  'iu',
  'kansas',
  'kansas state',
  'kentucky',
  'lsu',
  'michigan',
  'michigan state',
  'mississippi state',
  'missouri',
  'msu',
  'nebraska',
  'northwestern',
  'notre dame',
  'ohio state',
  'oklahoma',
  'oklahoma state',
  'ole miss',
  'oregon',
  'oregon ducks',
  'oregon state',
  'penn state',
  'purdue',
  'rutgers',
  'south carolina',
  'stanford',
  'syracuse',
  'tcu',
  'tennessee',
  'tennessee vols',
  'texas',
  'texas a&m',
  'texas tech',
  'ucla',
  'uconn',
  'ucf',
  'usc',
  'utah state',
  'vanderbilt',
  'virginia tech',
  'wake forest',
  'washington state',
  'west virginia',
  'wisconsin',
  'wvu',
].join('|');

/** Their teams' nicknames, matched as written (capitalised). */
const US_COLLEGE_NICKNAMES = [
  'Hawkeyes?',
  'Buckeyes',
  'Crimson Tide',
  'Longhorns',
  'Sooners',
  'Seminoles',
  'Razorbacks',
  'Tar Heels',
  'Fighting Irish',
  'Nittany Lions',
  'Cornhuskers',
  'Huskers?',
  'Jayhawks',
  'Boilermakers',
  'Hoosiers',
  'Hokies',
  'Demon Deacons',
  'Yellow Jackets',
  'Gamecocks',
  'Horned Frogs',
  'Red Raiders',
  'Sun Devils',
  'Golden Gophers',
  'Fighting Illini',
  'Scarlet Knights',
  'Wolverines',
  'Utes',
  'Vols',
].join('|');

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
  // T-1411 (D-217): a US college's name or nickname, the words that carry most
  // of the GNews items that name no other code ("Iowa Hawkeyes football is now
  // 5-1", "Florida football vs South Carolina", "Grading Penn State football").
  // A college's name counts only directly before "football" -- "Kansas State
  // football", "Indiana football's" -- since many of them are also places;
  // none here is a place or a club association football writes that way
  // (Georgia, Washington, Miami, Minnesota, Utah, Colorado, Monmouth are
  // left out: a national team, a club's city, a Welsh club).
  {
    code: 'american_football',
    pattern: words(`(${US_COLLEGES})(['’]s)? football`),
    caseSensitive: false,
  },
  // Their nicknames, written as names (capitalised), which no association
  // football club in English writing carries.
  { code: 'american_football', pattern: words(US_COLLEGE_NICKNAMES), caseSensitive: true },
  // A US school's own team ("Marshfield High football", "JV football", "prep
  // football"), and the field goal and wide receiver in capitals.
  {
    code: 'american_football',
    pattern: words('(High|JV|[Vv]arsity|[Pp]rep) [Ff]ootball|FGs?|WRs?'),
    caseSensitive: true,
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
  // T-1619 (D-290): rugby union, which a publisher's football feed carried
  // ("Ireland prop Furlong cited ... in Leinster's United Rugby Championship
  // win"). Its competitions and positions only: "rugby" alone is also a town
  // and a ball kicked into a football ground.
  { code: 'rugby_union', pattern: words('URC'), caseSensitive: true },
  {
    code: 'rugby_union',
    pattern: words(
      [
        'rugby union',
        'united rugby championship',
        'six nations',
        'premiership rugby',
        'super rugby',
        'top 14',
        'rugby championship',
        'rugby world cup',
        'fly-halfs?',
        'fly-halves',
        'scrum-halfs?',
        'scrum-halves',
        'tighthead',
        'loosehead',
        'lineouts?',
      ].join('|'),
    ),
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
