import type { MatchViewing, ScoreCard, ScoresResponse, ViewingOption } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Watch page rebuilt with the matches page's pieces (T-1792, D-394;
 * board P8-7): the day strip, the competition blocks and the rows are the
 * matches page's own; the territory is asked once at the top; each row's end
 * cell carries the viewing answer in words (rule 3), never the model's bar;
 * and the page closes on when its list was loaded and since when its
 * listings were confirmed (rule 4).
 */

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  fetchScores: vi.fn(),
  fetchTerritories: vi.fn(),
  fetchViewingBatch: vi.fn(),
  fetchViewingTerritory: vi.fn(),
}));
const session = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => session.cookie }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'UTC' }),
}));

const { default: WatchPage } = await import('./page');

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const DOWN = { ok: false as const, status: 0, error: null, setCookie: null };
const GB = { code: 'GB', name: 'United Kingdom' };
const LISTED = '00000000-0000-4000-8000-000000000001';
const UNCOVERED = '00000000-0000-4000-8000-000000000002';
const NOTHING = '00000000-0000-4000-8000-000000000003';
const CONFIRMED = '2026-11-09T08:15:00.000Z';

const card = (id: string, home: string, away: string): ScoreCard =>
  ({
    id,
    kickoff_at: '2026-11-09T15:00:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'pl', name: 'Premier League', short_name: null, country_id: 'en' },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: `${id}h`, name: home, short_name: null, code: null },
    away: { id: `${id}a`, name: away, short_name: null, code: null },
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
    last_updated_at: '2026-11-09T11:59:00.000Z',
    freshness: null,
    pinned: false,
  }) as ScoreCard;

const scores = (): ScoresResponse =>
  ({
    filters: {},
    generated_at: '2026-11-09T12:00:00.000Z',
    total: 3,
    pinned: [],
    groups: [
      {
        competition: { id: 'pl', name: 'Premier League' },
        country: { id: 'en', name: 'England' },
        fixtures: [
          card(LISTED, 'Crystal Palace', 'Liverpool'),
          card(UNCOVERED, 'Brighton', 'Brentford'),
          card(NOTHING, 'Ipswich', 'Bournemouth'),
        ],
      },
    ],
  }) as unknown as ScoresResponse;

const option = (id: string, name: string): ViewingOption =>
  ({
    id,
    broadcaster: { id: name, name, homepage_url: null, kind: 'tv' },
    access: 'subscription',
    url: `https://example.test/${id}`,
    territory: 'GB',
    source: { id: 'desk', name: 'Editorial desk', rights: 'link' },
    from_default: false,
    last_updated_at: CONFIRMED,
  }) as unknown as ViewingOption;

const none = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

function answer(fixture: string, chosen: boolean): MatchViewing {
  const territory = chosen
    ? { state: 'chosen' as const, territory: GB }
    : { state: 'not_chosen' as const };
  if (!chosen) return { fixture_id: fixture, territory, options: none, highlights: none };
  const options =
    fixture === LISTED
      ? {
          coverage: 'available' as const,
          last_updated_at: CONFIRMED,
          // One service listed twice (two kinds of access) is one name.
          data: [option('o1', 'Sky Sports'), option('o2', 'Sky Sports'), option('o3', 'TNT')],
        }
      : fixture === NOTHING
        ? { coverage: 'available' as const, last_updated_at: '2026-11-09T10:00:00.000Z', data: [] }
        : none;
  return { fixture_id: fixture, territory, options, highlights: none } as MatchViewing;
}

function batch(chosen: boolean) {
  return ok({
    generated_at: '2026-11-09T12:00:00.000Z',
    territory: chosen ? { state: 'chosen', territory: GB } : { state: 'not_chosen' },
    fixtures: [LISTED, UNCOVERED, NOTHING].map((id) => answer(id, chosen)),
  });
}

async function render(
  locale: 'en' | 'fa',
  over: { member?: boolean; territory?: string } = {},
): Promise<string> {
  session.cookie = over.member ? 'fmip_session=m' : undefined;
  api.fetchMe.mockResolvedValue(over.member ? { id: 'm', username: 'm' } : null);
  return renderToStaticMarkup(
    await WatchPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({
        date: '2026-11-09',
        ...(over.territory ? { territory: over.territory } : {}),
      }),
    }),
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchScores.mockResolvedValue(ok(scores()));
  api.fetchTerritories.mockResolvedValue([GB, { code: 'IR', name: 'Iran' }]);
  api.fetchViewingTerritory.mockResolvedValue(null);
  api.fetchViewingBatch.mockImplementation(async (_ids: string[], territory?: string) =>
    batch(territory === 'GB'),
  );
});

