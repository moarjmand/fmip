import type {
  CommunityConsensusResponse,
  CompetitionTable,
  ForecastVersion,
  FounderAnalysisResponse,
  ScoreCard,
  TableRow,
  TeamPage,
  ViewingOption,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccuracyFigure, HeroMatch, KeyGroup } from '@/lib/home';
import type { CardForecast } from '@/lib/score-card-products';
import { BigMatch, HomeDateline, LiveNow, TodayByCompetition } from './home-front';
import { AccuracyCard, Broadcasts, MyTeams, TableTopFive } from './home-rail';

/**
 * The home page's blocks (T-1382, D-200; rebuilt in T-1495, D-270), in their
 * states: with data and without it, in English and in Persian, where the
 * reading order turns round, the digits are Persian and each score stays
 * beside its own team.
 */

const card = (over: Partial<ScoreCard> = {}): ScoreCard =>
  ({
    id: 'f1',
    kickoff_at: '2026-10-08T13:30:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: {
      id: 'pgpl',
      name: 'Persian Gulf Pro League',
      short_name: null,
      country_id: null,
    },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: 'Regular Season - 8',
    leg: null,
    home: { id: 'tractor', name: 'Tractor', short_name: null, code: null },
    away: { id: 'esteghlal', name: 'Esteghlal', short_name: null, code: null },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: { id: 'v', name: 'Yadegar-e-Emam Stadium', city: 'Tabriz' },
    coverage: 'limited',
    last_updated_at: '2026-10-08T09:00:00.000Z',
    freshness: null,
    pinned: false,
    ...over,
  }) as ScoreCard;

const scored = (home: number, away: number) => ({
  current: { home, away },
  half_time: null,
  full_time: null,
  extra_time: null,
  penalties: null,
  aggregate: null,
});

const FORECAST: CardForecast = {
  state: 'available',
  home: 46.4,
  draw: 33.6,
  away: 20,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T09:30:00.000Z',
};

const VERSION = {
  id: 'v3',
  fixture_id: 'f1',
  version_number: 3,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T09:30:00.000Z',
  status: 'available',
  probabilities: { home: 0.464, draw: 0.336, away: 0.2 },
  expected_goals: { home: 1.62, away: 0.94 },
  most_likely_scorelines: [
    { home: 1, away: 0, probability: 0.118 },
    { home: 1, away: 1, probability: 0.104 },
    { home: 2, away: 1, probability: 0.081 },
    { home: 0, away: 0, probability: 0.07 },
  ],
  leading_factors: [
    { factor: 'team_strength', favours: 'home', magnitude: 0.12, note: '' },
    { factor: 'home_advantage', favours: 'home', magnitude: 0.3, note: '' },
    { factor: 'attack_vs_defence', favours: 'away', magnitude: -0.05, note: '' },
  ],
  data_completeness: 'available',
  inputs: {
    model_version: 'dixon-coles-elo@0.6.0',
    fit_date: '2026-10-07',
    matches_used: 1120,
    elo_used: true,
    history_from: null,
    data_completeness: 'available',
  },
  unavailable_reason: null,
  unavailable_detail: null,
} as ForecastVersion;

const row = (team: string, position: number, points: number) =>
  ({ position, points, team: { id: team, name: team, short_name: null } }) as unknown as TableRow;

const consensus = (sample: number | null) =>
  ({
    coverage: sample === null ? 'not_supplied' : 'available',
    last_updated_at: null,
    data:
      sample === null
        ? null
        : {
            fixture_id: 'f1',
            sample,
            crowd: {
              counts: { home: 10, draw: 6, away: 4 },
              shares: { home: 0.5, draw: 0.3, away: 0.2 },
            },
            weighted: null,
            last_submitted_at: '2026-10-08T09:00:00Z',
            computed_at: '2026-10-08T09:00:00Z',
          },
  }) as CommunityConsensusResponse;

const NO_ANALYSIS = { fixture_id: 'f1', analysis: null } as FounderAnalysisResponse;

const big = (over: Partial<Parameters<typeof BigMatch>[0]> = {}) =>
  renderToStaticMarkup(
    <BigMatch
      hero={{ card: card(), slot: 'today' } satisfies HeroMatch}
      forecast={FORECAST}
      version={VERSION}
      homeRow={row('tractor', 1, 16)}
      awayRow={row('esteghlal', 2, 15)}
      tableSize={16}
      note={null}
      founder={NO_ANALYSIS}
      consensus={consensus(20)}
      revealed={false}
      locale="en"
      timeZone="Asia/Tehran"
      {...over}
    />,
  );

