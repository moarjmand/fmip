import type {
  PredictionHistoryResponse,
  ScoreCard as ScoreCardData,
  ScoresResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The matches page rendered whole, with the API mocked (T-1964, D-467):
 * where `/welcome` leaves a new account, "Not picked yet", the first-pick
 * card with «پیش‌بینی کن» / "Make a prediction" until the first prediction
 * and on that view only; the line to the next day with a match when nothing
 * on the day is still open; and a member's view chips on a line of their own
 * on a phone, so none is cut.
 */

const TODAY = '2026-11-27';
const NOW = `${TODAY}T18:00:00.000Z`;
const OPEN = '00000000-0000-4000-8000-000000001964';

const card = (over: Partial<ScoreCardData> = {}): ScoreCardData => ({
  id: OPEN,
  kickoff_at: `${TODAY}T20:00:00.000Z`,
  status: 'scheduled',
  minute: null,
  competition: { id: 'c', name: 'Premier League', short_name: null, country_id: 'gb' },
  season: { id: 's', label: '2026/27' },
  stage: null,
  round: null,
  leg: null,
  home: { id: 'h', name: 'Liverpool', short_name: null, code: 'LIV' },
  away: { id: 'a', name: 'Manchester United', short_name: null, code: 'MUN' },
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
  venue: null,
  coverage: 'available',
  last_updated_at: NOW,
  freshness: null,
  pinned: false,
  ...over,
});

const day = (cards: ScoreCardData[]): ScoresResponse =>
  ({
    filters: {},
    generated_at: NOW,
    total: cards.length,
    pinned: [],
    groups:
      cards.length === 0
        ? []
        : [
            {
              country: { id: 'gb', name: 'England', code: 'ENG' },
              competition: { id: 'c', name: 'Premier League', short_name: null },
              fixtures: cards,
            },
          ],
  }) as unknown as ScoresResponse;

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data, setCookie: null });
const down = { ok: false as const, status: 503, error: null, setCookie: null };
const history = (total: number) =>
  ok({
    kind: 'visible',
    username: 'newbie',
    is_self: true,
    total,
    limit: 50,
    offset: 0,
    items: [],
  } as unknown as PredictionHistoryResponse);

let today: ScoresResponse = day([card()]);
const ahead = day([card({ id: 'later', kickoff_at: '2026-11-29T15:00:00.000Z' })]);

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  fetchScores: vi.fn(),
  fetchMyPredictions: vi.fn(),
  fetchIngestionHealth: vi.fn(async () => null),
  fetchFounderFeed: vi.fn(),
  fetchForecastSummaries: vi.fn(),
  fetchConsensusList: vi.fn(),
  fetchViewingBatch: vi.fn(),
  fetchOwnPrediction: vi.fn(async () => null),
  fetchPendingPick: vi.fn(async () => null),
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...api,
}));
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => 'fmip_session=x' }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'UTC', chosen: true }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/scores',
  useSearchParams: () => new URLSearchParams('unpicked=1'),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error('not found');
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { default: ScoresPage } = await import('./page');

const MEMBER = {
  id: 'u',
  username: 'newbie',
  display_name: 'newbie',
  email_verified: false,
  timezone: 'UTC',
  preferred_language: 'en',
};

async function render(query: Record<string, string>, locale = 'en'): Promise<string> {
  const element = await ScoresPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.clearAllMocks();
  today = day([card()]);
  api.fetchMe.mockResolvedValue(MEMBER);
  api.fetchScores.mockImplementation(async (query: string) =>
    ok(new URLSearchParams(query).get('from') === TODAY ? today : ahead),
  );
  api.fetchMyPredictions.mockResolvedValue(history(0));
  api.fetchFounderFeed.mockResolvedValue(down);
  api.fetchForecastSummaries.mockResolvedValue(down);
  api.fetchConsensusList.mockResolvedValue(down);
  api.fetchViewingBatch.mockResolvedValue(down);
});
afterEach(() => {
  vi.useRealTimers();
});

