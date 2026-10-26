import type { NewsStoryCard, StoryPage as StoryPageData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The story page off editorial paper (T-1621, D-291): it follows the theme,
 * keeps its reading faces, and its rights behaviour is D-061's and D-177's
 * as before -- the publisher's words only when the source grants the full
 * text, otherwise the sentence and the link out naming the publisher.
 * Rendered whole with the API mocked.
 */

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  fetchStory: vi.fn(),
  fetchSavedArticles: vi.fn(),
  fetchFollowing: vi.fn(),
  fetchEvaluations: vi.fn(),
  fetchForecastSummaries: vi.fn(),
  fetchMatchCentre: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => undefined }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'Europe/London', chosen: false }),
}));
vi.mock('@/lib/story-actions', () => ({ storyFollowAction: async () => undefined }));
vi.mock('@/lib/saved-actions', () => ({
  saveArticleAction: async () => undefined,
  unsaveArticleAction: async () => undefined,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));

const { default: StoryPage } = await import('./page');

const ID = '00000000-0000-4000-8000-00000000a001';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const story = (rights: 'summary' | 'full_text'): NewsStoryCard => ({
  story_id: ID,
  article_id: 'a1',
  headline: 'Arsenal win at the Emirates',
  summary: 'A late goal settled it.',
  byline: null,
  language: 'en',
  origin: 'publisher',
  review_state: null,
  published_at: '2026-10-25T18:00:00Z',
  fetched_at: '2026-10-25T18:05:00Z',
  url: 'https://publisher.example/story',
  source: {
    id: 's1',
    name: 'Example Times',
    homepage_url: 'https://publisher.example',
    rights,
  },
  entities: [
    {
      entity_type: 'team',
      entity_id: '00000000-0000-4000-8000-000000000601',
      name: 'Arsenal',
      localised_name: null,
    },
  ],
  other_reports: 0,
  type: { coverage: 'not_supplied', last_updated_at: null, data: null },
  discussion: null,
  debate: null,
  breaking: null,
  image: null,
});

const page = (rights: 'summary' | 'full_text'): StoryPageData => ({
  story: story(rights),
  updated_at: '2026-10-25T18:05:00Z',
  versions: [
    {
      language: 'en',
      version_number: 1,
      updated_at: '2026-10-25T18:05:00Z',
      origin: 'publisher',
      review_state: null,
    },
  ],
  body:
    rights === 'full_text'
      ? { coverage: 'available', last_updated_at: '2026-10-25T18:05:00Z', data: 'The words.' }
      : { coverage: 'not_supplied', last_updated_at: null, data: null },
  corrections: [],
  reports: [],
  last_updated_at: '2026-10-25T18:05:00Z',
});

async function render(rights: 'summary' | 'full_text', locale = 'en'): Promise<string> {
  api.fetchStory.mockResolvedValue({ ok: true, data: page(rights) });
  const element = await StoryPage({
    params: Promise.resolve({ locale, id: ID }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  api.fetchMe.mockResolvedValue(null);
  api.fetchSavedArticles.mockResolvedValue(null);
  api.fetchFollowing.mockResolvedValue(null);
});

describe('the story page (T-1621, D-291)', () => {
  it('follows the theme: no editorial paper, its asides on cards', async () => {
    const out = await render('summary');
    expect(out).not.toContain('data-mode');
    expect(out).toContain('data-testid="story-page"');
    expect(out.match(/rounded-tile border border-default bg-surface/g)?.length).toBeGreaterThan(3);
    expect(out).not.toMatch(PHYSICAL);
  });

  it('keeps the reading faces: the headline in the editorial face, the words in the article face', async () => {
    const out = await render('full_text');
    expect(out).toMatch(
      /<h1 dir="auto" class="font-serif[^"]*"[^>]*data-testid="title">Arsenal win/,
    );
    expect(out).toMatch(
      /dir="auto" class="font-article text-article[^"]*" data-testid="story-body">The words\./,
    );
  });

  it('sets the publisher’s words in their own direction, so an English story ends right on /fa (T-1622)', async () => {
    const out = await render('summary');
    expect(out).toMatch(/<h1 dir="auto"[^>]*data-testid="title"/);
    expect(out).toMatch(/<p dir="auto"[^>]*data-testid="story-summary"/);
  });

  it('shows the words only when the source grants the full text (D-061)', async () => {
    const full = await render('full_text');
    expect(full).toContain('data-testid="story-body"');
    expect(full).not.toContain('data-testid="story-body-not-supplied"');

    const summary = await render('summary');
    expect(summary).not.toContain('data-testid="story-body"');
    expect(summary).toContain('data-testid="story-body-not-supplied"');
    // The way to the original names its publisher.
    expect(summary).toMatch(/href="https:\/\/publisher\.example\/story"/);
    expect(summary.replace(/<[^>]+>/g, '')).toContain('Example Times');
  });

  it('gives the back link, the language and the entity links a 44px target', async () => {
    const out = await render('summary');
    for (const testId of ['back-to-news']) {
      expect(out).toMatch(
        new RegExp(`<a[^>]*class="[^"]*min-h-touch[^"]*"[^>]*data-testid="${testId}"`),
      );
    }
    const language = /<a[^>]*data-language="en"[^>]*>/.exec(out)?.[0] ?? '';
    expect(language).toContain('min-h-touch');
    expect(language).toContain('aria-current="true"');
    expect(out).toMatch(
      /<a[^>]*href="\/en\/team\/00000000-0000-4000-8000-000000000601"[^>]*min-h-touch|<a[^>]*min-h-touch[^>]*href="\/en\/team\//,
    );
  });
});