describe('the Watch page is drawn with the matches page’s pieces', () => {
  it('has the day strip of 44px chips, the competition block and one row per match', async () => {
    const html = await render('en');
    expect(html).toContain('data-testid="day-strip"');
    expect(html).toMatch(/aria-current="date"[^>]*class="[^"]*min-h-11/);
    expect(html).toContain('data-testid="competition-group"');
    expect(html).toContain('data-testid="competition-link"');
    expect(count(html, 'data-testid="score-card"')).toBe(3);
    expect(count(html, 'class="match-row"')).toBe(3);
  });

  it('never draws the model on the rows: Watch is not a forecast surface', async () => {
    const html = await render('en', { territory: 'GB' });
    expect(html).not.toContain('data-testid="row-forecast"');
    expect(html).not.toContain('data-testid="row-pick"');
    expect(html).not.toMatch(/bg-model|text-model/);
  });
});

describe('the territory, asked once', () => {
  it('asks a guest at the top, in one line and one sentence, and nowhere on the rows', async () => {
    const html = await render('en');
    expect(html).toContain('data-testid="watch-territory" data-state="not_chosen"');
    expect(html).toContain('Watching from');
    expect(html).toContain('Not chosen');
    // The existing chooser, behind a native disclosure: no script.
    expect(html).toMatch(/<details data-testid="watch-territory-choose"><summary/);
    expect(html).toContain('data-testid="viewing-territory-form"');
    expect(html).toContain('Pick a territory to see which official service shows each match.');
    expect(count(html, 'Choose your territory')).toBe(1);
    expect(count(html, 'data-state="ask"')).toBe(3);
    expect(html).not.toContain('<script');
  });

  it('sends a member to settings, without the guest’s chooser', async () => {
    api.fetchViewingBatch.mockResolvedValue(batch(true));
    const html = await render('en', { member: true });
    expect(html).toContain('href="/en/settings#territory"');
    expect(html).toContain('Change territory');
    expect(html).not.toContain('data-testid="viewing-territory-form"');
    expect(html).toContain('United Kingdom');
  });
});

describe('each row’s answer, in words (rule 3)', () => {
  it('names the services, says not covered and nothing listed apart', async () => {
    const html = await render('en', { territory: 'GB' });
    expect(html).toContain('data-testid="watch-territory" data-state="chosen"');
    expect(html).toContain('Official services in your territory, from the editors’ list.');
    expect(html).toContain('Official: Sky Sports, TNT');
    expect(count(html, 'Sky Sports')).toBe(1);
    expect(html).toContain('data-state="not_supplied"');
    expect(html).toContain('Not covered in your territory');
    expect(html).toContain('data-state="nothing_listed"');
    expect(html).toContain('No official service listed');
  });

  it('keeps a guest’s territory on the match links and the day strip', async () => {
    const html = await render('en', { territory: 'GB' });
    expect(html).toContain(`href="/en/match/${LISTED}?territory=GB"`);
    expect(html).toContain('href="/en/watch?date=2026-11-10&amp;territory=GB"');
  });

  it('says the viewing service could not be reached, once, and on each row', async () => {
    api.fetchViewingBatch.mockResolvedValue(DOWN);
    const html = await render('en', { territory: 'GB' });
    expect(count(html, 'data-testid="watch-viewing-unreachable"')).toBe(1);
    expect(count(html, 'data-state="not_loaded"')).toBe(3);
    expect(html).toContain('Viewing not loaded');
  });

  it('says the matches could not be loaded, rather than an empty day', async () => {
    api.fetchScores.mockResolvedValue(DOWN);
    const html = await render('en');
    expect(html).toContain('data-testid="watch-unreachable"');
    expect(html).not.toContain('data-testid="watch-empty"');
  });
});

describe('freshness (rule 4)', () => {
  it('says when the list was loaded and since when every listing was confirmed', async () => {
    const html = await render('en', { territory: 'GB' });
    expect(html).toContain('data-testid="watch-freshness"');
    expect(html).toContain('dateTime="2026-11-09T12:00:00.000Z"');
    // The oldest confirmation shown, so no older listing sits under a newer time.
    expect(html).toContain('Every listing here confirmed since');
    expect(html).toContain('dateTime="2026-11-09T08:15:00.000Z"');
  });

  it('claims no confirmation before a territory is chosen', async () => {
    const html = await render('en');
    expect(html).toContain('data-testid="watch-freshness"');
    expect(html).not.toContain('Every listing here confirmed since');
  });
});

describe('the Persian page', () => {
  it('is in Persian words, with logical sides only', async () => {
    const html = await render('fa', { territory: 'GB' });
    expect(html).toContain('تماشا از');
    expect(html).toContain('در قلمرو شما پوشش داده نشده');
    expect(html).toContain('رسمی: ');
    expect(html).not.toMatch(/class="[^"]*\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});
