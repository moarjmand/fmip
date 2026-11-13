import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The founder's desk at its direct address (T-1791, D-393; board P8-6): the
 * writing form only for a session the API would let publish -- the
 * publish's own gate, asked through `fetchFounderDesk` -- and for a guest or
 * a member a short page saying what the founder's analysis is and where the
 * published ones are read, with no sign-in prompt. Never indexed, never in
 * the sitemap.
 */

const api = vi.hoisted(() => ({
  fetchMatchCentre: vi.fn(),
  fetchFounderDesk: vi.fn(),
  fetchFounderAnalysis: vi.fn(),
  fetchCompetitions: vi.fn(),
  fetchTeams: vi.fn(),
}));
const session = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => session.cookie }));
vi.mock('@/lib/founder-actions', () => ({ publishAnalysisAction: async () => ({}) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  usePathname: () => '/en/founder/x',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { default: DeskPage, generateMetadata } = await import('./page');
const { default: sitemap } = await import('../../../sitemap');

const ID = '00000000-0000-4000-8000-000000001791';
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

function match() {
  return ok({
    fixture: {
      id: ID,
      status: 'scheduled',
      kickoff_at: '2099-11-08T18:30:00.000Z',
      home: { id: 'h', name: 'Hoffenheim' },
      away: { id: 'a', name: 'Schalke 04' },
      competition: { id: 'c', name: 'Bundesliga' },
    },
  });
}

async function render(locale: 'en' | 'fa', who: 'guest' | 'member' | 'founder'): Promise<string> {
  session.cookie = who === 'guest' ? undefined : `fmip_session=${who}`;
  api.fetchFounderDesk.mockResolvedValue(who === 'founder');
  return renderToStaticMarkup(
    await DeskPage({ params: Promise.resolve({ locale, fixtureId: ID }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchMatchCentre.mockResolvedValue(match());
  api.fetchFounderAnalysis.mockResolvedValue(ok({ analysis: null }));
});

describe('the desk to someone without the founder role', () => {
  it.each(['guest', 'member'] as const)(
    'gives a %s the short page: no form, no sign-in prompt',
    async (who) => {
      const html = await render('en', who);
      expect(html).toContain('data-testid="founder-gate"');
      expect(html).not.toContain('data-testid="founder-form"');
      expect(html).not.toContain('<form');
      expect(html).not.toMatch(/sign in|signed in|\/login/i);
      // The match it was asked about, and where to go instead.
      expect(html).toContain('Hoffenheim');
      expect(html).toContain('This desk is for the founder.');
      expect(html).toContain('href="/en/match/' + ID + '"');
      expect(html).toContain('href="/en/scores#analysis"');
      // The analysis itself is not even asked for.
      expect(api.fetchFounderAnalysis).not.toHaveBeenCalled();
    },
  );

  it('asks the API with the session, and a guest is asked with none', async () => {
    await render('en', 'guest');
    expect(api.fetchFounderDesk).toHaveBeenCalledWith(ID, undefined);
    await render('en', 'member');
    expect(api.fetchFounderDesk).toHaveBeenLastCalledWith(ID, 'fmip_session=member');
  });

  it('names the three products apart (rule 6) and draws no forecast', async () => {
    const html = await render('en', 'member');
    expect(html).toContain('statistical model');
    expect(html).toContain('never mixed');
    expect(html).not.toMatch(/data-voice=|bg-model|bg-community|%/);
  });

  it('is Persian on /fa, its edge and buttons by logical sides', async () => {
    const html = await render('fa', 'guest');
    expect(html).toContain('این میز مخصوص بنیان‌گذار است.');
    expect(html).toContain('href="/fa/scores#analysis"');
    expect(html).toContain('border-s-4');
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });

  it('still says the match is missing with a 404', async () => {
    api.fetchMatchCentre.mockResolvedValue({ ok: false, status: 404, error: null });
    await expect(render('en', 'member')).rejects.toThrow('not found');
  });
});

describe('the desk to the founder', () => {
  it('draws the form, as before', async () => {
    const html = await render('en', 'founder');
    expect(html).toContain('data-testid="founder-form"');
    expect(html).not.toContain('data-testid="founder-gate"');
    expect(api.fetchFounderAnalysis).toHaveBeenCalledWith(ID);
  });

  it('keeps the kick-off wall once the match has started', async () => {
    api.fetchMatchCentre.mockResolvedValue(
      ok({ fixture: { ...match().data.fixture, status: 'live' } }),
    );
    const html = await render('en', 'founder');
    expect(html).toContain('data-testid="founder-locked"');
    expect(html).not.toContain('data-testid="founder-form"');
  });
});

describe('the desk and search engines', () => {
  it('is never indexed', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('is not in the sitemap', async () => {
    api.fetchCompetitions.mockResolvedValue([]);
    api.fetchTeams.mockResolvedValue([]);
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes('/founder'))).toBe(false);
  });
});