describe('the dateline', () => {
  it('is the page’s one h1, with the inline-start accent the RTL check measures', () => {
    const html = renderToStaticMarkup(
      <HomeDateline locale="en" timeZone="Asia/Tehran" now="2026-10-08T11:42:00.000Z" />,
    );
    expect(html).toMatch(
      /<h1 class="border-s-4 border-s-accent ps-4[^"]*" data-testid="title">Today<\/h1>/,
    );
    expect(html).toContain('Thursday 8 October · 15:12');
    expect(html).toContain('Tehran time');
  });

  it('speaks Persian on /fa, with the Persian calendar and digits', () => {
    const html = renderToStaticMarkup(
      <HomeDateline locale="fa" timeZone="Asia/Tehran" now="2026-10-08T11:42:00.000Z" />,
    );
    expect(html).toContain('>امروز</h1>');
    expect(html).toContain('۱۶ مهر');
    expect(html).toContain('۱۵:۱۲');
  });
});

describe('the live strip', () => {
  const live = (over: Partial<ScoreCard> = {}) =>
    card({ status: 'live', minute: 67, scores: scored(2, 1), ...over });
  const strip = (cards: ScoreCard[], total: number, locale = 'en') =>
    renderToStaticMarkup(
      <LiveNow
        cards={cards}
        total={total}
        checkedAt="2026-10-08T14:40:00.000Z"
        scoresHref={`/${locale}/scores`}
        locale={locale}
        timeZone="Asia/Tehran"
      />,
    );

  it('counts the matches in play, opens each, and says when the answer was last heard (rule 4)', () => {
    const html = strip([live()], 1);
    expect(html).toContain('Live now');
    expect(html).toContain('data-testid="home-live-count">1<');
    expect(html).toContain('href="/en/match/f1"');
    expect(html).toContain('67′');
    expect(html).toContain('updated 18:10');
    expect(html).not.toContain('All live matches');
  });

  it('says a stale match is behind rather than showing its minute as current', () => {
    const html = strip([live({ freshness: 'stale' })], 1);
    expect(html).toContain('67′ · Behind');
  });

  it('links the rest when it shows fewer than are in play', () => {
    expect(strip([live()], 9)).toContain('All live matches');
  });

  it('in Persian keeps each score beside its own team, in Persian digits', () => {
    const html = strip([live()], 1, 'fa');
    expect(html.indexOf('Tractor')).toBeLessThan(html.indexOf('Esteghlal'));
    expect(html).toContain('۲–۱');
    expect(html).toContain('اکنون زنده');
  });
});

