import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompetitionPage, FollowedEntity, SeasonFixture, TableRow } from '@fmip/contracts';
import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { message } from '@/i18n/messages';
import { leagueNumbers } from '@/lib/competition-overview';

// The server actions need a request; the component only binds them.
vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const {
  BoardList,
  CompetitionFollow,
  CoveragePanel,
  LeagueNumbersPanel,
  LiveFreshness,
  ProviderTotalsNote,
  QualifyingNote,
  ScorerList,
} = await import('./competition-page');

/**
 * The competition page's shared modules (T-1385, D-203): the follow control,
 * live freshness, every module's coverage as a badge, the season in figures
 * and the players' boards. The page's own header, table, rows and model card
 * (T-1498) are tested beside the page, in `competition-cards.spec.tsx`.
 */

const ID = '00000000-0000-4000-8000-000000000201';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const PAGE = readFileSync(
  join(__dirname, '..', 'app', '[locale]', 'competition', '[id]', 'page.tsx'),
  'utf8',
);
const COMPONENT = readFileSync(join(__dirname, 'competition-page.tsx'), 'utf8');

function fixture(over: Partial<SeasonFixture> = {}): SeasonFixture {
  return {
    id: '00000000-0000-4000-8000-00000000f001',
    kickoff_at: '2026-10-01T12:30:00.000Z',
    status: 'scheduled',
    round: 'Regular Season - 8',
    stage: null,
    home: { id: 'h', name: 'Sepahan', short_name: null },
    away: { id: 'a', name: 'Fajr Sepasi', short_name: null },
    score: null,
    ...over,
  };
}

const row = (id: string, position: number, form: TableRow['form']): TableRow => ({
  position,
  team: { id, name: `Team ${id}`, short_name: null },
  played: 7,
  won: 5,
  drawn: 1,
  lost: 1,
  goals_for: 12,
  goals_against: 5,
  goal_difference: position === 1 ? 7 : -2,
  points: 16,
  form,
});

function page(over: Partial<CompetitionPage> = {}): CompetitionPage {
  return {
    competition: {
      id: ID,
      name: 'Persian Gulf Pro League',
      localised_name: null,
      short_name: 'Pro League',
      kind: 'league',
      scope: 'domestic',
      gender: 'men',
      age_group: 'senior',
      tier: 1,
      country: { id: 'ir', name: 'Iran', code: 'IR' },
    },
    seasons: [
      {
        id: 's2',
        label: '2026/27',
        start_date: '2026-08-01',
        end_date: '2027-05-30',
        is_current: true,
      },
      {
        id: 's1',
        label: '2025/26',
        start_date: '2025-08-01',
        end_date: '2026-05-30',
        is_current: false,
      },
    ],
    season: {
      id: 's2',
      label: '2026/27',
      start_date: '2026-08-01',
      end_date: '2027-05-30',
      is_current: true,
      stages: [],
    },
    table: {
      coverage: 'available',
      last_updated_at: '2026-09-26T16:15:00.000Z',
      data: [row('a', 1, ['W', 'W', 'D', 'W', 'L']), row('b', 2, ['L'])],
    },
    group_tables: null,
    zones: { state: 'not_listed', reason: 'season_not_listed' },
    results: [fixture({ id: 'r1', status: 'finished', score: { home: 6, away: 1 } })],
    fixtures: [fixture()],
    leaders: { coverage: 'limited', last_updated_at: null, data: [] },
    leaders_filter: { min_minutes: null, unproven: 0, presets: [450, 900, 1800] },
    boards: {
      assists: { coverage: 'not_supplied', last_updated_at: null, data: null },
      clean_sheets: { coverage: 'not_supplied', last_updated_at: null, data: null },
      yellow_cards: { coverage: 'not_supplied', last_updated_at: null, data: null },
      red_cards: { coverage: 'not_supplied', last_updated_at: null, data: null },
      unproven: { assists: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0 },
    },
    leaders_source: 'recorded',
    bracket: null,
    coverage: { standings: 'available', lineups: 'limited', scores: 'delayed' },
    last_updated_at: '2026-10-01T12:00:00.000Z',
    ...over,
  } as CompetitionPage;
}

