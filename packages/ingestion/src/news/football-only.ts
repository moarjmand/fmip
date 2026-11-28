/**
 * Football only on the news pages (T-1841, D-429): the one judgement of
 * whether a stored news item is about another sport, from every signal the
 * item carries.
 *
 * Before this, the lists asked `otherCodeOf` (the item's own words) only of an
 * item filed to none of ours, and `otherSportEventOf` of every headline
 * (D-290, D-321, D-426). Three gaps let other sports through, found on
 * production's 30 days to 2026-11-16:
 *
 *   - A publisher's general sports feed (Tehran Times' "Sports", Agência
 *     Brasil's "Esportes") carries every sport, and an item there that names
 *     no sport the word lists know -- "Iranian chess players win golds at Open
 *     SCO Cup" -- passed. Such a feed's item now needs football's own words,
 *     or a club or person of ours, to be listed.
 *   - The Persian feeds file each item under the publisher's own section,
 *     «منهای فوتبال > کشتی» ("not football > wrestling"), «ورزش > سایر حوزه
 *     ها», «ورزشهای رزمی»; Yahoo Sports under "rugby" or "tennis". The section
 *     is the publisher's word for what the item is, so it decides even for an
 *     item filed to one of ours: Esteghlal's basketball team is filed to the
 *     football club by its name.
 *   - The word lists missed chess, snooker, the Asian Para Games' events and
 *     more (`OTHER_CODE_RULES`, T-1841).
 *
 * Applied on read, as D-290's rule is: nothing is deleted or migrated, and an
 * item left out by mistake comes back when the rule changes.
 *
 * T-1978 (D-468): an item GNews' search brought and the linker filed to none
 * of ours must also carry football evidence beyond one passing word
 * (`searchFootballEvidence`): the search matches the whole article, so a data
 * centre's founder "on the football field" and US politics' "global soccer"
 * came in.
 */
import { otherCodeOf, otherSportEventOf, type OtherCode } from './other-code';

/**
 * The publishers' general sports feeds we read, by address (scheme, `www.`
 * and a trailing slash aside). Each publishes no football-only feed (D-324).
 * A feed replaced by a football one leaves this list in the same change.
 */
export const GENERAL_SPORTS_FEEDS: readonly string[] = [
  'tehrantimes.com/rss/tp/699',
  'agenciabrasil.ebc.com.br/rss/esportes/feed.xml',
];

function feedKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

const GENERAL = new Set(GENERAL_SPORTS_FEEDS.map(feedKey));

/** Whether a source's feed is one of `GENERAL_SPORTS_FEEDS`. */
export function isGeneralSportsFeed(feedUrl: string | null): boolean {
  return feedUrl !== null && GENERAL.has(feedKey(feedUrl));
}

/**
 * The publishers' own sections of another sport, as a whole part of a
 * category path ("منهای فوتبال > کشتی" has two parts), compared folded
 * (`fold`). Each one seen on production: IRNA's, Khabar Varzeshi's and Mehr's
 * sections, Yahoo Sports' "rugby" and "tennis". Such a section decides,
 * whatever the item is filed to.
 */
export const OTHER_SPORT_SECTIONS: readonly string[] = [
  'توپ و تور',
  'ورزشهای رزمی',
  'ورزش‌های رزمی',
  'ورزش‌های پایه',
  'کشتی و وزنه‌برداری',
  'کشتی',
  'والیبال',
  'بسکتبال',
  'هندبال',
  'تکواندو',
  'جودو',
  'بوکس',
  'تیراندازی',
  'قایق‌رانی',
  'هنرهای رزمی ترکیبی',
  'بدنسازی و پرورش‌اندام',
  'rugby',
  'tennis',
  'golf',
  'cricket',
  'nfl',
  'nba',
  'formula 1',
  'boxing',
  'mma',
];

/**
 * The publishers' broad sections that are not football but name no sport:
 * «منهای فوتبال» ("not football"), «ورزش > سایر حوزه ها» ("other areas"),
 * «منهای ورزش» ("not sport"). Their items are mostly other sports and sport's
 * administration, but some are football's -- «واکنش به شایعه دخالت وزیر ورزش
 * در رأی بازی ملوان - تراکتور» is filed under «منهای فوتبال > مدیریت ورزش»,
 * «شنیده‌ام در فدراسیون فوتبال تخلف شده است» under «سایر حوزه ها». Such an
 * item stays only when its headline says football or it is filed to a club or
 * person of ours, and its own words name no other sport even then.
 */
