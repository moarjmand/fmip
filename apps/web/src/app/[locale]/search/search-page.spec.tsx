import { NO_MEDIA, type CompetitionDirectoryEntry, type SearchResult } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The search page (T-1803, D-401): a team's second line says where it plays,
 * kinds with no hit are one line, nothing anywhere is one heading and the big
 * five, the empty page offers the site's own lists, and how the question was
 * read is no longer printed. Rendered whole with the API mocked.
 */

const api = vi.hoisted(() => ({ fetchAsk: vi.fn(), fetchSearch: vi.fn() }));
const menu = vi.hoisted(() => ({ menuAnswers: vi.fn() }));
vi.mock('@/lib/api', () => api);
vi.mock('@/components/competitions-menu', () => menu);
vi.mock('@/components/site-header', () => ({
  shellReader: async () => ({ session: null, guest: null }),
}));
vi.mock('@/lib/session', () => ({
  sessionCookieHeader: async () => undefined,
  readerAddress: async () => null,
}));

const { default: SearchPage } = await import('./page');

const team = (id: string, name: string, over: Partial<SearchResult> = {}): SearchResult => ({
  type: 'team',
  id,
  name,
  secondary: null,
  matched_on: 'name',
  alias: null,
  score: 1,
  ...over,
});

const entry = (
  id: string,
  code: string,
  order: number,
  kind: CompetitionDirectoryEntry['kind'] = 'league',
) => ({
  id,
  name: id,
  short_name: null,
  scope: 'domestic' as const,
  kind,
  country: { id: code, name: code, code },
  order,
  logo: NO_MEDIA,
  season: null,
  next_kickoff_at: null,
});

const DIRECTORY = [
  entry('Premier League', 'ENG', 1),
  entry('La Liga', 'ESP', 2),
  entry('Copa del Rey', 'ESP', 3, 'cup'),
];

function asked(results: SearchResult[], reason: string | null = 'failed') {
  return {
    ok: true,
    data: {
      question: 'q',
      interpretation: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason,
      results,
    },
  };
}

function community(stories: number) {
  return {
    ok: true,
    data: {
      query: 'q',
      types: ['story', 'group', 'member'],
      results: [],
      stories: Array.from({ length: stories }, (_, i) => ({
        story_id: `s${i}`,
        headline: `Arsenal story ${i}`,
        language: 'en',
        source_name: 'Publisher',
        url: 'https://example.test/',
        published_at: '2026-11-10T00:00:00Z',
        score: 1,
      })),
      groups: [],
      members: [],
    },
  };
}

async function render(locale: string, q?: string): Promise<string> {
  return renderToStaticMarkup(
    await SearchPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve(q === undefined ? {} : { q }),
    }),
  );
}

describe('the search page (T-1803, D-401)', () => {
  beforeEach(() => {
    api.fetchAsk.mockReset();
    api.fetchSearch.mockReset();
    menu.menuAnswers.mockResolvedValue({
      directory: DIRECTORY,
      scores: { groups: [{ competition: { id: 'Copa del Rey' }, fixtures: [{}] }] },
    });
  });

  it('offers the big five and today’s competitions on the empty page', async () => {
    const html = await render('en');
    const big = html.split('data-testid="search-big-five"')[1]?.split('</section>')[0] ?? '';
    expect(big).toContain('Big five');
    expect(big).toContain('Premier League');
    expect(big).toContain('La Liga');
    expect(big).not.toContain('Copa del Rey');
    const today = html.split('data-testid="search-today"')[1]?.split('</section>')[0] ?? '';
    expect(today).toContain('Playing today');
    expect(today).toContain('href="/en/competition/Copa del Rey"');
  });

  it('draws no "Playing today" when today could not be read, rather than an empty one', async () => {
    menu.menuAnswers.mockResolvedValue({ directory: DIRECTORY, scores: null });
    const html = await render('en');
    expect(html).toContain('search-big-five');
    expect(html).not.toContain('search-today');
  });

  it("gives each team a second line, collapses the kinds with none, and hides the search's plumbing", async () => {
    api.fetchAsk.mockResolvedValue(
      asked([
        team('a', 'Arsenal', {
          team_context: {
            league: { id: 'l', name: 'Premier League' },
            ground: { id: 'g', name: 'Emirates Stadium', city: 'London' },
          },
        }),
        team('b', 'Arsenal Tivat', { team_context: { league: null, ground: null } }),
      ]),
    );
    api.fetchSearch.mockResolvedValue(community(2));
    const html = await render('en', 'arsenal');
    expect(html).toMatch(/search-line[^>]*><span><bdi>Premier League<\/bdi>/);
    expect(html).toContain('<bdi>No league or ground on record</bdi>');
    expect(html).toMatch(/Teams<span[^>]*> · 2<\/span>/);
    expect(html).toContain('search-section-story');
    expect(html).not.toContain('search-section-competition');
    expect(html).not.toContain('search-section-group');
    expect(html).toContain('No competitions, players, groups, or members match.');
    expect(html).not.toContain('language model');
    expect(html).not.toContain('Read as');
    // The reason is still on the results, for whoever looks for it.
    expect(html).toContain('data-reason="failed"');
    expect(menu.menuAnswers).not.toHaveBeenCalled();
  });

  it('says once that nothing matches, with the big five to try', async () => {
    api.fetchAsk.mockResolvedValue(asked([], 'nothing_named'));
    api.fetchSearch.mockResolvedValue(community(0));
    const html = await render('en', 'zzqxv');
    expect(html).toContain('Nothing matches “<bdi>zzqxv</bdi>”');
    expect(html.match(/<h2/g)).toHaveLength(2); // the heading and the big five's
    expect(html).toContain('search-big-five');
    expect(html).toContain(
      'Invite-only groups and private or friends-only profiles are never listed.',
    );
    expect(html).not.toContain('search-none');
    expect(html).not.toContain('names nothing the search could look for');
  });

  it('isolates the term and the Latin names in Persian', async () => {
    api.fetchAsk.mockResolvedValue(asked([], null));
    api.fetchSearch.mockResolvedValue(community(0));
    const html = await render('fa', 'zzqxv');
    expect(html).toContain('چیزی با «<bdi>zzqxv</bdi>» پیدا نشد');
  });

  it('still says when the service is unreachable, never "nothing matches"', async () => {
    api.fetchAsk.mockResolvedValue({ ok: false, status: 503 });
    api.fetchSearch.mockResolvedValue(community(0));
    const html = await render('en', 'arsenal');
    expect(html).toContain('search-unreachable');
    expect(html).not.toContain('search-nothing');
  });
});