describe('following the competition', () => {
  const competition: FollowedEntity = {
    entity_type: 'competition',
    entity_id: ID,
    favourite: false,
  } as FollowedEntity;

  it('sends a guest to sign in and says when the follows cannot be read', () => {
    const guest = renderToStaticMarkup(
      <CompetitionFollow
        locale="en"
        competitionId={ID}
        name="Premier League"
        signedIn={false}
        following={null}
      />,
    );
    expect(guest).toContain('data-testid="competition-follow-guest"');
    expect(guest).toContain('href="/en/login"');
    const unknown = renderToStaticMarkup(
      <CompetitionFollow
        locale="en"
        competitionId={ID}
        name="Premier League"
        signedIn
        following={null}
      />,
    );
    expect(unknown).toContain('data-testid="competition-follow-unreachable"');
    expect(unknown).not.toContain('<form');
  });

  it('posts the follow, and offers to stop once followed', () => {
    const off = renderToStaticMarkup(
      <CompetitionFollow
        locale="en"
        competitionId={ID}
        name="Premier League"
        signedIn
        following={[]}
      />,
    );
    expect(off).toContain('value="competition"');
    expect(off).toContain('data-following="false"');
    expect(off).toContain('>Follow<');
    const on = renderToStaticMarkup(
      <CompetitionFollow
        locale="fa"
        competitionId={ID}
        name="Premier League"
        signedIn
        following={[competition]}
      />,
    );
    expect(on).toContain('data-following="true"');
    expect(on).toContain('لغو دنبال کردن');
  });
});

describe('freshness where a module is live (rule 4)', () => {
  const freshness = {
    'freshness.checked': message('en', 'freshness.checked'),
    'freshness.behind': message('en', 'freshness.behind'),
  };
  const at = Date.parse('2026-10-01T12:00:00.000Z');

  it('stamps a list with a live match, and says it may be behind past the threshold', () => {
    const live = [fixture({ status: 'live' })];
    const fresh = renderToStaticMarkup(
      <LiveFreshness
        fixtures={live}
        checkedAt="2026-10-01T12:00:00.000Z"
        now={at + 10_000}
        locale="en"
        words={freshness}
      />,
    );
    expect(fresh).toContain('data-freshness="current"');
    const old = renderToStaticMarkup(
      <LiveFreshness
        fixtures={live}
        checkedAt="2026-10-01T12:00:00.000Z"
        now={at + STALE_LIVE_AFTER_MS + 1}
        locale="en"
        words={freshness}
      />,
    );
    expect(old).toContain('data-freshness="behind"');
  });

  it('stamps nothing when no match is live', () => {
    expect(
      renderToStaticMarkup(
        <LiveFreshness
          fixtures={[fixture()]}
          checkedAt="2026-10-01T12:00:00.000Z"
          now={at}
          locale="en"
          words={freshness}
        />,
      ),
    ).toBe('');
  });
});

