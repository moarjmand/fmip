import { describe, expect, it } from 'vitest';
import {
  footballEvidence,
  GENERAL_SPORTS_FEEDS,
  isGeneralSportsFeed,
  type NewsItemSignals,
  notFootballOf,
  notFootballPageOf,
  persianOtherSportHeadline,
  sectionOf,
} from './football-only';

/**
 * T-1841 (D-429). Every headline, summary and category below is one production
 * stored in the 30 days to 2026-11-16 (summaries abridged with "..."); the
 * feeds are the sources' own.
 */
const TEHRAN_TIMES = 'https://www.tehrantimes.com/rss/tp/699';
const AGENCIA = 'https://agenciabrasil.ebc.com.br/rss/esportes/feed.xml';
const IRNA = 'https://www.irna.ir/rss/tp/15';
const KHABAR = 'https://www.khabarvarzeshi.com/rss/tp/1';
const YAHOO = 'https://sports.yahoo.com/soccer/rss/';

function item(over: Partial<NewsItemSignals> & Pick<NewsItemSignals, 'headline'>): NewsItemSignals {
  return {
    summary: null,
    categories: [],
    feedUrl: null,
    url: null,
    searched: false,
    filedTo: [],
    ...over,
  };
}

describe('isGeneralSportsFeed', () => {
  it('knows the general feeds by address, scheme, www and a trailing slash aside', () => {
    expect(isGeneralSportsFeed(TEHRAN_TIMES)).toBe(true);
    expect(isGeneralSportsFeed('http://tehrantimes.com/rss/tp/699/')).toBe(true);
    expect(isGeneralSportsFeed(AGENCIA)).toBe(true);
    expect(isGeneralSportsFeed(IRNA)).toBe(false);
    expect(isGeneralSportsFeed('https://www.tehrantimes.com/rss/tp/6990')).toBe(false);
    expect(isGeneralSportsFeed(null)).toBe(false);
    expect(GENERAL_SPORTS_FEEDS).toHaveLength(2);
  });
});

describe('sectionOf', () => {
  it('reads another sport’s section or tag as decisive', () => {
    expect(sectionOf(['منهای فوتبال > کشتی'])).toBe('other_sport');
    expect(sectionOf(['ورزش > توپ و تور'])).toBe('other_sport');
    expect(sectionOf(['ورزشهای رزمی'])).toBe('other_sport');
    expect(sectionOf(['کشتی و وزنه‌برداری'])).toBe('other_sport');
    expect(sectionOf(['tennis'])).toBe('other_sport');
    expect(sectionOf(['rugby'])).toBe('other_sport');
    expect(sectionOf(['Esportes', 'Tênis de Mesa'])).toBe('other_sport');
    expect(sectionOf(['Esportes', 'Liga Mundial de Surfe', 'Surfe'])).toBe('other_sport');
  });

  it('reads a broad section that names no sport apart', () => {
    expect(sectionOf(['ورزش > سایر حوزه ها'])).toBe('not_football');
    expect(sectionOf(['منهای فوتبال > مدیریت ورزش'])).toBe('not_football');
    expect(sectionOf(['منهای ورزش'])).toBe('not_football');
    // Arabic yeh and kaf, a ZWNJ for a space: the same section.
    expect(sectionOf(['ورزش > ساير‌حوزه ها'])).toBe('not_football');
  });

  it('leaves football’s sections and neutral ones alone', () => {
    expect(sectionOf(['ورزش > فوتبال'])).toBeNull();
    expect(sectionOf(['فوتبال > لیگ برتر ایران'])).toBeNull();
    expect(sectionOf(['Sports'])).toBeNull();
    expect(sectionOf(['Soccer'])).toBeNull();
    expect(sectionOf(['Esportes', 'Futebol Feminino', 'Brasileirão'])).toBeNull();
    // kicker's tags: clubs and players, not sports.
    expect(sectionOf(['Arda Güler', 'FC Valencia', 'Fußball'])).toBeNull();
    // Women's Super League, not the surf league: not a tag of another sport.
    expect(sectionOf(['WSL'])).toBeNull();
    expect(sectionOf([])).toBeNull();
  });
});