export const NOT_FOOTBALL_SECTIONS: readonly string[] = [
  'منهای فوتبال',
  'منهای ورزش',
  'سایر حوزه ها',
  'سایر ورزشها',
  'سایر ورزش‌ها',
  'سبک زندگی',
];

/**
 * Agência Brasil's tags of other sports, as the start of a category ("Tênis de
 * Mesa", "Liga Mundial de Surfe" is caught by `PORTUGUESE_OTHER_SPORT`).
 */
const OTHER_SPORT_TAG =
  /^(tênis|judô|surfe?|vela|basquete|boxe|natação|ginástica|esqui|vôlei|atletismo|skate|wta|atp|billie jean king)(\s|$)/i;

/** Arabic yeh and kaf as Persian, ZWNJ and white space as one space, Latin case. */
function fold(text: string): string {
  return text
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s‌]+/g, ' ')
    .trim()
    .toLowerCase();
}

const SPORT_SECTIONS = new Set(OTHER_SPORT_SECTIONS.map(fold));
const BROAD_SECTIONS = new Set(NOT_FOOTBALL_SECTIONS.map(fold));

/**
 * What an item's categories say of it: `'other_sport'` when one is another
 * sport's section or tag, `'not_football'` when one is a broad section that is
 * not football (`NOT_FOOTBALL_SECTIONS`), else `null`.
 */
export function sectionOf(categories: readonly string[]): 'other_sport' | 'not_football' | null {
  let broad = false;
  for (const category of categories) {
    const parts = category.split('>').map(fold);
    if (parts.some((p) => SPORT_SECTIONS.has(p)) || OTHER_SPORT_TAG.test(category.trim())) {
      return 'other_sport';
    }
    if (parts.some((p) => BROAD_SECTIONS.has(p))) broad = true;
  }
  return broad ? 'not_football' : null;
}

const START = '(^|[^\\p{L}\\p{N}])';
const END = '([^\\p{L}\\p{N}]|$)';

/**
 * Other sports in Portuguese, read from a general feed's headline and
 * categories only: Agência Brasil's summaries carry other stories' titles
 * under a report (D-321), so they are not read for this. Not "remo" (Clube do
 * Remo) or "vela" alone in a headline (a candle).
 */
const PORTUGUESE_OTHER_SPORT = new RegExp(
  `${START}(tênis|judô|surfe?|surfistas?|basquete|vôlei|voleibol|handebol|natação|ginástica|esqui|skatistas?|skate|boxe|atletismo|ciclismo|canoagem|jiu-jitsu|taekwondo|paralímpic[oa]s?|xadrez|copa do mundo da vela|slalom (gigante|especial|paralelo)|(da|na|do) wsl)${END}`,
  'iu',
);

/**
 * Football's own words: the game, its bodies and competitions, its positions
 * and its scoring, in English, Portuguese and Persian. Futsal and beach soccer
 * are football's family (D-321). What a general feed's item must say, unless
 * it is filed to a club or person of ours.
 */
export const FOOTBALL_WORDS: readonly string[] = [
  'football(ers?)?',
  'soccer',
  'futsal',
  'FIFA',
  'AFC',
  'UEFA',
  'CAF',
  'CONMEBOL',
  'CONCACAF',
  'PGPL',
  'ACL( Elite| Two)?',
  'Persian Gulf Pro League',
  'pro league',
  'Azadegan',
  'Hazfi Cup',
  'Team Melli',
  'Champions League',
  'goalkeepers?',
  'goalies?',
  'strikers?',
  'midfielders?',
  'defenders?',
  'wingers?',
  'goals?',
  'penalt(y|ies)',
  "Ballon d['’]Or",
  'futebol',
  'Brasileirão',
  'Copa do Brasil',
  'Libertadores',
  'Sul-Americana',
  'Série [ABCD]',
  'CBF',
  'gols?',
  'goleadas?',
  'goleir[oa]s?',
  'atacantes?',
  'zagueir[oa]s?',
  'meio-campistas?',
  'laterais(-[a-z]+)?',
  'lateral(-[a-z]+)?',
  'artilheir[oa]s?',
  'pênaltis?',
  'Bola de Ouro',
  'Paulista( F)?( Sub-20)?',
  'Sub-1[57]',
  'Sub-20',
  'Copa( do Mundo)? Feminina',
  'Copa do Mundo de Clubes',
  'seleção (brasileira|masculina)',
  'amistosos?',
  'فوتبال',
  'فوتسال',
  'لیگ برتر',
];

