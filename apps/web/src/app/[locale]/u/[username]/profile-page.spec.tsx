import type {
  AchievementsResponse,
  PredictionHistoryResponse,
  ProfileView,
  Rating,
  RatingHistoryResponse,
  RatingResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A new member's profile (T-1787, D-390; board P7-6), rendered whole with the
 * API mocked: the member's own "Your first steps" until there is a settled
 * pick and the three steps are done, the empty sections as one-line state
 * rows, and for a visitor the bar under a missing or provisional rating, no
 * empty bio and no empty favourites. The floor is the API's, never typed.
 */

const api = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  fetchFriendStatus: vi.fn(),
  fetchMe: vi.fn(),
  fetchRating: vi.fn(),
  fetchPredictionHistory: vi.fn(),
  fetchRatingHistory: vi.fn(),
  fetchAchievements: vi.fn(),
  fetchFollowing: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => 'fmip_session=x' }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'UTC' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  usePathname: () => '/en/u/new_member',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

// The feedback link's request scope (T-1965): asked for before the variable is read.
vi.mock('next/server', () => ({ connection: async () => undefined }));

const { default: ProfilePage } = await import('./page');

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const NAME = 'new_member';

function profile(over: {
  is_self: boolean;
  bio?: string | null;
  favourites?: string[];
}): ProfileView {
  return {
    kind: 'visible',
    is_self: over.is_self,
    profile: {
      username: NAME,
      display_name: null,
      bio: over.bio ?? null,
      avatar_url: null,
      country_id: null,
      member_since: '2026-11-08',
      favourite_teams: over.favourites ?? [],
    },
  } as unknown as ProfileView;
}

function rating(settled: number | null, floor = 30): RatingResponse {
  const r: Rating | null =
    settled === null
      ? null
      : {
          username: NAME,
          rating: 52.4,
          tier: 'silver',
          provisional: settled < 30,
          established: settled >= 50,
          settled_count: settled,
          components: { result: 0.5, exact_score: 0.1, consistency: 0.5, confidence: 0.5 },
          formula_version: 'performance-rating@1.0.0',
          computed_at: '2026-11-08T10:00:00.000Z',
        };
  return { username: NAME, rating: r, floor };
}

const EMPTY_HISTORY = {
  kind: 'visible',
  username: NAME,
  items: [],
  total: 0,
} as unknown as PredictionHistoryResponse;
const NO_RATING_HISTORY = {
  kind: 'visible',
  username: NAME,
  is_self: true,
  history: null,
} as unknown as RatingHistoryResponse;
const NO_ACHIEVEMENTS = {
  kind: 'visible',
  username: NAME,
  is_self: true,
  achievements: { earned: [] },
} as unknown as AchievementsResponse;