describe('persianOtherSportHeadline', () => {
  it('names another sport as a whole word', () => {
    expect(
      persianOtherSportHeadline(
        'پیروزی پاس گرگان مقابل فولاد مبارکه سپاهان اصفهان در لیگ برتر والیبال',
      ),
    ).toBe(true);
    expect(
      persianOtherSportHeadline('لیگ برتر بسکتبال؛ دومین باخت استقلال رقم خورد/ صدر سبز شد'),
    ).toBe(true);
    expect(
      persianOtherSportHeadline('دبل قهرمانی کشتی در جهان / پایان درخشان کشتی ایران در آمریکا'),
    ).toBe(true);
  });

  it('leaves football’s words that contain one alone', () => {
    expect(
      persianOtherSportHeadline('ویدیو| خلاصه بازی ناپولی ۴ - بوده گلیمت ۳/ فوتبال بسکتبالی جذاب'),
    ).toBe(false);
    expect(persianOtherSportHeadline('فن دو امتیازی کشتی، گل دوم استقلال را پراند')).toBe(false);
    // Review of PR #901: a coach's chess, Croatia's chequered shirts, a liver illness.
    expect(persianOtherSportHeadline('شطرنج اسکوچیچ و گل‌محمدی در دربی')).toBe(false);
    expect(persianOtherSportHeadline('شطرنجی‌پوشان در نیمه‌نهایی جام جهانی')).toBe(false);
    expect(persianOtherSportHeadline('پیشکسوت فوتبال بر اثر بیماری کبدی درگذشت')).toBe(false);
  });

  it('reads Arabic yeh and kaf as Persian', () => {
    expect(persianOtherSportHeadline('ليگ برتر واليبال؛ شهرداري اروميه')).toBe(true);
    expect(persianOtherSportHeadline('منع حضور شطرنج‌بازان اسرائيلي')).toBe(true);
    expect(
      persianOtherSportHeadline('کبودرآهنگ؛ کانون توجه کبدی ایران در مسیر رقابت‌های آسیایی'),
    ).toBe(true);
  });
});

describe('footballEvidence', () => {
  it.each([
    'Tractor beat Kheybar in 2026/27 PGPL',
    'Iran are undisputed kings of beach soccer: AFC',
    'Women’s futsal thrash Hong Kong in China tournament',
    'TEHRAN - Iranian midfielder Saman Ghoddos has announced his retirement from international football',
    'Brasil perde para o Japão com gol nos acréscimos: 3 a 2',
    'Prêmio TV Brasil Petrobras Para Elas: as melhores laterais-esquerdas',
    'Fifa abre venda de ingressos para Copa Feminina 2027 em 1º de dezembro',
    'تاج: گل‌محمدی و قلعه‌نویی بهترین انتخاب برای تیم‌های ملی فوتبال بودند',
  ])('%s says football', (text) => {
    expect(footballEvidence(text)).toBe(true);
  });

  it.each([
    'Iranian chess players win golds at Open SCO Cup',
    'Iran sends 70 athletes to Open SCO Cup',
    'Dadgar elected president of Iran’s Shooting Federation',
    'Iran’s 38th-place at Dakar 2026: a wake-up call',
    // "Golden", "goalball", "café": the words end where football's do.
    'Iranian golden boy takes the café by storm in goalball',
  ])('%s does not', (text) => {
    expect(footballEvidence(text)).toBe(false);
  });
});