const FOOTBALL = new RegExp(`${START}(${FOOTBALL_WORDS.join('|')})${END}`, 'iu');

/** Whether a text says football in its own words (`FOOTBALL_WORDS`). */
export function footballEvidence(text: string): boolean {
  return FOOTBALL.test(text);
}

/**
 * Another sport named in a Persian headline as a whole word, which decides
 * even for an item filed to one of ours: Iran's clubs run volleyball,
 * basketball and handball teams under their football names, so «پیروزی پاس
 * گرگان مقابل فولاد مبارکه سپاهان اصفهان در لیگ برتر والیبال» is filed to
 * Sepahan. A whole word only: «فوتبال بسکتبالی جذاب» ("basketball-like
 * football", a Napoli match) is football's.
 */
const PERSIAN_OTHER_SPORT_HEADLINE = new RegExp(
  `${START}(${[
    'والیبال',
    'بسکتبال',
    'هندبال',
    'تکواندو',
    'کاراته',
    'جودو',
    'ووشو',
    'بدمینتون',
    'ژیمناستیک',
    'شطرنج[‌ ]?باز(ان)?',
    '(فدراسیون|مسابقات|المپیاد|تیم ملی) شطرنج',
    'کبدی[‌ ]?کاران?',
    '(فدراسیون|لیگ|مسابقات|تیم ملی) کبدی',
    'کبدی ایران',
    'پاراآسیایی',
    'پارالمپیک',
    'کشتی[‌ ]?(آزاد|فرنگی|گیر|گیران)',
    'فرنگی[‌ ]?کاران?',
    'آزادکاران?',
    'قهرمانی کشتی',
    'کشتی ایران',
  ].join('|')})${END}`,
  'u',
);

/** Whether a Persian headline names another sport (`PERSIAN_OTHER_SPORT_HEADLINE`). */
export function persianOtherSportHeadline(headline: string): boolean {
  // Arabic yeh and kaf as Persian, as `fold` does: the publishers write both.
  return PERSIAN_OTHER_SPORT_HEADLINE.test(headline.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک'));
}

/**
 * The sections of a publisher's site that are television, showbiz, culture or
 * lifestyle (T-1874, D-449), as a whole directory of the article's URL path:
 * "liverpoolecho.co.uk/news/showbiz-news/...", "telegraph.co.uk/tv/2026/...",
 * "walesonline.co.uk/lifestyle/tv/...", "nypost.com/2026/10/30/lifestyle/...".
 * A football name in such a page's headline -- Wayne Rooney in I'm A
 * Celebrity, a player's partner on a red carpet -- does not make it football
 * news. Each one seen on production's stored URLs; none of them is a football
 * section on any of the publishers we carry, but see `VIDEO_SECTIONS`.
 */
export const ENTERTAINMENT_SECTIONS: readonly string[] = [
  'tv',
  'tv-news',
  'tv-radio',
  'tvandshowbiz',
  'showbiz',
  'showbiz-news',
  'celebrity',
  'celebrity-news',
  'celebs-tv',
  '3am',
  'entertainment',
  'entertainment-news',
  'culture',
  'lifestyle',
  'life-style',
  'lifeandstyle',
  'music',
  'film',
  'travel',
];

/**
 * A publisher whose `tv` directory is its video section, not television:
 * The Independent's "independent.co.uk/tv/" carries its football shows (Copa
 * Independent, Adam Clery's analysis) from its own football feed. Only as the
 * path's first directory: its television news, "/arts-entertainment/tv/news/",
 * still counts, and so do the sections under the video one ("/tv/culture/").
 */
export const VIDEO_SECTIONS: readonly { host: string; section: string }[] = [
  { host: 'independent.co.uk', section: 'tv' },
];

/**
 * The sections of a US publisher's site for school and college sport (T-1874,
 * D-449), which D-321 leaves out whatever the code: "telegram.com/story/
 * sports/high-school/athlete-of-the-week/...", "pennlive.com/highschoolsports/
 * ...", "si.com/college/...". A state's own high-school section
 * ("kentucky-high-school") counts too (`SCHOOL_SPORT_SECTION`).
 */
export const SCHOOL_SPORT_SECTIONS: readonly string[] = [
  'high-school',
  'high-schools',
  'highschool',
  'highschoolsports',
  'high-school-sports',
  'high-school-football',
  'varsityinsider',
  'athlete-of-the-week',
  'college',
  'college-sports',
  'college-football',
  'college_football',
  'ncaa',
  'ncaaf',
];

const ENTERTAINMENT = new Set(ENTERTAINMENT_SECTIONS);
const SCHOOL_SPORT = new Set(SCHOOL_SPORT_SECTIONS);
/** "<state>-high-school", "<area>-high-school-sports". */
const SCHOOL_SPORT_SECTION = /^[a-z]+(-[a-z]+)*-high-school(s|-sports)?$/;

/**
 * The directories of an article's URL path, folded to lower case: every part
 * but the last, which is the page itself ("/news/tv/who-im-celeb-star-34898037"
 * has "news" and "tv"; a trailing slash leaves the last part a directory, so
 * USA Today's ".../athlete-of-the-week/2026/11/16/<slug>/92809653007/" has the
 * slug too, which never equals a section name). `null` for no URL or one that
 * does not parse.
 */
function directoriesOf(url: string | null): { host: string; dirs: string[] } | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/');
  // The last part is the page ("" after a trailing slash).
  parts.pop();
  const dirs = parts
    .filter((p) => p !== '')
    .map((p) => {
      try {
        return decodeURIComponent(p).toLowerCase();
      } catch {
        return p.toLowerCase();
      }
    });
  return { host: parsed.hostname.toLowerCase().replace(/^www\./, ''), dirs };
}