describe('the big match', () => {
  it('says when and where, both places, the model with its version, its figures and coverage', () => {
    const html = big();
    expect(html).toContain('data-slot="today"');
    expect(html).toContain('Today’s big one');
    expect(html).toContain('Persian Gulf Pro League');
    // The round in English words (T-1391, D-207), never the feed's.
    expect(html).toContain('Matchweek 8');
    expect(html).not.toContain('Regular Season');
    expect(html).toContain('Today · 17:00 Tehran time');
    // One isolate for name and city (T-1479), so a Persian line keeps the comma between them.
    expect(html).toContain('<bdi>Yadegar-e-Emam Stadium, Tabriz</bdi>');
    expect(html).toContain('1st of 16 · 16 pts');
    expect(html).toContain('2nd of 16 · 15 pts');
    expect(html).toContain('data-testid="forecast-bar" data-state="available"');
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('href="/en/match/f1"');
    // What the version stored: expected goals, three likeliest scores, the
    // factors by size, and its receipt.
    expect(html).toContain('1.62 – 0.94');
    expect(html.match(/data-testid="home-hero-scoreline"/g)).toHaveLength(3);
    expect(html).toContain('11.8%');
    const factors = [...html.matchAll(/data-testid="home-hero-factor"[^>]*><span[^>]*>([^<]+)/g)];
    expect(factors.map((m) => m[1])).toEqual([
      'Home advantage',
      'Team strength',
      'Attack against defence',
    ]);
    expect(html).toContain('Version 3 · Early pre-match · fitted on 1,120 matches');
    expect(html).toContain('A new version follows when line-ups are confirmed.');
  });

  it('names its slot: in play, tomorrow, or the next big one', () => {
    expect(big({ hero: { card: card(), slot: 'tomorrow' } })).toContain('Tomorrow’s big one');
    expect(big({ hero: { card: card(), slot: 'later' } })).toContain('The next big one');
    const live = big({
      hero: { card: card({ status: 'live', minute: 67, scores: scored(2, 1) }), slot: 'live' },
    });
    expect(live).toContain('data-slot="live"');
    expect(live).toContain('Live now');
    expect(live).toMatch(/data-testid="home-hero-status">67′</);
    expect(live).toContain('data-testid="home-hero-score"');
    // In play no new version is coming before kick-off.
    expect(live).not.toContain('A new version follows');
  });

  it('keeps the three voices in three lanes, says the founder has none, and the note once', () => {
    const html = big();
    expect(html.match(/data-lane="(\w+)"/g)).toEqual([
      'data-lane="model"',
      'data-lane="founder"',
      'data-lane="community"',
    ]);
    expect(html).toContain('The founder has not written an analysis of this match.');
    expect(html.match(/data-testid="three-products-note"/g)).toHaveLength(1);
  });

  it('says how many have picked and nothing about what, until the reader picks', () => {
    const hidden = big();
    expect(hidden).toContain('data-spread="hidden"');
    expect(hidden).toContain('20 members have picked');
    expect(hidden).not.toContain('data-testid="community-split"');
    const shown = big({ revealed: true });
    expect(shown).toContain('data-spread="shown"');
    expect(shown).toContain('data-testid="community-split"');
  });

  it('says what it does not have: no forecast is a sentence and no figures, no table no places', () => {
    const html = big({
      hero: { card: card({ venue: null }), slot: 'today' },
      forecast: { state: 'none' },
      version: null,
      homeRow: null,
      awayRow: null,
    });
    expect(html).toContain('data-state="none"');
    expect(html).toContain('No model forecast for this match yet.');
    expect(html).not.toContain('home-hero-receipt');
    expect(html).not.toContain(' pts');
    expect(html).not.toContain('Stadium');
  });

  it('shows the bar without figures when only the summary could be read', () => {
    const html = big({ version: null });
    expect(html).toContain('data-testid="forecast-bar" data-state="available"');
    expect(html).not.toContain('home-hero-xg');
  });

  it('marks a version fitted on limited data', () => {
    const html = big({ version: { ...VERSION, data_completeness: 'limited' } });
    const receipt = html.slice(html.indexOf('home-hero-receipt'));
    expect(receipt).toContain('data-coverage-badge="limited"');
  });

  it('in Persian keeps home first in the source, its goals beside it, in Persian digits', () => {
    const html = big({
      hero: { card: card({ status: 'live', minute: 67, scores: scored(2, 1) }), slot: 'live' },
      locale: 'fa',
    });
    expect(html.indexOf('Tractor')).toBeLessThan(html.indexOf('Esteghlal'));
    // The score is one isolate in the page's direction, home goals first.
    expect(html).toMatch(
      /<span dir="rtl" class="\[unicode-bidi:isolate\][^"]*" data-testid="home-hero-score">۲–۱<\/span>/,
    );
    expect(html).toContain('۴۶٫۴٪');
    expect(html).toContain('هفته‌ی ۸');
    expect(html).toContain('۱٫۶۲');
  });

  it('carries the editor’s note when the match is featured (D-153)', () => {
    expect(big({ note: 'The top two meet.' })).toContain('The top two meet.');
  });

  it('shows the founder’s published analysis, signed, with the way to the rest', () => {
    const founder = {
      fixture_id: 'f1',
      analysis: {
        author: { display_name: 'The Founder' },
        versions: [
          {
            id: 'v1',
            version_number: 1,
            predicted_outcome: 'home',
            predicted_score: { home: 1, away: 0 },
            confidence: 3,
            reasoning: 'Tractor at home.',
            published_at: '2026-10-07T18:00:00Z',
          },
        ],
      },
    } as unknown as FounderAnalysisResponse;
    const html = big({ founder });
    expect(html).toContain('data-testid="founder-brief" data-state="available"');
    expect(html).toContain('Tractor at home.');
    expect(html).toContain('The Founder');
    expect(html).toContain('href="/en/match/f1#analysis"');
  });
});