describe('notFootballOf', () => {
  it('leaves out the chess story the maintainer saw on 2026-11-16, and why', () => {
    const chess = item({
      headline: 'Iranian chess players win golds at Open SCO Cup',
      summary:
        'TEHRAN – Iran’s female chess player Mobina Alinasab and her compatriot Reza Mahdavi claimed two gold medals at the Shanghai Cooperation Organisation (SCO) Open Cup in Russia on Monday.',
      categories: ['Sports'],
      feedUrl: TEHRAN_TIMES,
    });
    expect(notFootballOf(chess)).toBe('other_sport');
    // Even with no word the lists know, a general feed's item must say football.
    expect(
      notFootballOf({ ...chess, headline: 'Iran win two golds at Open SCO Cup', summary: null }),
    ).toBe('general_feed_without_football');
  });

  it('asks a general feed’s item for football’s words or a club or person of ours', () => {
    const tt = (headline: string, over: Partial<NewsItemSignals> = {}): NewsItemSignals =>
      item({ headline, categories: ['Sports'], feedUrl: TEHRAN_TIMES, ...over });
    expect(notFootballOf(tt('Iran sends 70 athletes to Open SCO Cup'))).toBe(
      'general_feed_without_football',
    );
    expect(notFootballOf(tt('Dadgar elected president of Iran’s Shooting Federation'))).toBe(
      'general_feed_without_football',
    );
    // Filed to a competition alone, from the bare word "Championship" (D-426).
    expect(
      notFootballOf(
        tt('Vafaei beats Selby at 2026 International Championship', { filedTo: ['competition'] }),
      ),
    ).toBe('general_feed_without_football');
    expect(notFootballOf(tt('Tractor beat Kheybar in 2026/27 PGPL'))).toBeNull();
    expect(
      notFootballOf(tt('Iran’s girls’ futsal secure historic berth at Youth Olympics semis')),
    ).toBeNull();
    expect(
      notFootballOf(tt('Andrej Panadic linked with Persepolis', { filedTo: ['team'] })),
    ).toBeNull();
    expect(
      notFootballOf(
        tt('Ghoddos calls time on his international duty with Iran', {
          summary:
            'TEHRAN - Iranian midfielder Saman Ghoddos has announced his retirement from international football ...',
        }),
      ),
    ).toBeNull();
    // A club or person of ours does not excuse another sport's own words.
    expect(
      notFootballOf(
        tt('Iran’s Greco-Roman team win 2026 World Championship', { filedTo: ['competition'] }),
      ),
    ).toBe('other_sport');
  });

  it('reads Agência Brasil’s other sports in Portuguese, from the headline and tags', () => {
    const ag = (
      headline: string,
      categories: string[],
      over: Partial<NewsItemSignals> = {},
    ): NewsItemSignals =>
      item({ headline, categories: ['Esportes', ...categories], feedUrl: AGENCIA, ...over });
    expect(
      notFootballOf(
        ag('Rebeca Andrade conquista o tri no Mundial de Ginástica na Holanda', ['Rebeca Andrade']),
      ),
    ).toBe('other_sport');
    expect(
      notFootballOf(
        ag('Medina vence etapa nas Filipinas e assume vice-liderança da WSL', ['Gabriel Medina']),
      ),
    ).toBe('other_sport');
    expect(
      notFootballOf(
        ag('Skatista Duda Ribeiro é prata na Olimpíada da Juventude, em Dacar', ['Prata'], {
          filedTo: ['person'],
        }),
      ),
    ).toBe('other_sport');
    expect(
      notFootballOf(ag('Brasil perde para o Japão com gol nos acréscimos: 3 a 2', ['amistoso'])),
    ).toBeNull();
    expect(
      notFootballOf(
        ag('Lucas Pinheiro abre temporada com ouro em slalom gigante na Áustria', [
          'campeão olímpico',
        ]),
      ),
    ).toBe('other_sport');
    // A dribbler's slalom in English is football's (review of PR #901, round 2).
    expect(
      notFootballOf(
        item({
          headline: 'Taremi slalom goal sends Iran top',
          categories: ['Sports'],
          feedUrl: TEHRAN_TIMES,
          filedTo: ['person'],
        }),
      ),
    ).toBeNull();
    // English WSL is the Women's Super League: only "da/na/do WSL" is surf's.
    expect(
      notFootballOf(
        item({
          headline: 'Iranian striker joins WSL side Everton',
          categories: ['Sports'],
          feedUrl: TEHRAN_TIMES,
        }),
      ),
    ).toBeNull();
  });

  it('does not read a filed general-feed item’s summary for other sports: Agência’s carry other titles', () => {
    const report = item({
      headline: 'Gol nos acréscimos assegura Flamengo na liderança do Brasileirão',
      summary:
        'A 32ª rodada do Campeonato Brasileiro chegou ao fim ... Notícias relacionadas: Harry Kane e Alexia Putellas vencem prêmio Bola de Ouro de 2026. Lucas Pinheiro abre temporada com ouro em slalom gigante na Áustria. ...',
      categories: ['Esportes', 'Brasileirão', 'Flamengo'],
      feedUrl: AGENCIA,
      filedTo: ['team'],
    });
    expect(notFootballOf(report)).toBeNull();
  });

  it('takes the publisher’s section of another sport as decisive, filed or not', () => {
    expect(
      notFootballOf(
        item({
          headline: 'پرسپولیس در لیگ دسته اول والیبال/ ویکی‌پی حامی مالی تیم شد',
          categories: ['منهای فوتبال > والیبال'],
          feedUrl: KHABAR,
          filedTo: ['team'],
        }),
      ),
    ).toBe('other_sport_event');
    expect(
      notFootballOf(
        item({
          headline: 'قهرمان پرافتخار ایران آبی‌پوش شد؛ نوروزی در استقلال',
          categories: ['منهای فوتبال > قایق‌رانی'],
          feedUrl: KHABAR,
          filedTo: ['team'],
        }),
      ),
    ).toBe('other_sport_section');
    expect(
      notFootballOf(
        item({
          headline: 'شکست یاران یخچالی در یک هشتم نهایی جام حذفی آلمان',
          categories: ['ورزش > توپ و تور'],
          feedUrl: IRNA,
          filedTo: ['competition'],
        }),
      ),
    ).toBe('other_sport_section');
    expect(
      notFootballOf(
        item({
          headline:
            'Five things we learned from the opening round of the Champions Cup as English sides struggle',
          categories: ['rugby'],
          feedUrl: YAHOO,
        }),
      ),
    ).toBe('other_sport_section');
  });

  it('keeps a broad section’s football story, and only that', () => {
    const broad = (headline: string, over: Partial<NewsItemSignals> = {}): NewsItemSignals =>
      item({ headline, categories: ['ورزش > سایر حوزه ها'], feedUrl: IRNA, ...over });
    expect(
      notFootballOf(
        broad('شنیده‌ام در فدراسیون فوتبال تخلف شده است/ عملکرد خوبی در جام جهانی نداشتیم'),
      ),
    ).toBeNull();
    expect(
      notFootballOf(
        item({
          headline: 'واکنش به شایعه دخالت وزیر ورزش در رأی بازی ملوان - تراکتور',
          categories: ['منهای فوتبال > مدیریت ورزش'],
          feedUrl: KHABAR,
          filedTo: ['team'],
        }),
      ),
    ).toBeNull();
    expect(notFootballOf(broad('دادگر رئیس فدراسیون تیراندازی شد'))).toBe('not_football_section');
    expect(notFootballOf(broad('رونمایی از ۶ نامزد انتخابات فدراسیون تیراندازی'))).toBe(
      'not_football_section',
    );
    // Filed to Esteghlal, but its own words name athletics.
    expect(
      notFootballOf(
        broad('پایان مرحله دوم لیگ دوومیدانی با صدرنشینی مردان و بانوان استقلال', {
          filedTo: ['team'],
        }),
      ),
    ).toBe('not_football_section');
  });

  it('keeps D-290’s rule for the football feeds and D-321’s for a search', () => {
    // A football feed's item filed to ours is not judged by its words...
    expect(
      notFootballOf(
        item({
          headline:
            'Manchester United Fans Throw Tennis Balls Onto Old Trafford Pitch During Roma Clash',
          categories: ['Soccer'],
          feedUrl: YAHOO,
          filedTo: ['team'],
        }),
      ),
    ).toBeNull();
    // ...one filed to none is.
    expect(
      notFootballOf(
        item({
          headline: 'Aryna Sabalenka denies claims she directed Russian insult',
          categories: [],
          feedUrl: YAHOO,
          summary: 'The WTA ...',
        }),
      ),
    ).toBe('other_sport');
    // A search's item is judged by its words, filed or not.
    expect(
      notFootballOf(
        item({
          headline: 'Uma Kashvi Becomes Youngest WPL Player',
          searched: true,
          filedTo: ['team'],
        }),
      ),
    ).toBe('other_sport');
    expect(notFootballOf(item({ headline: 'Arsenal beat Bayern', searched: true }))).toBeNull();
    // Another sport's own event, filed or not (D-426).
    expect(
      notFootballOf(
        item({ headline: '2026 Asian Women’s Handball Championship', filedTo: ['competition'] }),
      ),
    ).toBe('other_sport_event');
  });
});