/**
 * A television show's name in a headline (T-1874, D-449): a story about the
 * show, whoever of football is in it. Only the shows production carried past
 * the sections: "Man United icon Wayne Rooney makes I'm A Celebrity 2026
 * decision" was filed under the publisher's football section. Not the show's
 * second half, "Get Me Out of Here", alone: a football quote can say it.
 */
const TV_SHOW_HEADLINE = /(^|[^A-Za-z])I['’]m a celeb(rity)?([^A-Za-z]|$)/i;

/** Why a page is not football news by its address or a show's name, or `null`. */
export type NotFootballPage = 'entertainment_section' | 'school_sport_section' | 'tv_show';

/**
 * Whether the publisher's own section in an article's URL path, or a TV
 * show's name in its headline, says the page is not football news (T-1874,
 * D-449): a television, showbiz, culture or lifestyle section
 * (`ENTERTAINMENT_SECTIONS`, but not a `VIDEO_SECTIONS` directory), a school
 * or college sport section (`SCHOOL_SPORT_SECTIONS`), or I'm A Celebrity in
 * the headline. Like `sectionOf`, the publisher's section decides whatever the
 * item is filed to. The GNews job skips such an item before writing; the lists
 * leave one stored before out (`notFootballOf`).
 */
export function notFootballPageOf(url: string | null, headline: string): NotFootballPage | null {
  const page = directoriesOf(url);
  if (page !== null) {
    const video = VIDEO_SECTIONS.find(
      (v) => page.host === v.host || page.host.endsWith(`.${v.host}`),
    );
    if (page.dirs.some((d) => SCHOOL_SPORT.has(d) || SCHOOL_SPORT_SECTION.test(d))) {
      return 'school_sport_section';
    }
    if (
      page.dirs.some((d, depth) => ENTERTAINMENT.has(d) && !(depth === 0 && d === video?.section))
    ) {
      return 'entertainment_section';
    }
  }
  return TV_SHOW_HEADLINE.test(headline) ? 'tv_show' : null;
}

/**
 * The publisher's football sections (T-1978, D-468), as a whole directory of
 * the article's URL path: "yardbarker.com/soccer/articles/...",
 * "straitstimes.com/sport/football/...". The publisher's own word that the
 * page is football's, as `ENTERTAINMENT_SECTIONS` is that it is not.
 */
export const FOOTBALL_SECTIONS: readonly string[] = [
  'football',
  'soccer',
  'football-news',
  'soccer-news',
  'womens-football',
  'womens-soccer',
  'premier-league',
  'champions-league',
  'la-liga',
  'serie-a',
  'bundesliga',
  'mls',
  'nwsl',
  'efl',
  'transfer-news',
  'transfer-talk',
];

/**
 * Football's names (T-1978, D-468): the game, its bodies and its best-known
 * competitions. One in the headline, or in the page's own name in its address
 * (the slug), is enough for an item a search brought.
 */
export const FOOTBALL_NAMES: readonly string[] = [
  'football(ers?|ing)?',
  'soccer',
  'futsal',
  'FIFA',
  'UEFA',
  'CONCACAF',
  'CONMEBOL',
  'Premier League',
  'Champions League',
  'Europa League',
  'Conference League',
  'La ?Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'Eredivisie',
  'FA Cup',
  'Carabao Cup',
  "Ballon d['’]Or",
];

/**
 * Football's names written as acronyms, read in capitals only (lower case in
 * a slug): MLS, but not the real-estate "MLS®" of Canada's home-sales reports.
 */
const FOOTBALL_ACRONYMS: readonly string[] = ['MLS(?!®)', 'NWSL', 'WSL', 'EFL'];

/**
 * Football's other words (T-1978, D-468), each one signal: `FOOTBALL_WORDS`,
 * `FOOTBALL_NAMES`, more competitions, the positions, the match, the
 * calendar, the grounds and the national teams' names. Read in any case.
 */
export const FOOTBALL_TERMS: readonly string[] = [
  ...FOOTBALL_WORDS,
  ...FOOTBALL_NAMES,
  'footy',
  '(Club )?World Cup',
  "Women[’']?s Super League",
  'League (One|Two)',
  'Championship',
  'Premiership',
  'National League',
  'non-league',
  'Irish League',
  'League of Ireland',
  'Copa (América|del Rey|Libertadores)',
  'Africa Cup of Nations',
  'European Championships?',
  'Euro 20\\d\\d',
  'Nations League',
  'Gold Cup',
  'Leagues Cup',
  'MLS Cup',
  'Golden Boot',
  'Saudi Pro League',
  'A-League',
  'keepers?',
  'goalscor(er|ers|ing)',
  '(centre|center|full|left|right|wing)[- ]backs?',
  'centre-forwards?',
  'playmakers?',
  'hat-tricks?',
  'clean sheets?',
  'free-kicks?',
  'spot-kicks?',
  'offside',
  'stoppage time',
  'injury time',
  'added time',
  'own goals?',
  'equali[sz]ers?',
  '(red|yellow) cards?',
  'sent off',
  'relegat(ed|ion)',
  'transfer (window|deadline)',
  'deadline day',
  'loan (move|deal|spell)',
  'international break',
  'matchday',
  'gameweek',
  'dugout',
  'hooligans?',
  'ultras',
  'Old Trafford',
  'Anfield',
  'Stamford Bridge',
  '(Etihad|Emirates) Stadium',
  'Bernab[eé]u',
  'Camp Nou',
  'Celtic Park',
  'Ibrox',
  'Villa Park',
  'Goodison( Park)?',
  "St James['’] Park",
  'Lionesses',
  'Three Lions',
  'Socceroos',
  'Matildas',
];

/**
 * Football's words read in capitals only: acronyms, and the shapes of a
 * club's name -- "FC", "LAFC", "<Town> United" (not the United States,
 * Nations or Kingdom), The Sun's capitals ("MANCHESTER UNITED fans"),
 * "Sporting CP", "Inter Miami", "Borussia Dortmund" (not Real Estate or
 * Sporting News). The catalogue's own names are the linker's to read
 * (`news_named_entities`): an item this rule judges is one it filed to none.
 */
const FOOTBALL_CAPITALS: readonly string[] = [
  ...FOOTBALL_ACRONYMS,
  'VAR',
  'FPL',
  'USMNT',
  'USWNT',
  'AFCON',
  'FC',
  'AFC',
  'CF',
  '[A-Z]{2,4}FC',
  '(?<!The |the )[A-Z][a-z]+ (United|Utd|Albion|Rovers|Wanderers|Hotspur|Argyle)(?! (States|Nations|Kingdom|Arab|Airlines|Way|Methodist|Church|Steelworkers|Auto|Parcel|Health))',
  '(?<!THE )[A-Z]{3,} (UNITED|UTD|ALBION|ROVERS|WANDERERS|HOTSPUR)(?! (STATES|NATIONS|KINGDOM|ARAB))',
  'Man (City|U)',
  'MAN CITY',
  'Sporting CP',
  '(Real|Atl[eé]tico|Sporting|Inter|Olympique|Borussia|Dynamo|Dinamo|Deportivo) (?!(Estate|Time|World|Housewives|Life|Talk|News|ID)(?![\\p{L}\\p{N}]))[A-Z][a-z]+',
];

/**
 * Words any team sport uses (T-1978, D-468). Two of them, with one football
 * term, are enough: "Italy's national soccer team ... to be their next coach"
 * is football's; "former football manager" (a horse-racing report), "football
 * pitches" (a housing plan) and "global soccer" (US politics) are not.
 */
export const TEAM_SPORT_WORDS: readonly string[] = [
  'coach(es|ing)?',
  'managers?',
  'boss(es)?',
  'teams?',
  'teammates?',
  'squads?',
  'clubs?',
  'season',
  'match(es)?',
  'leagues?',
  'cups?',
  'title',
  'players?',
  'captain',
  'stadium',
  'transfer',
  'sacked',
  'career',
  'international',
];

const B = '(?<=^|[^\\p{L}\\p{N}])';
const A = '(?=[^\\p{L}\\p{N}]|$)';
const NAME = new RegExp(`${B}(${FOOTBALL_NAMES.join('|')})${A}`, 'iu');
const ACRONYM = new RegExp(`${B}(${FOOTBALL_ACRONYMS.join('|')})${A}`, 'u');
const SLUG_NAME = new RegExp(
  `${B}(${[...FOOTBALL_NAMES, ...FOOTBALL_ACRONYMS].join('|')})${A}`,
  'iu',
);
const TERM = new RegExp(`${B}(${FOOTBALL_TERMS.join('|')})${A}`, 'giu');
const CAPITAL = new RegExp(`${B}(${FOOTBALL_CAPITALS.join('|')})${A}`, 'gu');
const SPORT_WORD = new RegExp(`${B}(${TEAM_SPORT_WORDS.join('|')})${A}`, 'giu');
const FOOTBALL_SECTION = new Set(FOOTBALL_SECTIONS);

/**
 * One key per word, whatever its case or number: "Footballer" and "football",
 * "penalties" and "penalty", "coaches" and "coach" are one signal each.
 */
function signalKey(match: string): string {
  const k = match.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
  if (k.startsWith('football')) return 'football';
  if (k.length < 4) return k;
  if (/(ch|sh|ss)es$/.test(k)) return k.slice(0, -2);
  if (k.endsWith('ies')) return `${k.slice(0, -3)}y`;
  if (k.endsWith('s') && !k.endsWith('ss')) return k.slice(0, -1);
  return k;
}

/** The distinct signals a pattern finds in a text. */
function signals(pattern: RegExp, text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(pattern)) out.add(signalKey(m[1]!));
  return out;
}

