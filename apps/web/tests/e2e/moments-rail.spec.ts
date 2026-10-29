import { type Server, createServer } from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The moments rail on the production build (T-1642, D-300), in place of the
 * matchday rail and its drawer (D-292).
 *
 * Without an API it draws nothing: no empty bar (rule 3).
 *
 * With moments, from a small stand-in for the API that this file starts on
 * the API's address (as `home-hybrid.spec.ts` does; the seed has no match
 * today, so the journeys' stack shows no moment): on a desktop one row of
 * the cards that fit and "N more", the hover card on a rest or on the
 * keyboard, floating, closed by Esc and never holding the focus; on a phone
 * a row that scrolls sideways and snaps, a tap opening the match and no
 * hover card; Persian and the pseudo-locale mirrored. The stand-in answers
 * only while one of these tests is loading a page and cuts every other
 * request as an absent API would; it is not started when a real API is
 * configured (`E2E_API_URL`), or when the address is taken. The reader's
 * zone here is Tokyo (a guest's choice), so the web's shared answer for
 * these pages is never another spec's.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const API = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3001');
const ZONE = 'Asia/Tokyo';
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function fixture(
  id: string,
  home: string,
  away: string,
  status: 'scheduled' | 'live' | 'finished',
  kickoff: string,
  score: [number, number] | null,
  minute: number | null = null,
) {
  const line = score === null ? null : { home: score[0], away: score[1] };
  return {
    id,
    kickoff_at: kickoff,
    status,
    minute,
    competition: { id: 'c-epl', name: 'Premier League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: 'Regular Season - 9',
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
    venue: null,
    coverage: 'available',
    last_updated_at: minutes(-0.5),
    live_answered_at: status === 'live' ? minutes(-0.2) : null,
    freshness: status === 'live' ? 'current' : null,
    pinned: false,
  };
}

const forecast = (home: number, draw: number, away: number) => ({
  home,
  draw,
  away,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: minutes(-24 * 60),
});

function moments() {
  const moment = (kind: string, card: ReturnType<typeof fixture>, over: object = {}) => ({
    kind,
    followed: false,
    fixture: card,
    forecast: forecast(0.2212, 0.2476, 0.5312),
    side: null,
    minutes_left: null,
    ...over,
  });
  return {
    generated_at: minutes(0),
    timezone: ZONE,
    live_count: 3,
    today_count: 42,
    moments: [
      moment(
        'against_forecast',
        fixture('m1', 'Brentford', 'Liverpool', 'live', minutes(-95), [1, 0], 80),
        {
          side: 'home',
        },
      ),
      moment('level_late', fixture('m2', 'Arsenal', 'Chelsea', 'live', minutes(-93), [2, 2], 78), {
        minutes_left: 12,
      }),
      moment('big_one', fixture('m3', 'Tractor', 'Esteghlal', 'scheduled', minutes(180), null)),
      moment(
        'starting_soon',
        fixture('m4', 'Sepahan', 'Persepolis', 'scheduled', minutes(18), null),
        {
          forecast: null,
        },
      ),
      moment('upset', fixture('m5', 'Everton', 'Fulham', 'finished', minutes(-300), [0, 2]), {
        side: 'away',
      }),
      moment(
        'coming_up',
        fixture('m6', 'Foolad', 'Malavan', 'scheduled', minutes(2 * 24 * 60), null),
      ),
    ],
  };
}

test.describe('the moments rail without an API', () => {
  for (const width of [1280, 390]) {
    test(`draws nothing at ${width} px: no empty bar (rule 3)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/en/scores');
      await expect(page.locator('header').first()).toBeVisible();
      await expect(page.getByTestId('moments-rail')).toHaveCount(0);
    });
  }
});

test.describe('the moments rail with moments', () => {
  let server: Server | null = null;
  let answering = false;

  test.beforeAll(async () => {
    if (process.env.E2E_API_URL !== undefined) return;
    const candidate = createServer((req, res) => {
      const url = new URL(req.url ?? '/', API);
      // Anything else is an API that is not there: the connection is cut.
      if (!answering || url.pathname !== '/moments') {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(moments()));
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

  test.beforeEach(async ({ context, baseURL }) => {
    const choices = encodeURIComponent(JSON.stringify({ timezone: ZONE, dismissed: true }));
    await context.addCookies([
      { name: 'fmip_first_run', value: choices, url: baseURL! },
      { name: 'fmip_lite', value: 'off', url: baseURL! },
    ]);
  });

  /** Loads `path` while the stand-in answers; again if a kept failure got there first. */
  const open = async (page: Page, path: string) => {
    test.skip(server === null, 'a real API is configured, or its address is taken');
    await expect(async () => {
      answering = true;
      try {
        await page.goto(path);
      } finally {
        answering = false;
      }
      await expect(page.getByTestId('moments-rail')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  };

  const shown = (page: Page) => page.locator('[data-testid="moment"]:visible');
  const more = (page: Page) => page.locator('[data-testid="moments-more"]:visible');

  for (const [width, fit] of [
    [1280, 4],
    [1024, 3],
    [800, 2],
  ] as const) {
    test(`shows the ${fit} cards that fit at ${width} px, then "N more", never scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, '/en/scores');
      await expect(page.getByTestId('moments-live')).toHaveText('3 live');
      await expect(page.getByTestId('moments-picked')).toContainText('Picked from 42 matches');
      await expect(page.getByTestId('moments-leagues')).toHaveAttribute('href', '/en/competitions');
      await expect(shown(page)).toHaveCount(fit);
      await expect(more(page)).toHaveCount(1);
      await expect(more(page)).toHaveText(`${6 - fit} more→`);
      await expect(more(page)).toHaveAttribute('href', '/en/scores');
      const cards = page.getByTestId('moments-cards');
      expect(
        await cards.evaluate((list) => list.scrollWidth - list.clientWidth),
      ).toBeLessThanOrEqual(0);
      expect(await noSidewaysScroll(page)).toBe(0);
      // About 150 px tall, the cards each at least 15rem wide.
      const rail = (await page.getByTestId('moments-rail').boundingBox())!;
      expect(rail.height).toBeGreaterThan(110);
      expect(rail.height).toBeLessThan(200);
      for (const box of await shown(page).evaluateAll((slots) =>
        slots.map((slot) => slot.getBoundingClientRect().width),
      )) {
        expect(box).toBeGreaterThanOrEqual(239);
      }
    });
  }

  test('draws each card: the eyebrow, the teams and goals, the model line only with a forecast', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/en/scores');
    const first = shown(page).first();
    await expect(first.getByTestId('moment-eyebrow')).toContainText('Against the forecast');
    await expect(first.getByTestId('moment-eyebrow')).toHaveAttribute('data-tone', 'live');
    await expect(first.getByTestId('moment-when')).toHaveText('80′');
    await expect(first.getByTestId('moment-score')).toHaveText(['1', '0']);
    await expect(first.getByTestId('moment-model')).toContainText(
      'Brentford lead; before kick-off the model gave them 22%.',
    );
    await expect(first.getByTestId('moment-card')).toHaveAttribute('href', '/en/match/m1');
    // The first card in saffron, the rest in the hairline.
    const edge = (i: number) =>
      shown(page)
        .nth(i)
        .getByTestId('moment-card')
        .evaluate((link) => getComputedStyle(link).borderTopColor);
    expect(await edge(0)).toBe('rgb(235, 165, 60)');
    expect(await edge(1)).not.toBe(await edge(0));
    // The match still to start has no goals; the one with no forecast no model line.
    await expect(shown(page).nth(2).getByTestId('moment-score')).toHaveCount(0);
    await expect(shown(page).nth(3).getByTestId('moment-model')).toHaveCount(0);
    await expect(shown(page).nth(3).getByTestId('moment-eyebrow')).toContainText(
      /Starts in 1[78] min/,
    );
  });

  test('opens a hover card on a rest, floating, and Esc closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/en/scores');
    const rail = page.getByTestId('moments-rail');
    const before = (await rail.boundingBox())!;
    const main = (await page.locator('main').boundingBox())!;
    await shown(page).first().getByTestId('moment-card').hover();
    const panel = page.getByTestId('moment-panel');
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeVisible();
    // Nothing on the page moved: it floats over it.
    expect(await rail.boundingBox()).toEqual(before);
    expect(await page.locator('main').boundingBox()).toEqual(main);
    expect(await noSidewaysScroll(page)).toBe(0);
    // Under its card.
    const card = (await shown(page).first().getByTestId('moment-card').boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(box.width).toBeGreaterThan(340);

    await expect(panel).toContainText('Premier League · Matchweek 9');
    await expect(panel.locator('[data-live-badge]')).toContainText('80′');
    await expect(panel).toContainText(
      'Before kick-off the model gave Brentford 22%, the draw 25%, Liverpool 53%.',
    );
    await expect(panel.getByTestId('moment-panel-receipt')).toContainText(
      /dixon-coles-elo@0\.6\.0\s*·\s*last version before kick-off\s*·/,
    );
    await expect(panel.getByTestId('moment-panel-open')).toHaveAttribute('href', '/en/match/m1');
    // A guest is offered nothing to follow.
    await expect(panel.getByTestId('moment-panel-follow')).toHaveCount(0);
    await expect(panel.getByTestId('moment-panel-stamp')).toContainText('Updated');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // Leaving for another card opens that one's.
    await shown(page).nth(1).getByTestId('moment-card').hover();
    await expect(shown(page).nth(1).getByTestId('moment-panel')).toBeVisible();
    await page.mouse.move(640, 700);
    await expect(page.getByTestId('moment-panel')).toHaveCount(0);
  });

  test('opens on the keyboard, and Tab walks through it and on, never trapped', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/en/scores');
    await page.getByTestId('moments-leagues').focus();
    await page.keyboard.press('Tab');
    const first = shown(page).first();
    await expect(first.getByTestId('moment-card')).toBeFocused();
    await expect(first.getByTestId('moment-panel')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(first.getByTestId('moment-panel-open')).toBeFocused();
    await page.keyboard.press('Tab');
    const second = shown(page).nth(1);
    await expect(second.getByTestId('moment-card')).toBeFocused();
    await expect(first.getByTestId('moment-panel')).toHaveCount(0);
    await expect(second.getByTestId('moment-panel')).toBeVisible();
    // Esc closes it, and it stays closed while the focus stays.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('moment-panel')).toHaveCount(0);
    await expect(second.getByTestId('moment-card')).toBeFocused();
    // Back to the first card, whose hover card opens again for the keyboard.
    await page.keyboard.press('Shift+Tab');
    await expect(first.getByTestId('moment-card')).toBeFocused();
    await expect(first.getByTestId('moment-panel')).toBeVisible();
  });

  for (const [locale, words, live, moreText] of [
    ['fa', 'خلاف پیش‌بینی', '۳ زنده', '۲ بازی دیگر→'],
    ['x-rtl', 'Against the forecast', '3 live', '2 more→'],
  ] as const) {
    test(`mirrors on /${locale}: the first card at the right, the time at its left`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, `/${locale}/scores`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('moments-live')).toHaveText(live);
      await expect(more(page)).toHaveText(moreText);
      const first = shown(page).first();
      await expect(first.getByTestId('moment-eyebrow')).toContainText(words);
      const a = (await shown(page).nth(0).boundingBox())!;
      const b = (await shown(page).nth(1).boundingBox())!;
      expect(a.x).toBeGreaterThan(b.x);
      const lead = (await page.getByTestId('moments-lead').boundingBox())!;
      expect(lead.x).toBeGreaterThan(a.x);
      const when = (await first.getByTestId('moment-when').boundingBox())!;
      const eyebrow = (await first.getByTestId('moment-eyebrow').boundingBox())!;
      expect(when.x).toBeLessThan(eyebrow.x + eyebrow.width / 2);
      if (locale === 'fa') await expect(first.getByTestId('moment-when')).toHaveText('۸۰′');
      expect(await noSidewaysScroll(page)).toBe(0);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`passes axe in the ${theme} theme, a hover card open`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'fmip_theme', value: theme, url: baseURL! }]);
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, '/en/scores');
      await shown(page).first().getByTestId('moment-card').hover();
      await expect(page.getByTestId('moment-panel')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .include('[data-testid="moments-rail"]')
        .withTags(TAGS)
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
      ).toEqual([]);
    });
  }

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the cards scroll sideways and snap, a tap opens the match, and no hover card', async ({
      page,
    }) => {
      await open(page, '/en/scores');
      await expect(page.getByTestId('moments-live')).toBeVisible();
      await expect(page.getByTestId('moments-picked')).toBeHidden();
      await expect(page.getByTestId('moments-leagues')).toBeHidden();
      await expect(more(page)).toHaveCount(0);
      const cards = page.getByTestId('moments-cards');
      expect(await cards.evaluate((list) => getComputedStyle(list).scrollSnapType)).toBe(
        'inline mandatory',
      );
      expect(await cards.evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true);
      await expect(page.locator('[data-testid="moment"]')).toHaveCount(6);
      expect(await noSidewaysScroll(page)).toBe(0);
      for (const height of await page
        .getByTestId('moment-card')
        .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) {
        expect(height).toBeGreaterThanOrEqual(44);
      }
      await cards.evaluate((list) => list.scrollBy({ left: 600 }));
      await expect.poll(() => cards.evaluate((list) => list.scrollLeft)).toBeGreaterThan(0);

      const second = page.locator('[data-moment="m2"]').getByTestId('moment-card');
      await second.scrollIntoViewIfNeeded();
      await second.tap();
      await expect(page).toHaveURL(/\/en\/match\/m2$/);
      await expect(page.getByTestId('moment-panel')).toHaveCount(0);
    });
  });
});
