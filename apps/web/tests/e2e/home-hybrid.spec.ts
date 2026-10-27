import { type Server, createServer } from 'node:http';
import { type Page, expect, test } from '@playwright/test';

/**
 * The home page on the production build (T-1382, D-200; rebuilt in T-1495,
 * D-270), at a phone's 390 px and a desktop's 1440 px, in English, Persian
 * and the RTL pseudo-locale.
 *
 * Without an API every block says so and the layout still holds: the side
 * column on the inline end, under the main one on a phone, no sideways
 * scroll, the ground following the theme (D-263 retired the paper page).
 *
 * With the scores, from a small stand-in for the API that this file starts on
 * the API's address: the seed's only open match is in 2099, outside the two
 * weeks the home looks at, so the journeys' stack cannot show a big match.
 * The stand-in answers only while one of these tests is loading a page, and
 * cuts every other request as an absent API would; it is not started when a
 * real API is configured (`E2E_API_URL`), or when the address is taken.
 */

const NIGHT = 'rgb(15, 18, 21)';
const DAY = 'rgb(242, 243, 241)';
const WIDTHS = [390, 1440] as const;
const LOCALES = ['en', 'fa', 'x-rtl'] as const;

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, selector).not.toBeNull();
  return found!;
};

test.describe('the home page without an API', () => {
  for (const [theme, ground] of [
    ['light', DAY],
    ['dark', NIGHT],
  ] as const) {
    test(`stands on the ${theme} theme's ground`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'fmip_theme', value: theme, url: baseURL! }]);
      await page.goto('/en');
      await expect(page.locator('main[data-mode="editorial"]')).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        ground,
      );
    });
  }

  for (const width of WIDTHS) {
    for (const locale of LOCALES) {
      test(`holds its layout at ${width} px on /${locale}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}`);
        await expect(page.getByTestId('title')).toBeVisible();
        await expect(page.getByTestId('home-matches-none')).toBeVisible();
        // T-1541: the first run's two controls are touch targets.
        for (const id of ['first-run-start', 'first-run-dismiss']) {
          expect((await box(page, `[data-testid="${id}"]`)).height).toBeGreaterThanOrEqual(44);
        }
        // The upset card says it could not be loaded, once on the screen:
        // after the hero on a phone, in the side column on a desktop (T-1516).
        const upset = page.locator('[data-testid="home-upset"]:visible');
        await expect(upset).toHaveCount(1);
        await expect(upset).toHaveAttribute('data-state', 'unreachable');
        await expect(upset).toHaveAttribute('data-placement', width === 390 ? 'main' : 'side');
        const main = await box(page, '[aria-labelledby="home-today"]');
        const side = await box(page, '[data-testid="home-accuracy"]');
        if (width === 390) expect(side.y).toBeGreaterThan(main.y);
        else if (locale === 'en') expect(main.x + main.width).toBeLessThanOrEqual(side.x);
        else expect(side.x + side.width).toBeLessThanOrEqual(main.x);
        expect(await noSidewaysScroll(page)).toBe(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The stand-in API
// ---------------------------------------------------------------------------

type Scenario = 'live' | 'next';

const API = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3001');
const PGPL = { id: 'c-pgpl', name: 'Persian Gulf Pro League', short_name: null, country_id: null };
const EPL = { id: 'c-epl', name: 'Premier League', short_name: null, country_id: null };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

function scoreCard(
  id: string,
  competition: typeof PGPL,
  home: string,
  away: string,
  kickoff: string,
  status: 'scheduled' | 'live' | 'finished',
  score: [number, number] | null,
) {
  const line = score === null ? null : { home: score[0], away: score[1] };
  return {
    id,
    kickoff_at: kickoff,
    status,
    minute: status === 'live' ? 67 : null,
    competition,
    season: { id: `${competition.id}-s`, label: '2026/27' },
    stage: null,
    round: 'Regular Season - 8',
    leg: null,
    home: { id: `${id}-h`, name: home, short_name: null, code: null },
    away: { id: `${id}-a`, name: away, short_name: null, code: null },
    scores: {
      current: line,
      half_time: null,
      full_time: status === 'finished' ? line : null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: { id: `${id}-v`, name: 'Azadi Stadium', city: 'Tehran' },
    coverage: 'available',
    last_updated_at: minutes(-1),
    live_answered_at: status === 'live' ? minutes(-1) : null,
    freshness: status === 'live' ? 'fresh' : null,
    pinned: false,
  };
}

function scores(scenario: Scenario) {
  const big = scoreCard(
    'm-live',
    PGPL,
    'Tractor',
    'Esteghlal',
    minutes(-70),
    scenario === 'live' ? 'live' : 'finished',
    [2, 1],
  );
  const next = scoreCard('m-next', PGPL, 'Sepahan', 'Persepolis', minutes(180), 'scheduled', null);
  const done = scoreCard('m-done', EPL, 'Arsenal', 'Everton', minutes(-150), 'finished', [2, 0]);
  return {
    filters: {},
    generated_at: minutes(0),
    total: 3,
    pinned: [],
    groups: [
      { country: null, competition: PGPL, fixtures: [big, next] },
      { country: null, competition: EPL, fixtures: [done] },
    ],
  };
}

const version = (fixtureId: string) => ({
  id: `${fixtureId}-v2`,
  fixture_id: fixtureId,
  version_number: 2,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: minutes(-24 * 60),
  status: 'available',
  probabilities: { home: 0.4637, draw: 0.2964, away: 0.2399 },
  expected_goals: { home: 1.62, away: 0.94 },
  most_likely_scorelines: [
    { home: 1, away: 0, probability: 0.118 },
    { home: 1, away: 1, probability: 0.104 },
    { home: 2, away: 1, probability: 0.081 },
  ],
  leading_factors: [
    { factor: 'home_advantage', favours: 'home', magnitude: 0.3, note: '' },
    { factor: 'team_strength', favours: 'home', magnitude: 0.12, note: '' },
  ],
  data_completeness: 'available',
  inputs: {
    model_version: 'dixon-coles-elo@0.6.0',
    fit_date: minutes(-48 * 60).slice(0, 10),
    matches_used: 1120,
    elo_used: true,
    history_from: null,
    data_completeness: 'available',
  },
  unavailable_reason: null,
  unavailable_detail: null,
});

function answer(path: string, query: URLSearchParams, scenario: Scenario): unknown {
  if (path === '/scores') return scores(scenario);
  // T-1507 (D-265): the day's biggest miss, for the side column (T-1516).
  if (path === '/model/upset') {
    return {
      date: query.get('date'),
      time_zone: query.get('tz') ?? 'UTC',
      finished_matches: 1,
      still_to_play: 1,
      last_updated_at: minutes(-1),
      coverage: 'available',
      reason: null,
      upset: {
        fixture_id: 'm-done',
        kickoff_at: minutes(-150),
        competition: { id: EPL.id, name: EPL.name, short_name: null },
        season_id: `${EPL.id}-s`,
        home_team: { id: 'm-done-h', name: 'Arsenal', short_name: null },
        away_team: { id: 'm-done-a', name: 'Everton', short_name: null },
        score: { home: 2, away: 0 },
        outcome: 'home',
        probability: 0.2112,
        probabilities: { home: 0.2112, draw: 0.2476, away: 0.5412 },
        forecast: {
          version_number: 2,
          kind: 'early',
          model_version: 'dixon-coles-elo@0.6.0',
          computed_at: minutes(-24 * 60),
        },
      },
    };
  }
  // T-1542: an analysis kicking off at 23:30 UTC in July, past midnight in
  // the UK, so its day and time must both be the reader's.
  if (path === '/founder-analyses') {
    return {
      analyses: [
        {
          fixture: {
            id: 'm-later',
            kickoff_at: '2099-07-01T23:30:00Z',
            status: 'scheduled',
            home: { id: 'm-later-h', name: 'Foolad', short_name: null },
            away: { id: 'm-later-a', name: 'Sepahan', short_name: null },
            competition: { id: PGPL.id, name: PGPL.name },
          },
          author: { id: 'founder', display_name: 'The founder' },
          predicted_outcome: 'home',
          predicted_score: null,
          confidence: 3,
          excerpt: 'Foolad at home.',
          published_at: minutes(-60),
          version_number: 1,
        },
      ],
    };
  }
  // T-1540: a league on a full sample after one with a better share on a few.
  if (path === '/model/accuracy') {
    const point = (matches: number, accuracy: number) => ({
      period: '2026-10',
      period_start: '2026-10-01',
      forecasts: matches,
      matches,
      coverage: matches < 30 ? 'limited' : 'available',
      log_loss: 0.97,
      brier: 0.57,
      rps: 0.2,
      accuracy,
      uniform_rps: 0.24,
    });
    return {
      period: 'month',
      minimum_matches: 30,
      overall: {
        competition: null,
        model_versions: ['dixon-coles-elo@0.6.0'],
        points: [point(60, 0.55)],
      },
      competitions: [
        { competition: EPL, model_versions: [], points: [point(24, 0.71)] },
        { competition: PGPL, model_versions: [], points: [point(36, 0.58)] },
      ],
      last_updated_at: minutes(-60),
    };
  }
  if (path === '/forecasts/pre-kickoff') {
    return {
      fixtures: (query.get('fixtures') ?? '').split(',').map((id) => {
        const v = version(id);
        return {
          fixture_id: id,
          pre_kickoff: {
            version_number: v.version_number,
            kind: v.kind,
            model_version: v.model_version,
            computed_at: v.computed_at,
            status: v.status,
            probabilities: v.probabilities,
            unavailable_reason: null,
          },
        };
      }),
    };
  }
  const versions = /^\/fixtures\/([^/]+)\/forecasts$/.exec(path);
  if (versions !== null) {
    const v = version(versions[1]!);
    return {
      fixture_id: v.fixture_id,
      coverage: 'available',
      last_updated_at: v.computed_at,
      latest: v,
      versions: [v],
    };
  }
  return undefined;
}

test.describe('the home page with the scores', () => {
  let server: Server | null = null;
  let scenario: Scenario | null = null;

  test.beforeAll(async () => {
    if (process.env.E2E_API_URL !== undefined) return;
    const candidate = createServer((req, res) => {
      const url = new URL(req.url ?? '/', API);
      const body = scenario === null ? undefined : answer(url.pathname, url.searchParams, scenario);
      // Anything else is an API that is not there: the connection is cut.
      if (body === undefined) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server = await new Promise<Server | null>((resolve) => {
      candidate.once('error', () => resolve(null));
      candidate.listen(Number(API.port), API.hostname, () => resolve(candidate));
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) =>
      server === null ? resolve() : server.close(() => resolve()),
    );
  });

  const open = async (page: Page, path: string, as: Scenario) => {
    test.skip(server === null, 'a real API is configured, or its address is taken');
    scenario = as;
    try {
      await page.goto(path);
    } finally {
      scenario = null;
    }
  };

  for (const width of WIDTHS) {
    for (const locale of LOCALES) {
      test(`opens on the big match in play at ${width} px on /${locale}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page, `/${locale}`, 'live');
        const hero = page.getByTestId('home-hero');
        await expect(hero).toHaveAttribute('data-slot', 'live');
        await expect(hero).toContainText('Tractor');
        await expect(page.getByTestId('home-live')).toContainText('Esteghlal');
        await expect(page.getByTestId('home-today-group').first()).toBeVisible();
        await expect(page.getByTestId('home-hero-receipt')).toBeVisible();
        const upset = page.locator('[data-testid="home-upset"]:visible');
        await expect(upset).toHaveCount(1);
        await expect(upset).toHaveAttribute('data-state', 'available');
        await expect(upset).toContainText('Arsenal');
        await expect(upset.getByTestId('home-upset-score')).toHaveText(
          locale === 'fa' ? '۲–۰' : '2–0',
        );
        if (width === 390) {
          // HomePhone's order: the hero, then the card, then today.
          const hero = await box(page, '[data-testid="home-hero"]');
          const card = await box(page, '[data-testid="home-upset"][data-placement="main"]');
          const today = await box(page, '[data-testid="home-matches"]');
          expect(card.y).toBeGreaterThan(hero.y);
          expect(today.y).toBeGreaterThan(card.y);
        }
        // T-1540: the league on a full sample first; the limited one after
        // it, with its count.
        const leagues = page.getByTestId('home-month-league');
        await expect(leagues).toHaveCount(2);
        await expect(leagues.first()).toHaveAttribute('data-coverage', 'available');
        await expect(leagues.nth(1)).toHaveAttribute('data-coverage', 'limited');
        await expect(leagues.nth(1)).toContainText(locale === 'fa' ? '۲۴' : '24');
        if (locale === 'en') {
          // T-1542: the founder's column in UK time, its day as well as its time.
          await expect(page.getByTestId('founder-feed')).toContainText('2099-07-02 00:30');
        }
        if (locale === 'fa') {
          await expect(page.getByTestId('home-hero-xg')).toContainText('۱٫۶۲');
          await expect(page.getByTestId('home-hero-score')).toHaveText('۲–۱');
        } else {
          await expect(page.getByTestId('home-hero-xg')).toContainText('1.62');
        }

        // The three voices: side by side on a desktop, the model's lane on
        // the inline start; one under another on a phone.
        const model = await box(page, '[data-testid="home-hero"] [data-voice="model"]');
        const founder = await box(page, '[data-testid="home-hero"] [data-voice="founder"]');
        if (width === 390) expect(founder.y).toBeGreaterThan(model.y);
        else if (locale === 'en') expect(model.x + model.width).toBeLessThanOrEqual(founder.x);
        else expect(founder.x + founder.width).toBeLessThanOrEqual(model.x);
        expect(await noSidewaysScroll(page)).toBe(0);
      });
    }
  }

  for (const locale of LOCALES) {
    test(`falls back to the next big match when nothing is live, on /${locale}`, async ({
      page,
    }) => {
      await open(page, `/${locale}`, 'next');
      const hero = page.getByTestId('home-hero');
      await expect(hero).toHaveAttribute('data-slot', /^(today|tomorrow)$/);
      await expect(hero).toContainText('Sepahan');
      await expect(page.getByTestId('home-live')).toHaveCount(0);
    });
  }
});