/**
 * The page's own name in its address: the path's parts of three words or
 * more, as words ("/sport/41174008/david-beckham-man-utd-real-madrid-lugano/",
 * ".../pochettino_i_am_not_nice_and_that_doesnt_suit_me/..."). Empty for no
 * URL or one that does not parse.
 */
function slugOf(url: string | null): string {
  if (url === null) return '';
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return '';
  }
  return path
    .split('/')
    .filter((p) => p.split(/[-_]/).length >= 3)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .map((p) => p.replace(/[-_]+/g, ' '))
    .join('\n');
}

/**
 * Whether an item a search brought, and filed to none of ours, carries real
 * football evidence (T-1978, D-468) -- more than one passing football word:
 *   - a football section in the article's URL path (`FOOTBALL_SECTIONS`);
 *   - football's name in the headline or the page's slug (`FOOTBALL_NAMES`);
 *   - two distinct football terms across headline, slug and summary
 *     (`FOOTBALL_TERMS`, and in capitals the acronyms and club shapes);
 *   - or one, with two distinct words of team sport in headline and summary
 *     (`TEAM_SPORT_WORDS`).
 * GNews' search matches the whole article, so "From clearing a path for
 * teammates on the football field to ... data centres" came in; such an item
 * has one football word and no other evidence.
 */