/**
 * T-1874 (D-449). Every headline and address below is one production stored
 * by 2026-11-17 (a few headlines cut where the publisher's feed cut them),
 * except the three marked as written for the spec.
 */
describe('notFootballPageOf', () => {
  it.each([
    // Television and showbiz sections, whoever of football is named.
    [
      'https://www.telegraph.co.uk/tv/2026/11/16/im-a-celebrity-get-me-out-of-here-launch-show-instareview/',
      'Not even Wayne Rooney can rescue I’m A Celebrity from the TV relegation zone',
    ],
    [
      'https://www.liverpoolecho.co.uk/news/showbiz-news/reason-wayne-rooney-couldnt-visit-34913715',
      'Reason Wayne Rooney couldn’t visit Coleen during I’m A Celebrity as football legend enters jungle',
    ],
    [
      'https://www.liverpoolecho.co.uk/news/showbiz-news/jurgen-klopp-pays-bill-16-34809705',
      'Jurgen Klopp pays the bill for 16 Scousers during special night with Jamie Carragher',
    ],
    [
      'https://www.dailystar.co.uk/tv/mark-chapman-cannot-stand-colleague-37809738',
      'Mark Chapman ‘cannot stand’ colleague as real reason for ‘foul mood’ on MOTD explained',
    ],
    [
      'https://www.express.co.uk/showbiz/tv-radio/2256179/Strictly-Shaun-Wright-Phillips-dad-Ian-Wright',
      'Strictly fans baffled as Ian Wright makes appearance',
    ],
    [
      'https://www.thesun.co.uk/tvandshowbiz/41038307/brooklyn-beckham-drops-dad-david-23-trademark-cloud-sauce/',
      'Brooklyn Beckham ditches plan to trademark dad David’s shirt number for his hot sauce business amid feud',
    ],
    [
      'https://www.mirror.co.uk/3am/celebrity-news/robbie-williams-new-year-honours-37807742',
      'Robbie Williams ‘tipped for New Year’s Honour’ after ‘tax row’',
    ],
    [
      'https://www.standard.co.uk/showbiz/who-is-declan-rice-girlfriend-lauren-fryer-ballon-dor-2026-b1301917.html',
      'Who is Declan Rice’s girlfriend? Meet Lauren Fryer, the childhood sweetheart of the Arsenal player',
    ],
    [
      'https://www.ladbible.com/entertainment/tv/im-a-celeb-2026-wayne-rooney-smuggle-contraband-claim-nicky-butt-174270-20261111',
      'Wayne Rooney ‘planning on smuggling banned item’ into I’m A Celeb jungle',
    ],
    [
      'https://www.essexlive.news/news/celebs-tv/russell-brand-moved-new-jail-11242128',
      'with yoga, choir and inmate football league',
    ],
    // Culture, lifestyle, music, film, travel.
    [
      'https://www.walesonline.co.uk/lifestyle/tv/im-celebritys-aj-odudu-terrified-34897756',
      'I’m A Celebrity’s AJ Odudu ‘terrified’ as she reveals jungle phobias before show',
    ],
    [
      'https://nypost.com/2026/10/30/lifestyle/skechers-drops-limited-edition-harry-kane-collab-cleats-and-they-wont-last-long/',
      'Skechers drops limited-edition Harry Kane collab cleats',
    ],
    [
      'https://www.theguardian.com/lifeandstyle/2026/oct/11/partners-obnoxious-conduct-sons-football-matches-putting-me-off',
      'My partner’s obnoxious conduct at our sons’ football matches is putting me off him',
    ],
    [
      'https://www.independent.co.uk/life-style/jude-jobe-bellingham-age-net-worth-instagram-b3084359.html',
      'Brand Bellingham: How the Jude and Jobe took over the football and fashion scene to make millions',
    ],
    [
      'https://www.standard.co.uk/culture/music/fans-ash-northern-ireland-taiwan-australia-b1303138.html',
      'Ash shirt collaboration with Irish League team attracts fans from across the world',
    ],
    [
      'https://variety.com/2026/film/asia/soccer-drama-forza-ac-milan-alessandro-costacurta-tokyo-market-est-n8-1236930538/',
      'Soccer Drama ‘Forza’ Lands at EST N8 Ahead of Tokyo Market',
    ],
    [
      'https://www.thesun.co.uk/travel/40715736/gary-neville-hotel-review-manchester-travel/',
      'I stayed at Gary Neville’s football hotel with rooftop pitch and Manchester United themed rooms',
    ],
    // A US paper's TV section: where to stream a match, not a report.
    [
      'https://www.nj.com/tv/2026/10/how-to-watch-bayern-munich-vs-arsenal-champions-league-match-for-free.html',
      'Bayern Munich vs. Arsenal: Champions League FREE live stream (10/21)',
    ],
    [
      'https://www.techradar.com/entertainment/football/watch-arsenal-vs-everton-premier-league-2026-27-free',
      'Watch Arsenal vs Everton: Free streams & TV channels',
    ],
  ])('%s is an entertainment section', (url, headline) => {
    expect(notFootballPageOf(url, headline)).toBe('entertainment_section');
  });

  it.each([
    [
      'https://www.telegram.com/story/sports/high-school/athlete-of-the-week/2026/11/16/vote-for-the-hometeam-playoff-performer-of-the-week-presented-by-the-ymca-of-central-massachusetts/92809653007/',
      'Vote for the Hometeam Playoff Performer of the Week, presented by the YMCA of Central Massachusetts',
    ],
    [
      'https://www.pennlive.com/highschoolsports/2026/10/central-pa-soccer-top-performers-for-oct-16.html',
      'Central Pa. soccer top performers for Oct. 16',
    ],
    [
      'https://www.ydr.com/story/sports/high-school/2026/11/09/bucks-county-teams-in-piaa-state-playoffs-in-soccer-field-hockey-volleyball-cb-east/92596358007/',
      'Bucks County teams in PIAA state playoffs in soccer, field hockey',
    ],
    [
      'https://www.cincinnati.com/story/sports/high-school/kentucky-high-school/2026/10/19/northern-kentucky-boys-girls-regional-soccer-tournament-brackets/92300012007/',
      'Northern Kentucky boys, girls regional soccer tournament brackets',
    ],
    [
      'https://www.latimes.com/sports/highschool/story/2026-11-13/city-section-cross-country-produces-stories-of-a-lifetime',
      'City Section cross-country produces stories of a lifetime',
    ],
    [
      'https://www.si.com/college/virginia/virginia-women-s-soccer-shuts-out-louisville',
      'Virginia Women’s Soccer Shuts Out Louisville',
    ],
    [
      'https://www.inquirer.com/college-sports/villanova/samar-azem-womens-soccer-coach-winning-season-big-east',
      'Villanova women’s soccer continues historic run as the Big East’s ‘team to beat’',
    ],
  ])('%s is a school sport section', (url, headline) => {
    expect(notFootballPageOf(url, headline)).toBe('school_sport_section');
  });

  it('reads I’m A Celebrity in a headline outside those sections', () => {
    expect(
      notFootballPageOf(
        'https://www.manchestereveningnews.co.uk/sport/football/football-news/wayne-rooney-im-a-celeb-34850918',
        'Man United icon Wayne Rooney makes I’m A Celebrity 2026 decision as full line',
      ),
    ).toBe('tv_show');
    expect(
      notFootballPageOf(
        'https://www.walesonline.co.uk/sport/im-celeb-broadcast-delayed-itv-34914486',
        'I’m a Celeb broadcast delayed as ITV forced into schedule change',
      ),
    ).toBe('tv_show');
    expect(
      notFootballPageOf(
        'https://metro.co.uk/2026/11/10/wayne-rooneys-planning-smuggling-banned-item-im-a-celebrity-camp-says-friend-29779250/',
        "Wayne Rooney's planning on 'smuggling' banned item into I'm A Celebrity camp, says friend",
      ),
    ).toBe('tv_show');
  });

  it.each([
    // The Independent's `tv` is its video section, with its football shows.
    [
      'https://www.independent.co.uk/tv/acfc/florian-wirtz-liverpool-premier-league-b3065795.html',
      'Why Florian Wirtz is Liverpool’s biggest problem',
    ],
    [
      'https://www.independent.co.uk/tv/copa-independent/ballon-dor-award-harry-kane-lamine-yamal-b3070529.html',
      'Copa Independent | Kane v Yamal – and is the Ballon d’Or just a PR contest?',
    ],
    [
      'https://www.independent.co.uk/tv/sport/referee-51-red-cards-brazil-football-brawl-b3079326.html',
      'Referee shows 51 red cards in record-breaking football brawl',
    ],
    // Football sections, even about a footballer on the show: the slug's
    // "im-a-celeb" is the page, not a section.
    [
      'https://www.independent.co.uk/sport/football/wayne-rooney-im-a-celeb-suicide-man-united-b3086345.html',
      'Wayne Rooney says he contemplated suicide during ‘lowest point’ of Man Utd career',
    ],
    [
      'https://www.theguardian.com/football/2026/nov/11/mauricio-pochettino-football-daily-newsletter',
      'Mauricio Pochettino readies his jungle outfit for another big adventure',
    ],
    [
      'https://www.independent.co.uk/sport/football/jeff-stelling-celebrity-race-across-the-world-hartlepool-b3075949.html',
      'Hiding remotes and unplugging TVs: How Celebrity Race Across the World cut Jeff Stelling off from football',
    ],
    [
      'https://www.sportsmole.co.uk/football/man-utd/premier-league-team/feature/man-utd-liverpool-arsenal-represented-premier-league-team-of-the-week_608768.html',
      'Premier League Team of the Week: Bruno Fernandes, Dominik Szoboszlai, Liam Delap',
    ],
    [
      'https://sports.yahoo.com/articles/champions-league-player-week-132700977.html',
      '⭐️ Champions League: the player of the week is…',
    ],
    [
      'https://www.si.com/soccer/mls-goals-of-the-week-nashville-history-sergi-solans-seals-wild-card-matchday',
      'MLS Goals of the Week: Nashville Makes History, Sergi Solans Seals Wild Card',
    ],
    // Written for the spec: a section's name as the page itself is not a
    // section; no address, or one that does not parse.
    ['https://example.com/sport/football/tv', 'Arsenal beat Bayern'],
    [null, 'Arsenal beat Bayern'],
    ['not a url', 'Arsenal beat Bayern'],
  ])('%s stays', (url, headline) => {
    expect(notFootballPageOf(url, headline)).toBeNull();
  });

  it('still counts a section under the Independent’s video section', () => {
    expect(
      notFootballPageOf(
        'https://www.independent.co.uk/tv/culture/some-show-b3000000.html',
        'A football star’s new show',
      ),
    ).toBe('entertainment_section');
  });
});