/** The opening tag of the element with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

describe('a new member on "Not picked yet"', () => {
  it('meets one card above the list, its action opening the first open match’s pick', async () => {
    const html = await render({ unpicked: '1' });
    expect(html).toContain('data-testid="first-pick"');
    expect(html.indexOf('data-testid="first-pick"')).toBeLessThan(
      html.indexOf('data-testid="filter-row"'),
    );
    // On a phone, the match's sheet.
    const phone = tag(html, 'first-pick-action');
    expect(phone).toContain(`href="/en/scores?unpicked=1&amp;pick=${OPEN}#m-${OPEN}"`);
    expect(phone).toContain('lg:hidden');
    // On a desktop, the side column that already holds that pick, outlined as the target.
    const desk = tag(html, 'first-pick-beside');
    expect(desk).toContain('href="#pick"');
    expect(desk).toContain('max-lg:hidden');
    expect(tag(html, 'match-preview')).toContain('id="pick"');
    expect(tag(html, 'match-preview')).toContain('lg:target:outline-2');
    expect(tag(html, 'match-preview')).toContain(`data-fixture-id="${OPEN}"`);
    expect(html).toContain('>Make a prediction<');
    expect(html).toContain('The model’s forecast, when it has one, is shown beside your pick');
  });

  it('is in Persian on /fa: «پیش‌بینی کن»', async () => {
    const html = await render({ unpicked: '1' }, 'fa');
    expect(html).toContain('>نخستین پیش‌بینی شما<');
    expect(html).toContain('>پیش‌بینی کن<');
    expect(html).toContain('پیش‌بینی مدل، اگر داشته باشد،');
  });

  it('is not on the other views, nor after the first prediction, nor for a guest', async () => {
    expect(await render({})).not.toContain('first-pick');
    expect(await render({ favourites: '1' })).not.toContain('first-pick');
    api.fetchMyPredictions.mockResolvedValue(history(1));
    expect(await render({ unpicked: '1' })).not.toContain('first-pick');
    api.fetchMyPredictions.mockResolvedValue(history(0));
    api.fetchMe.mockResolvedValue(null);
    expect(await render({ unpicked: '1' })).not.toContain('first-pick');
  });

  it('is not beside a pick already waiting for the e-mail confirmation', async () => {
    api.fetchPendingPick.mockResolvedValueOnce({ outcome: 'home', status: 'pending' } as never);
    expect(await render({ unpicked: '1' })).not.toContain('first-pick');
  });
});

describe('a day with nothing left to pick on "Not picked yet"', () => {
  it('points at the next day with a match when every match has kicked off', async () => {
    today = day([card({ status: 'finished', kickoff_at: `${TODAY}T12:00:00.000Z` })]);
    const html = await render({ unpicked: '1' });
    expect(html).toContain('data-testid="scores-next-day"');
    expect(html).toContain('href="/en/scores?date=2026-11-29&amp;unpicked=1"');
    expect(html).not.toContain('first-pick');
  });

  it('and when the day has no match at all', async () => {
    today = day([]);
    expect(await render({ unpicked: '1' })).toContain('data-testid="scores-next-day"');
  });

  it('does not while a match of the day is still open', async () => {
    expect(await render({ unpicked: '1' })).not.toContain('scores-next-day');
  });
});

describe('the view chips on a phone', () => {
  it('take a line of their own for a member, so none is cut; a guest’s stay beside Date', async () => {
    const member = tag(await render({ unpicked: '1' }), 'filters');
    expect(member).toContain('basis-full flex-wrap');
    expect(member).toContain('sm:basis-0 sm:flex-nowrap sm:overflow-x-auto');
    api.fetchMe.mockResolvedValue(null);
    const guest = tag(await render({}), 'filters');
    expect(guest).toContain('basis-0 overflow-x-auto');
    expect(guest).not.toContain('basis-full');
  });
});