export function searchFootballEvidence(item: {
  headline: string;
  summary: string | null;
  url: string | null;
}): boolean {
  const page = directoriesOf(item.url);
  if (page !== null && page.dirs.some((d) => FOOTBALL_SECTION.has(d))) return true;
  const slug = slugOf(item.url);
  if (NAME.test(item.headline) || ACRONYM.test(item.headline) || SLUG_NAME.test(slug)) return true;
  const own = `${item.headline}\n${item.summary ?? ''}`;
  const text = `${own}\n${slug}`;
  const football = new Set([...signals(TERM, text), ...signals(CAPITAL, text)]);
  if (football.size >= 2) return true;
  return football.size === 1 && signals(SPORT_WORD, own).size >= 2;
}

/** Why an item is not listed as football, or `null` when it is. */
export type NotFootball =
  | OtherCode
  | NotFootballPage
  | 'other_sport_event'
  | 'other_sport_section'
  | 'not_football_section'
  | 'general_feed_without_football'
  | 'search_without_football';

/** What the judgement reads of a stored item. */
export interface NewsItemSignals {
  headline: string;
  summary: string | null;
  /** The feed's own categories of the item, in its order (`article_category`). */
  categories: readonly string[];
  /** The source's feed address; `null` for a source with none. */
  feedUrl: string | null;
  /** The article's own address, for the publisher's section in its path (T-1874). */
  url: string | null;
  /** A publisher reached through a search (GNews), not its own feed. */
  searched: boolean;
  /** The kinds of ours the item is filed to (`article_entity`), any order. */
  filedTo: readonly ('team' | 'competition' | 'person' | 'fixture')[];
}

