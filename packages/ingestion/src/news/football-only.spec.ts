import { describe, expect, it } from 'vitest';
import {
  footballEvidence,
  GENERAL_SPORTS_FEEDS,
  isGeneralSportsFeed,
  type NewsItemSignals,
  notFootballOf,
  notFootballPageOf,
  persianOtherSportHeadline,
  searchFootballEvidence,
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
    // (Filed, as the linker files these names: one filed to none needs
    // football's evidence too, T-1978.)
    expect(
      notFootballOf(item({ headline: 'Arsenal beat Bayern', searched: true, filedTo: ['team'] })),
    ).toBeNull();
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

  it('exempts the Independent’s video section only as the first directory', () => {
    // Written for the spec (review of PR #934): a section under the video one,
    // and the Independent's television news, where `tv` is not the first.
    expect(
      notFootballPageOf(
        'https://www.independent.co.uk/tv/culture/some-show-b3000000.html',
        'A football star’s new show',
      ),
    ).toBe('entertainment_section');
    expect(
      notFootballPageOf(
        'https://www.independent.co.uk/arts-entertainment/tv/news/rooney-jungle-b3000001.html',
        'Wayne Rooney enters the jungle',
      ),
    ).toBe('entertainment_section');
    // Another publisher's first-level `tv` is not exempt.
    expect(
      notFootballPageOf(
        'https://notindependent.co.uk/tv/acfc/some-show-b3000002.html',
        'Why Florian Wirtz is Liverpool’s biggest problem',
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

/**
 * T-1978 (D-468). Every headline, summary and address below is one production
 * stored from GNews' search in the 30 days to 2026-11-28 and filed to none of
 * ours (summaries cut with "..." where the cut keeps the verdict), except the
 * ones marked as written for the spec. The daily team found the first two on
 * /en/news (aud-2026-11-28-01, qa-2026-11-28-01).
 */
describe('notFootballOf, a search’s item filed to none of ours (T-1978)', () => {
  const searched = (headline: string, summary: string, url: string): NewsItemSignals =>
    item({ headline, summary, url, searched: true });

  it.each([
    [
      'Building Beyond the Boom: Dave Sabey on the Future of Data Centers',
      'From clearing a path for teammates on the football field to spending more than 50 years building the infrastructure ...',
      'https://techbullion.com/building-beyond-the-boom-dave-sabey-on-the-future-of-data-centers/',
    ],
    [
      '5 High-Profile Trump Allies Facing Scrutiny From Democrats',
      'New congressional powers could force testimony on questions involving tech, finance, immigration and global soccer.',
      'https://www.newsweek.com/high-profile-trump-allies-facing-democrats-12773789',
    ],
    [
      'Who’s in charge of NYC while Mamdani goes under knife? Mayor to miss postponed Macy’s parade for surgery on sport injury',
      'A SOCCER injury has forced Zohran Mamdani to temporarily hand over his duties as he prepares to undergo his first-ever ...',
      'https://www.the-sun.com/news/17367028/nyc-zohran-mamdani-undergo-surgery-achilles-tendon/',
    ],
    [
      "Leicestershire village could become 'giant town' as 5,000-home plan takes a step forward",
      'Hundreds of football pitches could be built on in Stoney Stanton after Blaby District Council voted to send a local ...',
      'https://www.leicestermercury.co.uk/news/local-news/leicestershire-village-could-become-giant-11257231',
    ],
    [
      'Huge solar farm on County Durham border refused by council',
      'Neighbours cheered as plans for a huge solar farm spanning an area greater than 165 football pitches on the County ...',
      'https://www.thenorthernecho.co.uk/news/26766948.huge-solar-farm-county-durham-border-refused-council/',
    ],
    [
      'Ex-Tory leader Douglas Ross caught parking on double yellow lines in Glasgow',
      'The football linesman was spotted on the no-parking spot outside the Grand Central Hotel in the city centre.',
      'https://www.dailyrecord.co.uk/news/scottish-news/ex-tory-leader-douglas-ross-37920555',
    ],
    [
      'Harry Redknapp’s big-race hope Taurus Bay follows in hoofprints of Jukebox Man',
      'Newbury winner is victorious for former football manager in same race as last year’s King George VI Chase hero',
      'https://www.theguardian.com/sport/2026/nov/27/harry-redknapp-taurus-bay-follows-in-hoofprints-jukebox-man-horse-racing-tips',
    ],
    [
      "Japan's data centre boom faces growing revolt from urban residents",
      "KASHIWA, Japan, Nov 26 - Until a few years ago, Susumu Goto's house in Kashiwa, northeast of Tokyo, looked out on a ...",
      'https://www.marketscreener.com/news/japan-s-data-centre-boom-faces-growing-revolt-from-urban-residents-ce7851d8dd8cf222',
    ],
    [
      'The Norfolk locals fighting plans for a giant data centre. ‘We are facing an existential threat’',
      'The Longmarsh Green Energy project would cover nearly 4,700 acres of farmland – an area larger than 2,600 football pitches',
      'https://www.independent.co.uk/news/uk/home-news/norfolk-data-centre-longmarsh-energy-project-b3076419.html',
    ],
    [
      'Step forward for major Digbeth project aimed at transforming area',
      'The next phase of the Warwick Bar project will see brownfield land the size of 11 football pitches redeveloped',
      'https://www.birminghammail.co.uk/news/midlands-news/step-forward-major-digbeth-project-34941250',
    ],
    [
      "Lloyds, NatWest and First Direct customers can get up to £210 before Christmas if they 'act quickly'",
      "A BBC financial expert has told people to stop making a common mistake telling them 'banks are not football teams'",
      'https://www.somersetlive.co.uk/news/cost-of-living/lloyds-natwest-first-direct-customers-11243084',
    ],
    [
      "Russell Brand 'moved to new downgraded prison' offering up yoga classes to inmates",
      "Disgraced comedian Russell Brand has reportedly been moved to a 'cushy' category C prison, HMP Littlehey in ...",
      'https://www.dailystar.co.uk/news/latest-news/russell-brand-moved-new-downgraded-37878521',
    ],
    [
      'Kanye West Announces New Show In Mexico',
      "Kanye West is going to be performing at the Azteca in Mexico, which is the country's biggest and most beautiful soccer stadium.",
      'https://www.hotnewhiphop.com/1015551-kanye-west-mexico-concert',
    ],
    [
      "Inside New Tashkent, Uzbekistan's planned city for two million people",
      'Nearly 7,000 apartments are complete, three ministries already operate there and university facilities have opened. ...',
      'https://www.euronews.com/2026/11/05/inside-new-tashkent-uzbekistans-planned-city-for-two-million-people',
    ],
    [
      "He Fought France's Far Right for Half a Century. Now Melenchon's Presidential Bid May Hand It Power",
      'LE BOURGET, France (AP) — Young supporters wore his name on their backs like a soccer star’s, above the number 27. They ...',
      'https://www.usnews.com/news/world/articles/2026-11-09/he-fought-frances-far-right-for-half-a-century-now-melenchons-presidential-bid-may-hand-it-power',
    ],
    [
      'How Driver Fatigue Contributes to Commercial Truck Accidents',
      "That's a micro-sleep. Short little blackout where the brain clocks out even though the eyes stay open. Doesn't sound ...",
      'https://techbullion.com/how-driver-fatigue-contributes-to-commercial-truck-accidents/',
    ],
    [
      "King accepts 'positive potato' but turns down beans and cheese from Spud Bros on royal visit",
      'He declined the offer of a potato with cheese and beans but was gifted a signed shirt from football team Preston North End',
      'https://www.lbc.co.uk/article/king-preston-spud-bros-5HjdmQR_2/',
    ],
    [
      'Canadian Home Sales and Prices Hold Steady in October',
      'OTTAWA, Ontario, Nov. 17, 2026 (GLOBE NEWSWIRE) -- The number of home sales recorded over Canadian MLS® Systems edged ...',
      'https://www.brantfordexpositor.ca/press-releases/globe-newswire/canadian-home-sales-and-prices-hold-steady-in-october/',
    ],
    [
      'Train attack victim said knifeman was ‘on a mission’, court hears',
      "The football supporter said he felt 'confident' to fight back - but he 'came out wounded because he had a knife'",
      'https://www.cambridge-news.co.uk/news/local-news/train-attack-victim-said-knifeman-34867839',
    ],
    [
      "'Game changer' blood test for CTE may be coming",
      'Traces of a brain protein in blood could soon lead to a test that could diagnose chronic traumatic encephalopathy (CTE) ...',
      'https://medicalxpress.com/news/2026-11-game-changer-blood-cte.html',
    ],
    [
      'Roethlisberger, Gronkowski are among first-time eligibles advancing in Hall of Fame voting process',
      'Ben Roethlisberger and Rob Gronkowski are among the first-time eligible players who have advanced in the voting process ...',
      'https://www.itv.com/news/2026-11-24/roethlisberger-gronkowski-are-among-first-time-eligibles-advancing-in-hall-of-fame-voting-process',
    ],
    [
      'Vanier Cup preview: Can young Western Mustangs topple mighty Montreal Carabins?',
      'The national university football final is set for 12:15 p.m. on Saturday.',
      'https://lfpress.com/sports/western-mustangs/vanier-cup-preview-can-young-western-mustangs-topple-mighty-montreal-carabins/',
    ],
  ])('leaves out one passing football word: %s', (headline, summary, url) => {
    expect(notFootballOf(searched(headline, summary, url))).toBe('search_without_football');
  });

  it.each([
    [
      "Pochettino: I am not nice, and that doesn't suit me",
      "Manchester United coach Mauricio Pochettino has spoken about his players' fitness ahead of tomorrow's meeting with ...",
      'https://www.yardbarker.com/soccer/articles/pochettino_i_am_not_nice_and_that_doesnt_suit_me/s1_17790_44626687',
    ],
    [
      'Where did it all go wrong for Raheem Sterling?',
      'The fall from grace of Raheem Sterling will have surprised few people who have followed the footballer’s career. Too much money, far too soon, followed by celebrity of a kind, and then disgrace. The tale is old as the hills. Football fans may remember the goals he scored – and those he missed – for Manchester City and',
      'https://spectator.com/article/where-did-it-all-go-wrong-for-raheem-sterling/',
    ],
    [
      'Top-seeded Whitecaps hope to roll through Salt Lake, advance to semis',
      'While the top two seeds in the Eastern Conference suffered losses in the openers of their first-round MLS Cup playoff ...',
      'https://www.yardbarker.com/soccer/articles/top_seeded_whitecaps_hope_to_roll_through_salt_lake_advance_to_semis/s1_17064_44625069',
    ],
    [
      "Arsenal sack women's coach Slegers after poor start to WSL season",
      "LONDON, Nov 27 - Arsenal sacked women's coach Renee Slegers on Friday after a dismal start to the Women's Super League ...",
      'https://www.straitstimes.com/sport/football/arsenal-sack-womens-coach-slegers-after-poor-start-to-wsl-season',
    ],
    [
      'Loons dominate LAFC in 3-1 win to take playoff chances to Decision Day',
      'Minnesota United lost all five games in September and its MLS Cup Playoff chances looked all but kaput. But the Loons ...',
      'https://www.twincities.com/2026/11/01/loons-dominate-lafc-in-3-1-win-to-take-playoff-chances-to-decision-day/',
    ],
    [
      'Messi’s Miami survive defensive horror show to clinch playoff advantage',
      'MIAMI, Nov 8 — Lionel Messi’s Inter Miami clung on for second place in the Eastern Conference with a wasteful 3-3 draw against Charlotte on the final day of the MLS regular...',
      'https://www.malaymail.com/news/sports/2026/11/08/messis-miami-survive-defensive-horror-show-to-clinch-playoff-advantage/242403',
    ],
    [
      "Guardiola: 'If Italy had asked earlier I'd have joined'",
      "Italy's national soccer team might have tempted serial-winner Pep Guardiola to be their next coach - if only...",
      'https://www.canberratimes.com.au/story/9398453/guardiola-if-italy-had-asked-earlier-id-have-joined/',
    ],
    [
      'Chicago Stars say they’re left out of stadium bill; Illinois disagrees',
      'The women’s soccer team called it “unacceptable” that lawmakers won’t act on its stadium before January, but Sen. Bill ...',
      'https://www.chicagotribune.com/2026/11/16/chicago-stars-say-illinois-bears-stadium-push-leaves-them-out-state-officials-say-bill-could-help-womens-team/',
    ],
    [
      'Green Lions roar again in 5',
      '‘Everyone was electric,’ was manager Tony Vance’s assessment of his side’s performance, as Guernsey beat play-off rivals East Grinstead 5-1 in another dominant Southern Combination Premier League ...',
      'https://guernseypress.com/sport/2026/11/16/green-lions-roar-again-in-5-1-win-over-east-grinstead',
    ],
    [
      'USA discuss Gareth Southgate to replace Pochettino as elite coach leads four contenders - Exclusive',
      'Sir Gareth Southgate’s name has been discussed by the US Soccer Federation as a potential successor to Mauricio Pochettino, with TEAMtalk understanding that the former England manager has emerged as ...',
      'https://www.teamtalk.com/news/usa-discuss-gareth-southgate-pochettino-replacement-elite-coach-leads-four-contenders-exclusive',
    ],
    [
      'Eamon Dunphy column: Ireland need The Dentist to fill the gaps - not create more holes',
      'The Icelandic coach might be very good at putting in fillings but when it comes to coaching he has given us a soccer team that is toothless.',
      'https://www.irishmirror.ie/sport/sport-opinion/eamon-dunphy-column-ireland-need-37875453',
    ],
    [
      'De Cuyper urges Albion to stay humble amid title talk',
      'Maxim De Cuyper says it is impossible to avoid the growing excitement around Albion in the Premier League.',
      'https://www.theargus.co.uk/sport/26712419.de-cuyper-urges-albion-stay-humble-amid-title-talk/',
    ],
    [
      'Officially: Raul Gonzalez takes on his first professional coaching experience',
      'Next Saturday the first test awaits. Real Oviedo have appointed Spaniard Raul Gonzalez Blanco as the new head coach of ...',
      'https://www.yardbarker.com/general_sports/articles/officially_raul_gonzalez_takes_on_his_first_professional_coaching_experience/s1_17790_44536845',
    ],
    [
      'Ronaldo announces end of Portugal career',
      'Cristiano Ronaldo has ended his international soccer career, the 41-year-old Portuguese superstar announced on social ...',
      'https://www.thescore.com/news/3645847/ronaldo-announces-end-of-portugal-career',
    ],
    [
      'Man United hires Mauricio Pochettino, who tearfully leaves US job to revive former power',
      'By CHARLES ODUM, JAMES ROBSON and RONALD BLUM FAYETTEVILLE, Ga. (AP) — Mauricio Pochettino was hired as Manchester United’s head coach on Friday, agreeing to ...',
      'https://www.baltimoresun.com/2026/11/13/man-united-hires-mauricio-pochettino-who-tearfully-leaves-us-job-to-revive-former-power/',
    ],
    [
      'Michael Carrick hoping Man Utd can build on dramatic fightback against Roma',
      'United came from 2-0 down to win 3-2 in the Champions League.',
      'https://www.bournemouthecho.co.uk/sport/national/26708285.michael-carrick-hoping-man-utd-can-build-dramatic-fightback-roma/',
    ],
    [
      "'I'll NEVER close the door'",
      'BRUNO FERNANDES opened the door to a potential homecoming to Sporting CP after his return to Portugal in the Champions League. Manchester...',
      'https://www.thesun.co.uk/sport/41147116/man-utd-bruno-fernandes-transfer-sporting/',
    ],
    [
      'Ash shirt collaboration with Irish League team attracts fans from across the world',
      'The rock outfit is celebrating the 30th anniversary of their album 1977 with the release of a shirt with Ards Football Club.',
      'https://www.lancashiretelegraph.co.uk/news/national/26688026.ash-shirt-collaboration-irish-league-team-attracts-fans-across-world/',
    ],
    [
      'Tags hail grant funding in bid to become most inclusive club',
      'Hashtag United believe grant funding has helped them become one of the most inclusive football clubs in the country.',
      'https://www.lancashiretelegraph.co.uk/news/26768194.tags-hail-grant-funding-bid-become-inclusive-club/',
    ],
    [
      'Davies to miss Canada match with injury',
      'Canadian soccer star Alphonso Davies is heading to Germany for treatments after a medical scan on Sunday revealed minor ...',
      'https://www.cp24.com/news/sports/2026/11/16/scan-reveals-lower-body-muscle-strain-for-canadian-soccer-captain-davies/',
    ],
    [
      'Lionel Messi Blocked From Suspension Due to ‘Little',
      'Lionel Messi benefits from ‘little-known’ MLS rule that doesn’t exist in any other league',
      'https://www.givemesport.com/lionel-messi-benefits-mls-rule-doesnt-exist-any-other-league/',
    ],
    [
      'Man-U held by Sporting',
      'manchester : mauricio pochettino was denied his first win as manchester united coach in calamitous circumstances after a 2-2 draw with sporting lisbon in the champions league. paris saint-germain ...',
      'https://www.thehitavada.com//Encyc/2026/11/27/man-u-held-by-sporting.html',
    ],
    [
      "RingConn and Borussia Dortmund Join Forces in a BVB Women's Premium Partnership",
      "/PRNewswire/ -- RingConn, a health technology company specializing in smart rings, announced a partnership with Borussia Dortmund's women's football team,...",
      'https://www.prnewswire.co.uk/news-releases/ringconn-and-borussia-dortmund-join-forces-in-a-bvb-womens-premium-partnership-302929467.html',
    ],
  ])('keeps football’s own story: %s', (headline, summary, url) => {
    expect(notFootballOf(searched(headline, summary, url))).toBeNull();
  });

  it('judges only a search’s item filed to none of ours', () => {
    const sabey = {
      headline: 'Building Beyond the Boom: Dave Sabey on the Future of Data Centers',
      summary:
        'From clearing a path for teammates on the football field to spending more than 50 years ...',
      url: 'https://techbullion.com/building-beyond-the-boom-dave-sabey-on-the-future-of-data-centers/',
    };
    expect(notFootballOf(item({ ...sabey, searched: true }))).toBe('search_without_football');
    // Filed to one of ours: the linker's names are the evidence.
    expect(notFootballOf(item({ ...sabey, searched: true, filedTo: ['team'] }))).toBeNull();
    // A publisher's own football feed: D-290's rule only.
    expect(notFootballOf(item({ ...sabey, feedUrl: YAHOO }))).toBeNull();
    // Another sport's words still name their own reason first (D-321).
    expect(
      notFootballOf(item({ headline: 'Uma Kashvi Becomes Youngest WPL Player', searched: true })),
    ).toBe('other_sport');
  });
});

describe('searchFootballEvidence', () => {
  const none = { summary: null, url: null };

  it('takes the publisher’s football section, never the page itself', () => {
    expect(
      searchFootballEvidence({
        headline: "Pochettino: I am not nice, and that doesn't suit me",
        summary: null,
        url: 'https://www.yardbarker.com/soccer/articles/pochettino_i_am_not_nice_and_that_doesnt_suit_me/s1_17790_44626687',
      }),
    ).toBe(true);
    // Written for the spec: "soccer" as the page's name, not a directory.
    expect(
      searchFootballEvidence({
        headline: 'Weekend plans',
        summary: null,
        url: 'https://example.com/soccer',
      }),
    ).toBe(false);
  });

  it('takes football’s name in the headline or in the page’s slug as enough', () => {
    expect(
      searchFootballEvidence({
        headline: "Tributes after tragic death of footballer, 20, who will 'never be forgotten'",
        ...none,
      }),
    ).toBe(true);
    // Written for the spec: an acronym in capitals.
    expect(
      searchFootballEvidence({ headline: 'Messi wins the MLS Golden Boot again', ...none }),
    ).toBe(true);
    expect(
      searchFootballEvidence({
        headline: "DARREN LEWIS: 'Let’s believe in our team and live this dream'",
        summary:
          'Why shouldn’t we believe our men’s football team will be next in line? The significance of England’s victory ...',
        url: 'https://www.mirror.co.uk/news/uk-news/england-football-european-championship-spain-37882763',
      }),
    ).toBe(true);
  });

  it('counts each football signal once, whatever its case or number', () => {
    // Written for the spec.
    expect(
      searchFootballEvidence({
        headline: 'Town plan approved',
        summary:
          'The FOOTBALL pitches and the football ground, both laid by a former footballer ...',
        url: null,
      }),
    ).toBe(false);
  });

  it('reads the United States, Real Estate and MLS® as no club and no league', () => {
    // Written for the spec.
    expect(
      searchFootballEvidence({
        headline: 'The United States tightens visa rules',
        summary: 'Real Estate agents say soccer fans face MLS® listings at record prices.',
        url: null,
      }),
    ).toBe(false);
  });
});