describe('notFootballOf, the publisher’s page section (T-1874)', () => {
  it('decides before everything else, filed or not, from a feed or a search', () => {
    expect(
      notFootballOf(
        item({
          headline:
            'Who is Declan Rice’s girlfriend? Meet Lauren Fryer, the childhood sweetheart of the Arsenal player',
          url: 'https://www.standard.co.uk/showbiz/who-is-declan-rice-girlfriend-lauren-fryer-ballon-dor-2026-b1301917.html',
          searched: true,
          filedTo: ['team'],
        }),
      ),
    ).toBe('entertainment_section');
    expect(
      notFootballOf(
        item({
          headline:
            'Mary Earps ‘over the moon’ to reveal birth of ‘secret’ baby boy with partner Kitty Forrest',
          url: 'https://www.yahoo.com/entertainment/celebrity/articles/mary-earps-over-moon-reveal-174410045.html',
          feedUrl: YAHOO,
        }),
      ),
    ).toBe('entertainment_section');
    expect(
      notFootballOf(
        item({
          headline: 'Central Pa. soccer top performers for Oct. 16',
          url: 'https://www.pennlive.com/highschoolsports/2026/10/central-pa-soccer-top-performers-for-oct-16.html',
          searched: true,
        }),
      ),
    ).toBe('school_sport_section');
  });

  it('keeps a football report in the Independent’s video section filed to ours', () => {
    expect(
      notFootballOf(
        item({
          headline: 'Why Florian Wirtz is Liverpool’s biggest problem',
          url: 'https://www.independent.co.uk/tv/acfc/florian-wirtz-liverpool-premier-league-b3065795.html',
          filedTo: ['team'],
        }),
      ),
    ).toBeNull();
  });
});