describe('today by competition', () => {
  const groups: KeyGroup[] = [
    { kind: 'yours', competition: null, cards: [card()], more: 0 },
    {
      kind: 'competition',
      competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: null },
      cards: [
        card({
          id: 'f2',
          status: 'finished',
          scores: scored(0, 2),
          home: { id: 'n', name: 'Nassaji', short_name: null, code: null },
          away: { id: 'z', name: 'Zob Ahan', short_name: null, code: null },
        }),
      ],
      more: 0,
    },
    {
      kind: 'competition',
      competition: { id: 'ucl', name: 'Champions League', short_name: null },
      cards: [card({ id: 'f3', round: 'League Stage - 3' })],
      more: 2,
    },
  ];
  const today = (locale: string, isToday = true) =>
    renderToStaticMarkup(
      <TodayByCompetition
        groups={groups}
        isToday={isToday}
        day="2026-10-08"
        total={88}
        scoresHref={`/${locale}/scores`}
        locale={locale}
        timeZone="Asia/Tehran"
      />,
    );

  it('puts the member’s teams first, then each competition, with its round or its count', () => {
    const html = today('en');
    expect(
      [...html.matchAll(/data-testid="home-today-group" data-kind="(\w+)"/g)].map((m) => m[1]),
    ).toEqual(['yours', 'competition', 'competition']);
    expect(html).toContain('Matches by competition');
    expect(html).toContain('All 88 matches');
    expect(html).toContain('Your teams');
    expect(html).toContain('Matchweek 8');
    // A card that leaves matches out counts them, rather than naming a round.
    expect(html).toContain('3 matches');
    expect(html).toContain('2 more matches');
    expect(html).toContain('href="/en/match/f2"');
  });

  it('gives the time before kick-off, the status after, and the winner in bold', () => {
    const html = today('en');
    expect(html).toContain('>17:00<');
    expect(html).toContain('data-status="finished"');
    expect(html).toContain('FT');
    const row = html.slice(html.indexOf('href="/en/match/f2"'));
    expect(row).toMatch(/flex min-w-0 items-center gap-2 font-bold">.*Zob Ahan/);
    expect(row).toMatch(/flex min-w-0 items-center gap-2 text-muted">.*Nassaji/);
  });

  it('says which day it is when today has no match', () => {
    expect(today('en', false)).toContain('Matches · Thursday 8 October');
  });

  it('in Persian uses Persian digits for the times and the counts', () => {
    const html = today('fa');
    expect(html).toContain('۱۷:۰۰');
    expect(html).toContain('همه‌ی ۸۸ بازی');
    expect(html).toContain('تیم‌های شما');
  });
});

describe('the side column', () => {
  it('gives the table its season in the page’s digits: Persian on /fa', () => {
    const page = {
      competition: {
        id: 'pgpl',
        name: 'Persian Gulf Pro League',
        localised_name: 'لیگ برتر خلیج فارس',
        short_name: 'Pro League',
      },
      season: { id: 's', label: '2026/27' },
      table: { coverage: 'available', last_updated_at: null, data: [row('tractor', 1, 16)] },
    } as unknown as CompetitionTable;
    const fa = renderToStaticMarkup(<TableTopFive page={page} locale="fa" />);
    expect(fa).toContain('<bdi>۲۰۲۶/۲۷</bdi>');
    expect(fa).not.toContain('2026/27');
    expect(renderToStaticMarkup(<TableTopFive page={page} locale="en" />)).toContain(
      '<bdi>2026/27</bdi>',
    );
  });

  it('shows the newest month’s accuracy with its sample, baseline and versions', () => {
    const figure: AccuracyFigure = {
      period: '2026-10',
      periodKind: 'month',
      periodStart: '2026-10-01',
      metrics: {
        forecasts: 14,
        matches: 12,
        coverage: 'limited',
        log_loss: 0.98,
        brier: 0.6,
        rps: 0.198,
        accuracy: 0.5,
        uniform_rps: 0.231,
      },
      modelVersions: ['dixon-coles-elo@0.6.0'],
      lastUpdatedAt: '2026-10-08T03:00:00Z',
    };
    const html = renderToStaticMarkup(
      <AccuracyCard figure={figure} reachable locale="en" timeZone="UTC" />,
    );
    expect(html).toContain('Model accuracy · October 2026');
    expect(html).toContain('0.198');
    expect(html).toContain('Sample: 12 matches');
    expect(html).toContain('a uniform guess scores 0.231');
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    // The versions are named as what they are (T-1479).
    expect(html).toContain('Model versions in this sample:');
    expect(html).toContain('href="/en/model-accuracy"');
    const none = renderToStaticMarkup(
      <AccuracyCard figure={null} reachable locale="en" timeZone="UTC" />,
    );
    expect(none).toContain('data-state="not_supplied"');
    const down = renderToStaticMarkup(
      <AccuracyCard figure={null} reachable={false} locale="en" timeZone="UTC" />,
    );
    expect(down).toContain('could not be loaded');
    // T-1414: the home asks for weeks, and names the week by its Monday.
    const week = renderToStaticMarkup(
      <AccuracyCard
        figure={{ ...figure, period: '2026-W42', periodKind: 'week', periodStart: '2026-10-12' }}
        reachable
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(week).toContain('Model accuracy · week of 12 Oct');
    expect(week).toContain('data-state="limited"');
  });

  it('names each broadcaster as a link-out, and the listings’ source and last check', () => {
    const option = {
      id: 'o1',
      broadcaster: { id: 'b', name: 'IRIB TV3', homepage_url: null, kind: 'tv' },
      url: 'https://example.org/tv3',
      source: { id: 's', name: 'Editorial desk', rights: 'link' },
      last_updated_at: '2026-10-08T08:00:00Z',
    } as unknown as ViewingOption;
    const html = renderToStaticMarkup(
      <Broadcasts
        broadcasts={{
          state: 'listed',
          territory: 'Iran',
          rows: [{ card: card(), options: [option] }],
          sources: ['Editorial desk'],
          checkedAt: '2026-10-08T08:00:00Z',
        }}
        locale="en"
        timeZone="Asia/Tehran"
      />,
    );
    expect(html).toContain('data-link-out="IRIB TV3"');
    expect(html).toContain('Listings for Iran from Editorial desk · last checked');
    const none = renderToStaticMarkup(
      <Broadcasts
        broadcasts={{ state: 'none', territory: 'Iran', supplied: false }}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(none).toContain('We have no listings for today’s matches in Iran.');
  });

  it('gives each followed team its next match and its last result, or why not', () => {
    const fixture = (id: string, status: string, score: { home: number; away: number } | null) => ({
      id,
      kickoff_at: '2026-10-02T15:00:00Z',
      status,
      round: null,
      stage: null,
      home: { id: 'tractor', name: 'Tractor', short_name: null },
      away: { id: 'mes', name: 'Mes', short_name: null },
      score,
      competition: { id: 'pgpl', name: 'PGPL', short_name: null },
      season: { id: 's', label: '2026/27' },
      after_extra_time: false,
      penalties: null,
    });
    const page = {
      team: { id: 'tractor', name: 'Tractor', localised_name: null },
      next_match: fixture('n1', 'scheduled', null),
      previous_match: fixture('p1', 'finished', { home: 2, away: 1 }),
    } as unknown as TeamPage;
    const html = renderToStaticMarkup(
      <MyTeams
        teams={[
          { id: 'tractor', name: 'Tractor', page },
          { id: 'other', name: 'Other', page: null },
        ]}
        followsNone={false}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(html).toContain('data-testid="home-team-next"');
    expect(html).toMatch(/Last<\/b> · <b class="text-fg">W<\/b>/);
    expect(html).toContain('This team’s matches could not be loaded.');
    expect(html).toContain('href="/en/following"');
  });
});

describe('the top five links each club, and the accuracy card names its versions (T-1479)', () => {
  it('opens the club from the homepage table', () => {
    const page = {
      competition: { id: 'c1', name: 'Premier League', short_name: null, localised_name: null },
      season: { id: 's1', label: '2026/27' },
      table: {
        coverage: 'available',
        last_updated_at: null,
        data: [
          {
            position: 1,
            team: { id: 't-city', name: 'Manchester City' },
            played: 7,
            goal_difference: 12,
            points: 21,
          },
        ],
      },
    } as unknown as CompetitionTable;
    const html = renderToStaticMarkup(<TableTopFive page={page} locale="en" />);
    expect(html).toMatch(/href="\/en\/team\/t-city"[^>]*><bdi>Manchester City<\/bdi>/);
  });
});