/**
 * Whether, and why, a stored news item is about another sport (T-1841,
 * D-429). In order:
 *   0. the publisher's television, showbiz, culture, lifestyle or school
 *      sport section in the article's URL path, or a TV show's name in the
 *      headline (`notFootballPageOf`, T-1874, D-449), filed or not;
 *   1. another sport's own event in the headline (`otherSportEventOf`, D-426),
 *      or another sport named in a Persian headline, filed or not;
 *   2. a category that is another sport's section or tag, filed or not;
 *   3. a broad section that is not football (`NOT_FOOTBALL_SECTIONS`), unless
 *      the headline says football or the item is filed to a club or person of
 *      ours, and its own words name no other sport;
 *   4. another sport in the item's own words (`otherCodeOf`), for an item a
 *      search brought or one filed to none of ours (D-290); and an item a
 *      search brought and filed to none of ours that carries no real football
 *      evidence (`searchFootballEvidence`, T-1978, D-468);
 *   5. a general sports feed's item (`GENERAL_SPORTS_FEEDS`): another sport in
 *      its headline, categories or -- unless filed to a club or person of ours
 *      -- summary, also in Portuguese; or no football word and no club or
 *      person of ours (a filing to a competition alone can come from a bare
 *      word, "Championship", D-426). A filed item's summary is not read for
 *      other sports: Agência Brasil's carry other stories' titles ("Notícias
 *      relacionadas: ... ATP Finals") under a football report.
 */
export function notFootballOf(item: NewsItemSignals): NotFootball | null {
  const page = notFootballPageOf(item.url, item.headline);
  if (page !== null) return page;
  if (otherSportEventOf(item.headline) || persianOtherSportHeadline(item.headline)) {
    return 'other_sport_event';
  }
  const section = sectionOf(item.categories);
  if (section === 'other_sport') return 'other_sport_section';
  const ours = item.filedTo.some((kind) => kind === 'team' || kind === 'person');
  if (section === 'not_football') {
    const football = ours || footballEvidence(item.headline);
    if (!football || otherCodeOf(item.headline, item.summary) !== null) {
      return 'not_football_section';
    }
  }
  const general = !item.searched && isGeneralSportsFeed(item.feedUrl);
  if (!general) {
    if (item.searched || item.filedTo.length === 0) {
      const code = otherCodeOf(item.headline, item.summary);
      if (code !== null) return code;
    }
    if (item.searched && item.filedTo.length === 0 && !searchFootballEvidence(item)) {
      return 'search_without_football';
    }
    return null;
  }
  const code = otherCodeOf(item.headline, ours ? null : item.summary);
  if (code !== null) return code;
  const tags = item.categories.join('\n');
  if (PORTUGUESE_OTHER_SPORT.test(`${item.headline}\n${tags}`)) return 'other_sport';
  if (ours || footballEvidence(`${item.headline}\n${item.summary ?? ''}\n${tags}`)) return null;
  return 'general_feed_without_football';
}
