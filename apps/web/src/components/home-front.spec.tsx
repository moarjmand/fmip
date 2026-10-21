import type {
  CommunityConsensusResponse,
  CompetitionTable,
  FounderAnalysisResponse,
  ScoreCard,
  TableRow,
  TeamPage,
  ViewingOption,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccuracyFigure, KeyGroup } from '@/lib/home';
import type { CardForecast } from '@/lib/score-card-products';
import { HomeDateline, KeyMatches, LeadMatchCard, ThreeForecasts } from './home-front';
import { AccuracyCard, Broadcasts, MyTeams, TableTopFive } from './home-rail';

/**
 * The Hybrid homepage's blocks (T-1382, D-200), in their states: with data
 * and without it, in English and in Persian, where the reading order turns
 * round, the digits are Persian and each score stays beside its own team.
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

const FORECAST: CardForecast = {
  state: 'available',
  home: 46.4,
  draw: 33.6,
  away: 20,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T09:30:00.000Z',
};

const row = (team: string, position: number, points: number) =>
  ({ position, points, team: { id: team, name: team, short_name: null } }) as unknown as TableRow;

const lead = (over: Parameters<typeof LeadMatchCard>[0] extends infer P ? Partial<P> : never) =>
  renderToStaticMarkup(
    <LeadMatchCard
      card={card()}
      forecast={FORECAST}
      homeRow={row('tractor', 1, 16)}
      awayRow={row('esteghlal', 2, 15)}
      tableSize={16}
      note={null}
      today="2026-10-08"
      locale="en"
      timeZone="Asia/Tehran"
      {...over}
    />,
  );

describe('the dateline', () => {
  it('is the page’s one h1, with the inline-start accent the RTL check measures', () => {
    const html = renderToStaticMarkup(
      <HomeDateline
        locale="en"
        timeZone="Asia/Tehran"
        now="2026-10-08T11:42:00.000Z"
        context="Persian Gulf Pro League · Matchweek 8"
      />,
    );
    expect(html).toMatch(
      /<h1 class="border-s-4 border-s-accent ps-4[^"]*" data-testid="title">Today<\/h1>/,
    );
    expect(html).toContain('Thursday 8 October 2026 · 15:12');
    expect(html).toContain('Tehran time');
  });

  it('speaks Persian on /fa, with the Persian calendar and digits', () => {
    const html = renderToStaticMarkup(
      <HomeDateline
        locale="fa"
        timeZone="Asia/Tehran"
        now="2026-10-08T11:42:00.000Z"
        context={null}
      />,
    );
    expect(html).toContain('>امروز</h1>');
    expect(html).toContain('۱۶ مهر ۱۴۰۵');
    expect(html).toContain('۱۵:۱۲');
  });
});

describe('the lead match card', () => {
  it('says the competition, kick-off, venue, places, the model with its version, and coverage', () => {
    const html = lead({});
    expect(html).toContain('Persian Gulf Pro League');
    // The round in English words (T-1391, D-207), never the feed's.
    expect(html).toContain('Matchweek 8');
    expect(html).not.toContain('Regular Season');
    expect(html).toContain('Today 17:00 · Tehran time');
    expect(html).toContain('Yadegar-e-Emam Stadium');
    expect(html).toContain('1st of 16 · 16 pts');
    expect(html).toContain('2nd of 16 · 15 pts');
    expect(html).toContain('data-testid="forecast-bar" data-state="available"');
    expect(html).toContain('dixon-coles-elo@0.6.0');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('href="/en/match/f1"');
    expect(html).toContain('href="/en/about#model"');
  });

  it('says what it does not have: no forecast is a sentence, no table no places, no venue none', () => {
    const html = lead({
      card: card({ venue: null }),
      forecast: { state: 'none' },
      homeRow: null,
      awayRow: null,
    });
    expect(html).toContain('data-state="none"');
    expect(html).toContain('No model forecast for this match yet.');
    expect(html).not.toContain(' pts');
    expect(html).not.toContain('Stadium');
  });

  it('in Persian keeps home first in the source, so it sits on the right, its goals beside it', () => {
    const html = lead({
      card: card({
        status: 'live',
        minute: 67,
        scores: {
          current: { home: 2, away: 1 },
          half_time: null,
          full_time: null,
          extra_time: null,
          penalties: null,
          aggregate: null,
        },
      }),
      locale: 'fa',
    });
    expect(html.indexOf('Tractor')).toBeLessThan(html.indexOf('Esteghlal'));
    // The score is one isolate in the page's direction, home goals first.
    expect(html).toMatch(
      /<span dir="rtl" class="\[unicode-bidi:isolate\][^"]*" data-testid="home-lead-score">۲–۱<\/span>/,
    );
    expect(html).toContain('۴۶٫۴٪');
  });

  it('says the provider’s round in the reader’s words on /fa, never the provider’s text (D-193)', () => {
    const html = lead({ locale: 'fa' });
    expect(html).toContain('هفته‌ی ۸');
    expect(html).not.toContain('Regular Season');
  });

  it('carries the editor’s note when the match is featured (D-153)', () => {
    expect(lead({ note: 'The top two meet.' })).toContain('The top two meet.');
  });
});

describe('three forecasts, kept apart', () => {
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
  const three = (over: Partial<Parameters<typeof ThreeForecasts>[0]>) =>
    renderToStaticMarkup(
      <ThreeForecasts
        card={card()}
        forecast={FORECAST}
        founder={{ fixture_id: 'f1', analysis: null } as FounderAnalysisResponse}
        consensus={consensus(20)}
        revealed={false}
        locale="en"
        timeZone="Europe/London"
        {...over}
      />,
    );

  it('gives each product its own lane, says the founder has none, and the note once', () => {
    const html = three({});
    expect(html.match(/data-lane="(\w+)"/g)).toEqual([
      'data-lane="model"',
      'data-lane="founder"',
      'data-lane="community"',
    ]);
    expect(html).toContain('The founder has not written an analysis of this match.');
    expect(html.match(/data-testid="three-products-note"/g)).toHaveLength(1);
  });

  it('says how many have picked and nothing about what, until the reader picks', () => {
    const hidden = three({});
    expect(hidden).toContain('data-spread="hidden"');
    expect(hidden).toContain('20 members have picked');
    expect(hidden).not.toContain('data-testid="community-split"');
    const shown = three({ revealed: true });
    expect(shown).toContain('data-spread="shown"');
    expect(shown).toContain('data-testid="community-split"');
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
    const html = three({ founder });
    expect(html).toContain('data-testid="founder-brief" data-state="available"');
    expect(html).toContain('Tractor at home.');
    expect(html).toContain('The Founder');
    expect(html).toContain('href="/en/match/f1#analysis"');
  });
});

describe('today’s key matches', () => {
  const groups: KeyGroup[] = [
    { kind: 'yours', competition: null, cards: [card()], more: 0 },
    {
      kind: 'competition',
      competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: null },
      cards: [
        card({
          id: 'f2',
          home: { id: 'n', name: 'Nassaji', short_name: null, code: null },
          away: { id: 'z', name: 'Zob Ahan', short_name: null, code: null },
        }),
      ],
      more: 2,
    },
  ];
  const keys = (locale: string, forecasts = new Map([['f1', FORECAST]])) =>
    renderToStaticMarkup(
      <KeyMatches
        groups={groups}
        isToday
        day="2026-10-08"
        forecasts={forecasts}
        notes={new Map()}
        competitions={5}
        scoresHref={`/${locale}/scores`}
        signedIn
        locale={locale}
        timeZone="Asia/Tehran"
      />,
    );

  it('puts the member’s teams first, the model’s numbers where it has them, blanks and why where not', () => {
    const html = keys('en');
    expect(html.match(/data-kind="(\w+)"/g)).toEqual([
      'data-kind="yours"',
      'data-kind="competition"',
    ]);
    expect(html).toContain('Your teams');
    expect(html).toContain('>46%<');
    expect(html).toContain('No model forecast');
    expect(html).toContain('1 match has no model forecast yet, so its cells are blank.');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('2 more matches on the scores page');
    expect(html).toContain('All 5 competitions on the scores page');
    expect(html).toContain('dixon-coles-elo@0.6.0');
  });

  it('calls the coverage available when every row has a forecast', () => {
    const html = keys(
      'en',
      new Map([
        ['f1', FORECAST],
        ['f2', FORECAST],
      ]),
    );
    expect(html).toContain('data-coverage-badge="available"');
    expect(html).not.toContain('data-testid="home-key-blank-note"');
  });

  it('in Persian uses Persian digits for the times and the percentages', () => {
    const html = keys('fa');
    expect(html).toContain('۱۷:۰۰');
    expect(html).toContain('۴۶٪');
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
    expect(html).toContain('dixon-coles-elo@0.6.0');
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