async function render(locale = 'en'): Promise<string> {
  const element = await ProfilePage({
    params: Promise.resolve({ locale, username: NAME }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element);
}

/** A brand-new member on their own page: nothing read is anything yet. */
function newMember(): void {
  api.fetchProfile.mockResolvedValue(ok(profile({ is_self: true })));
  api.fetchFriendStatus.mockResolvedValue('self');
  api.fetchMe.mockResolvedValue(null);
  api.fetchRating.mockResolvedValue(ok(rating(null)));
  api.fetchPredictionHistory.mockResolvedValue(ok(EMPTY_HISTORY));
  api.fetchRatingHistory.mockResolvedValue(ok(NO_RATING_HISTORY));
  api.fetchAchievements.mockResolvedValue(ok(NO_ACHIEVEMENTS));
  api.fetchFollowing.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  newMember();
  vi.stubEnv('SITE_CONTACT_EMAIL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const row = (html: string, testId: string): string =>
  new RegExp(`<section[^>]*data-testid="${testId}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';

describe('the member’s own page', () => {
  it('opens with "Your first steps" and the bar at 0 of the floor the API sent', async () => {
    const html = await render();
    expect(html).toContain('data-testid="first-steps"');
    expect(html.indexOf('first-steps')).toBeLessThan(html.indexOf('invite-link'));
    expect(html).toContain('>0 of 30<');
    expect(html).toContain('href="/en/scores?unpicked=1"');
    expect(html).toContain('href="/en/welcome?step=teams&amp;next=%2Fen%2Fu%2Fnew_member"');
    expect(html).toContain('href="/en/settings"');
    expect(html).toContain('href="/en/about#about-rating"');
  });

  it('takes the floor from the rating response, never a typed 30', async () => {
    api.fetchRating.mockResolvedValue(ok(rating(null, 25)));
    expect(await render()).toContain('>0 of 25<');
  });

  it('draws every empty section as a one-line row with its state word, and no empty bio', async () => {
    const html = await render();
    for (const [testId, words] of [
      ['favourites-none', 'None yet'],
      ['rating-none', 'Not rated yet'],
      ['rating-history-none', 'None yet'],
      ['achievements-none', 'None yet'],
      ['history-empty', 'None yet'],
    ] as const) {
      const found = row(html, testId);
      expect(found, testId).toContain('data-folded=""');
      expect(/<summary[\s\S]*?<\/summary>/.exec(found)?.[0], testId).toContain(words);
    }
    expect(html).not.toContain('No biography yet.');
    // The notification's anchor survives the fold.
    expect(html).toContain('id="achievements"');
  });

  it('ticks what is done and keeps the card until a settled pick and the three steps', async () => {
    api.fetchProfile.mockResolvedValue(ok(profile({ is_self: true, bio: 'Weekend picks.' })));
    api.fetchFollowing.mockResolvedValue([
      {
        entity_type: 'team',
        entity_id: 't',
        name: 'Liverpool',
        favourite: false,
        followed_at: '2026-11-08T00:00:00Z',
      },
    ]);
    api.fetchPredictionHistory.mockResolvedValue(ok({ ...EMPTY_HISTORY, total: 2 }));
    let html = await render();
    expect(html).toContain('data-testid="first-steps"');
    expect(html.match(/data-done=""/g)).toHaveLength(3);
    // The first settled pick: the card goes, and the bar moves under the rating.
    api.fetchRating.mockResolvedValue(ok(rating(1)));
    html = await render();
    expect(html).not.toContain('data-testid="first-steps"');
    expect(html).toContain('>Your settled picks<');
    expect(html).toContain('>1 of 30<');
  });

  it('keeps the card for a rated member with a step to do, but no "34 of 30" (B1)', async () => {
    // At or past the floor the card shows the steps alone: the count is the
    // formula's window, so "N of 30" is no longer true there.
    api.fetchRating.mockResolvedValue(ok(rating(34)));
    let html = await render();
    expect(html).toContain('data-testid="first-steps"');
    expect(html).not.toContain('data-testid="first-step-bio" data-done');
    expect(html).not.toContain('settled-progress');
    expect(html).not.toContain(' of 30<');
    expect(html).toContain('How ratings work');
    expect(html).toContain('data-testid="rating-value"');
    // 120 settled: `settled_count` is the window, 100 -- never "100 of 30".
    api.fetchRating.mockResolvedValue(ok(rating(100)));
    html = await render();
    expect(html).toContain('data-testid="first-steps"');
    expect(html).not.toContain('settled-progress');
    expect(html).not.toMatch(/>\d+ of 30</);
  });

  it('has no bar when the rating could not be read', async () => {
    api.fetchRating.mockResolvedValue({ ok: false, status: 503 });
    const html = await render();
    expect(html).toContain('data-testid="first-steps"');
    expect(html).not.toContain('data-testid="settled-progress"');
  });

  it('offers "Send feedback" to the contact mailbox when there is one, and nothing when not (T-1965)', async () => {
    expect(await render()).not.toContain('feedback');
    vi.stubEnv('SITE_CONTACT_EMAIL', 'feedback@example.test');
    const html = await render();
    expect(html).toContain('data-testid="profile-feedback-line"');
    const subject = encodeURIComponent('Feedback on Stadiomind, from /en/u/new_member');
    expect(html).toContain(`href="mailto:feedback@example.test?subject=${subject}"`);
    expect(html).toContain('>Send feedback</a>');
    expect(await render('fa')).toContain('>ارسال بازخورد</a>');
  });

  it('is in Persian on /fa, names in bdi', async () => {
    const html = await render('fa');
    expect(html).toContain('گام‌های نخست شما');
    expect(html).toContain('۰ از ۳۰');
    expect(html).toContain('هنوز نیست');
    // The name is isolated by MemberName itself, with no outer isolate (T-1977).
    expect(html).toMatch(
      /<h1[^>]*data-testid="profile-name"><span><bdi dir="ltr">@new_member<\/bdi><\/span><\/h1>/,
    );
    // The handle is its own left-to-right isolate too (T-1975), inside a line
    // that keeps the page's direction, so it sits at the start of it (T-1977).
    expect(html).toContain(
      '<span class="text-muted wrap-anywhere" data-testid="profile-handle"><bdi dir="ltr">@new_member</bdi></span>',
    );
    expect(html).not.toMatch(/<bdi>\s*<span[^>]*data-testid="profile-handle"/);
  });
});

describe('the member’s own header with a long name (T-1977)', () => {
  // Thirty characters with nowhere to break: longer than the API lets a
  // username be (20), so the header holds whatever a name or handle can be.
  const LONG = 'abcdefghijklmnopqrstuvwxyz_123';

  const header = (html: string): string => /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  /** The opening tag of the element with this test id. */
  const tag = (html: string, testId: string): string =>
    new RegExp(`<[a-z0-9]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

  for (const [locale, edit] of [
    ['en', 'Edit profile'],
    ['fa', 'ویرایش نمایه'],
  ] as const) {
    it(`lets the name and the handle wrap and keeps "${edit}" whole on /${locale}`, async () => {
      const own = profile({ is_self: true }) as Extract<ProfileView, { kind: 'visible' }>;
      api.fetchProfile.mockResolvedValue(
        ok({ ...own, profile: { ...own.profile, username: LONG, display_name: null } }),
      );
      const html = header(await render(locale));
      expect(LONG).toHaveLength(30);
      // The column may shrink below its longest word; the name and the handle
      // break inside a word rather than push the link out.
      expect(html).toMatch(/<div class="flex min-w-0 flex-1 flex-col gap-1">/);
      expect(tag(html, 'profile-name')).toMatch(/class="[^"]* wrap-anywhere[ "]/);
      expect(tag(html, 'profile-handle')).toMatch(/class="[^"]* wrap-anywhere[ "]/);
      // The link keeps its size.
      expect(tag(html, 'profile-edit')).toMatch(/class="[^"]* shrink-0[ "]/);
      expect(html).toContain(`>${edit}</a>`);
      // `@name`, left to right, in a line of the page's direction.
      expect(html).toContain(
        `<span class="text-muted wrap-anywhere" data-testid="profile-handle"><bdi dir="ltr">@${LONG}</bdi></span>`,
      );
      expect(html).not.toMatch(/<bdi>\s*<span[^>]*data-testid="profile-handle"/);
    });
  }
});

describe('a visitor', () => {
  beforeEach(() => {
    api.fetchProfile.mockResolvedValue(ok(profile({ is_self: false })));
    api.fetchFriendStatus.mockResolvedValue(null);
  });

  it('sees no steps, no empty bio and no empty favourites', async () => {
    const html = await render();
    expect(html).not.toContain('first-steps');
    expect(html).not.toContain('No biography yet.');
    expect(html).not.toContain('favourites-none');
    expect(html).not.toContain('Favourite teams');
    expect(api.fetchFollowing).not.toHaveBeenCalled();
  });

  it('sees a never-rated member as "Not rated yet" with the bar at 0', async () => {
    const html = await render();
    const section = /<section[^>]*data-testid="rating"[\s\S]*?<\/section>/.exec(html)![0];
    expect(section).toContain('Not rated yet: a rating starts with the first settled prediction.');
    expect(section).toContain('>Settled picks<');
    expect(section).toContain('>0 of 30<');
    expect(section).toContain('No settled picks yet. A rating starts with the first.');
    expect(section).toContain('href="/en/about#about-rating"');
  });

  it('sees a provisional rating’s four facts and the bar under them', async () => {
    api.fetchRating.mockResolvedValue(ok(rating(7)));
    const html = await render();
    const section = /<section[^>]*data-testid="rating"[\s\S]*?<\/section>/.exec(html)![0];
    expect(section).toContain('data-testid="rating-value"');
    expect(section.indexOf('rating-value')).toBeLessThan(section.indexOf('settled-progress'));
    expect(section).toContain('>7 of 30<');
    expect(section).toContain('Not on the leaderboard yet: it joins from 30.');
    // The floor is the board's rule, not the console's provisional count.
    expect(section).not.toMatch(/provisional until/i);
  });

  it('sees no bar from the floor on', async () => {
    api.fetchRating.mockResolvedValue(ok(rating(30)));
    expect(await render()).not.toContain('settled-progress');
  });

  it('sees no feedback link: it is on the member’s own page only (T-1965)', async () => {
    vi.stubEnv('SITE_CONTACT_EMAIL', 'feedback@example.test');
    expect(await render()).not.toContain('feedback');
  });

  it('sees favourites with names in bdi, as before', async () => {
    api.fetchProfile.mockResolvedValue(
      ok(profile({ is_self: false, favourites: ['Liverpool'], bio: 'Hi' })),
    );
    const html = await render();
    expect(html).toContain('<bdi>Liverpool</bdi>');
    expect(html).toContain('data-testid="profile-bio"');
  });

  it('sees a restricted profile exactly as before: no bar, nothing new', async () => {
    api.fetchProfile.mockResolvedValue(
      ok({ kind: 'restricted', username: NAME, display_name: 'New member', visibility: 'private' }),
    );
    const html = await render();
    expect(html).toContain('data-testid="profile-restricted"');
    expect(html).not.toContain('settled-progress');
    expect(html).not.toContain('first-steps');
    expect(api.fetchRating).not.toHaveBeenCalled();
  });
});
