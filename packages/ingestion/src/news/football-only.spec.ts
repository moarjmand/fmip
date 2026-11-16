import { describe, expect, it } from 'vitest';
import {
  footballEvidence,
  GENERAL_SPORTS_FEEDS,
  isGeneralSportsFeed,
  type NewsItemSignals,
  notFootballOf,
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
  return { summary: null, categories: [], feedUrl: null, searched: false, filedTo: [], ...over };
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