describe('coverage, never the old uppercase words', () => {
  it('badges every module the season declares', () => {
    const html = renderToStaticMarkup(<CoveragePanel page={page()} locale="en" timeZone="UTC" />);
    expect(html).toContain('data-coverage-badge="available"');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('data-coverage-badge="delayed"');
    expect(COMPONENT).not.toContain('coverageText');
    expect(PAGE).not.toContain('coverageText');
  });

  it('says the season has no figures rather than four noughts', () => {
    const none = renderToStaticMarkup(
      <LeagueNumbersPanel numbers={leagueNumbers([])} locale="en" />,
    );
    expect(none).toContain('data-testid="numbers-empty"');
    expect(none).toContain('data-coverage-badge="not_supplied"');
    const some = renderToStaticMarkup(
      <LeagueNumbersPanel
        numbers={leagueNumbers([
          fixture({ status: 'finished', score: { home: 1, away: 1 } }),
          fixture({ status: 'finished', score: null }),
        ])}
        locale="fa"
      />,
    );
    expect(some).toContain('data-coverage-badge="limited"');
    expect(some).toContain('۲٫۰۰');
  });

  it("counts a cup's main competition and says the qualifying rounds are left out (T-1394)", () => {
    const results = [
      fixture({ status: 'finished', score: { home: 5, away: 0 }, qualifying: true }),
      fixture({ status: 'finished', score: { home: 3, away: 0 }, qualifying: true }),
      fixture({ status: 'finished', score: { home: 2, away: 1 }, qualifying: false }),
      fixture({ status: 'finished', score: { home: 0, away: 0 }, qualifying: false }),
    ];
    const html = renderToStaticMarkup(
      <LeagueNumbersPanel numbers={leagueNumbers(results)} locale="en" />,
    );
    // 3 goals over the 2 main-competition matches, not 11 over 4.
    expect(html).toContain('1.50');
    expect(html).toContain('From all 2 results of the main competition');
    expect(html).toContain('The 2 qualifying matches before it are not counted.');
    const boards = renderToStaticMarkup(<QualifyingNote results={results} locale="fa" />);
    expect(boards).toContain('data-testid="boards-main-phase"');
    expect(boards).toContain('۲ بازی مرحله‌ی مقدماتی');
    // A league season has nothing to say.
    expect(
      renderToStaticMarkup(
        <QualifyingNote results={[fixture({ status: 'finished' })]} locale="en" />,
      ),
    ).toBe('');
    // Only qualifying results so far: no figures, and why.
    const early = renderToStaticMarkup(
      <LeagueNumbersPanel numbers={leagueNumbers(results.slice(0, 2))} locale="en" />,
    );
    expect(early).toContain('The main competition has no result with a score yet');
  });
});

describe('the player tables (T-1441)', () => {
  const minutes = {
    coverage: 'available',
    total: 900,
    matches: 10,
    matches_with_minutes: 10,
    supplied_minutes: 900,
  } as const;
  const none = {
    coverage: 'not_supplied',
    total: null,
    matches: 0,
    matches_with_minutes: 0,
    supplied_minutes: 0,
  } as const;
  const who = (id: string) => ({ person: { id, name: `Player ${id}` }, team: null });

  it('shows each scorer appearances, and says so when none is recorded', () => {
    const html = renderToStaticMarkup(
      <ScorerList
        locale="en"
        leaders={[
          { ...who('a'), goals: 9, minutes, appearances: 10 },
          { ...who('b'), goals: 9, minutes: none, appearances: null },
        ]}
      />,
    );
    expect(html).toContain('10 appearances');
    expect(html).toContain('appearances not recorded');
    expect(html.indexOf('Player a')).toBeLessThan(html.indexOf('Player b'));
  });

  it('shows a yellow or a red board own figure and appearances', () => {
    const row = { ...who('c'), minutes, appearances: 1, yellow_cards: 4, red_cards: 1 };
    const yellow = renderToStaticMarkup(
      <BoardList rows={[row]} board="yellow_cards" locale="fa" />,
    );
    expect(yellow).toContain('۴');
    expect(yellow).toContain('۱ بازی');
    const red = renderToStaticMarkup(<BoardList rows={[row]} board="red_cards" locale="en" />);
    expect(red).toContain('1 appearance<');
    expect(red).not.toContain('1 appearances');
  });

  it('names the provider totals as the source, in the reader language', () => {
    expect(renderToStaticMarkup(<ProviderTotalsNote locale="en" />)).toContain(
      'our statistics source',
    );
    const fa = renderToStaticMarkup(<ProviderTotalsNote locale="fa" />);
    expect(fa).toContain('data-testid="leaders-provider-totals"');
    expect(fa).toContain('منبع آماری');
  });
});

describe('the page’s layout', () => {
  it('uses logical properties only (rule 7) and stands on the data stage', () => {
    expect(PAGE).not.toMatch(PHYSICAL);
    expect(COMPONENT).not.toMatch(PHYSICAL);
    expect(PAGE).toContain('data-mode="data"');
  });

  it('asks the model for a list of matches in one request, never one per match', () => {
    expect(PAGE).toContain('fetchForecastSummaries(ids)');
    expect(PAGE.match(/fetchForecastSummaries\(/g)).toHaveLength(1);
  });
});
