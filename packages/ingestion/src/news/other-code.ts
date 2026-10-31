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
 *
 * T-1669 (D-321): the other sports that share the query's competition names
 * (India's Women's Premier League and Indian Premier League in cricket, the
 * Kabaddi Champions League, the Tennis Premier League, Premier League Darts)
 * and the ones a publisher's general sports feed carries (wheelchair
 * basketball, wrestling, cycling, table tennis; in Persian too). And school and college sport (`school_sport`), the one kind that
 * counts even where the text says "soccer": a high-school girls' soccer
 * report is association football, but not the football this platform
 * covers, and the "soccer" in "Hermitage football adds girls soccer standout
 * as kicker" let a US high-school American football story through.
 */
export type OtherCode =
  | 'american_football'
  | 'gaelic_games'
  | 'australian_rules'
  | 'rugby_league'
  | 'rugby_union'
  | 'other_sport'
  | 'school_sport';

export interface OtherCodeRule {
  code: OtherCode;
  /** The pattern, for `new RegExp`. */
  pattern: string;
  /** Whether letter case is part of the rule (the acronyms). */
  caseSensitive: boolean;
  /**
   * Whether the marker counts even where the text says "soccer" (T-1669,
   * D-321): school and college sport only.
   */
  despiteSoccer?: boolean;
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
  // T-1669: and its unions and English league by name ("the WRU were in
  // negotiations with the Rugby Football Union and Gallagher Prem bosses").
  { code: 'rugby_union', pattern: words('URC|WRU|RFU'), caseSensitive: true },
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
        'rugby football union',
        'gallagher prem',
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
  // T-1669 (D-321): the leagues of other sports whose names carry the query's
  // "Premier League" or "Champions League" -- "Uma Kashvi Becomes Youngest WPL
  // Player", "Robin Uthappa ... batting coach of Mumbai Indians ahead of the
  // 2027 Indian Premier League season", "Rajasthan Rangers Ahead of Tennis
  // Premier League Season 8", "Kabaddi Champions League Season 2 auction",
  // "Premier League Darts" -- and the tours, leagues and series of other
  // sports, in capitals. Not "tennis" alone ("tennis balls" thrown on to the
  // pitch in protest), "Wimbledon" (AFC Wimbledon), "hockey" alone (Van Gaal
  // wants an ice hockey style Champions League), "boxing" (Boxing Day), "golf",
  // "chess" or "swimming", which football writing uses too.
  {
    code: 'other_sport',
    pattern: words('WPL|PKL|BCCI|T20Is?|ODIs|PDC|WTA|ATP|NBA|WNBA|NHL|MLB|PGA|LPGA|UFC|F1|MotoGP'),
    caseSensitive: true,
  },
  {
    code: 'other_sport',
    pattern: words(
      [
        "women['’]s premier league",
        'indian premier league',
        'big bash',
        'ranji trophy',
        'batting coach',
        'bowling coach',
        'wicket-?keepers?',
        'kabaddi',
        'premier league darts',
        'tennis premier league',
        'table tennis',
        'basketball',
        'baseball',
        'softball',
        'field hockey',
        'handball (teams?|championships?|federation|league)',
        'water polo',
        'badminton',
        'taekwondo',
        'karate',
        'judo(ka|kas)?',
        'wushu',
        'greco-roman',
        'freestyle wrestling',
        'wrestlers?',
        // T-1681: "Hassan Yazdani makes wrestling history" (Tehran Times). Wrestling's own
        // nouns, not the verb a football story uses ("wrestling with injuries").
        'wrestling (history|championships?|federation|medals?|team|world cup|league|titles?)',
        '(olympic|world) wrestling',
        'weight class(es)?',
        'weightlift(ing|ers?)',
        'gymnast(s|ics)?',
        'cycling',
        'cyclists?',
        'archery',
        'athletics',
        'goalball',
        'swimmers?',
        'formula (1|one)',
        'ryder cup',
        'liv golf',
      ].join('|'),
    ),
    caseSensitive: false,
  },
  // The same sports in the words of the Persian sports feeds (IRNA, Khabar
  // Varzeshi). Persian letters are outside the word boundary's Latin set, so
  // these match inside longer words too ("والیبالیست", "پاراتکواندو"); none is
  // part of a football word ("کشتی" alone is also a ship, so only wrestling's
  // own phrases; futsal and beach soccer are football's family and stay).
  // Not Portuguese: Agência Brasil's summaries carry other stories' titles
  // ("Surfe: ...", "Mundial de Ginástica") under its football reports.
  {
    code: 'other_sport',
    pattern: words(
      [
        'والیبال',
        'بسکتبال',
        'تنیس',
        'هندبال',
        'وزنه[‌ ]?برداری',
        'تکواندو',
        'کاراته',
        'جودو',
        'ووشو',
        'کشتی[‌ ]?(آزاد|فرنگی|گیر)',
        'فدراسیون کشتی',
        'بدمینتون',
        'دوچرخه[‌ ]?سوار',
        'ژیمناستیک',
        'قایقرانی',
        'شمشیربازی',
        'دوومیدانی',
        'گلبال',
        'کوراش',
        'اسکیت',
        'کریکت',
      ].join('|'),
    ),
    caseSensitive: false,
  },
  // School and college sport, whatever its code and even where the text says
  // "soccer" (T-1669, D-321, which amends D-215's round-up that stayed):
  // "High school girls soccer: Top seeds Lone Peak, Davis set for 6A final",
  // "Ocean City boys soccer holds off Lindenwold", "No. 25 Auburn ... NCAA
  // Women's Soccer RPI", "Boys Athlete of the Week". Not "academy" or "youth":
  // the clubs' own academies are football's.
  {
    code: 'school_sport',
    pattern: words('NCAA|NJCAA|NAIA|NFHS|JV'),
    caseSensitive: true,
    despiteSoccer: true,
  },
  {
    code: 'school_sport',
    pattern: words(
      [
        'high schools?',
        'hs sports',
        "(girls|boys)['’]? (soccer|volleyball|tennis|basketball)",
        'prep (roundup|sports|soccer)',
        'athletes? of (the )?week',
      ].join('|'),
    ),
    caseSensitive: false,
    despiteSoccer: true,
  },
];

const SOCCER = new RegExp(words('soccer'), 'i');

const COMPILED = OTHER_CODE_RULES.map((rule) => ({
  code: rule.code,
  despiteSoccer: rule.despiteSoccer === true,
  re: new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i'),
}));

/**
 * The other sport an item's own title and description name, or `null` when
 * they name none or say "soccer" (association football) -- except school and
 * college sport, which counts either way (T-1669, D-321).
 */
export function otherCodeOf(headline: string, summary: string | null): OtherCode | null {
  const text = `${headline}\n${summary ?? ''}`;
  const soccer = SOCCER.test(text);
  for (const rule of COMPILED) {
    if ((rule.despiteSoccer || !soccer) && rule.re.test(text)) return rule.code;
  }
  return null;
}
