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
  fetchFounderAnalysis: vi.fn(),
  fetchConsensus: vi.fn(),
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

const FIXTURE = '00000000-0000-4000-8000-000000000901';

async function render(
  rights: 'summary' | 'full_text',
  locale = 'en',
  /** Link the story to a match, as a preview of it would be. */
  linked = false,
  /** Change the page's answer before it is drawn. */
  adjust: (data: StoryPageData) => void = () => undefined,
): Promise<string> {
  const data = page(rights);
  adjust(data);
  if (linked) {
    data.story.entities.push({
      entity_type: 'fixture',
      entity_id: FIXTURE,
      name: null,
      localised_name: null,
    });
  }
  api.fetchStory.mockResolvedValue({ ok: true, data });
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

  it('puts "Read the original" first under the summary, the note about it small under the button (T-1741)', async () => {
    const out = await render('summary');
    const order = ['story-summary', 'story-source', 'story-link', 'story-body-note'].map((id) =>
      out.indexOf(`data-testid="${id}"`),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Inside the header, so nothing (a photo) comes between the summary and the button.
    expect(out.indexOf('data-testid="story-link"')).toBeLessThan(out.indexOf('</header>'));
    expect(out).toMatch(/<p class="text-sm text-muted" data-testid="story-body-note">Only the/);
    expect(out.replace(/<[^>]+>/g, '')).toContain('Read the original (Example Times)');
  });
});

describe('the predictions card on the story page (T-1741, D-362)', () => {
  const centre = (status: string, kickoff: string) => ({
    ok: true,
    data: {
      fixture: {
        id: FIXTURE,
        kickoff_at: kickoff,
        status,
        competition: { id: 'pl', name: 'Premier League', short_name: null, country_id: null },
        home: { id: 'h', name: 'Arsenal', short_name: null, code: null },
        away: { id: 'a', name: 'Hull City', short_name: null, code: null },
        scores: { full_time: null },
      },
    },
  });
  const summaries = (pre: unknown) => ({
    ok: true,
    data: { fixtures: [{ fixture_id: FIXTURE, pre_kickoff: pre }] },
  });
  const FORECAST = {
    fixture_id: FIXTURE,
    version_number: 3,
    model_version: 'dixon-coles-elo@0.6.0',
    computed_at: '2026-11-02T15:10:00.000Z',
    status: 'available',
    unavailable_reason: null,
    probabilities: { home: 0.608, draw: 0.278, away: 0.114 },
  };
  // A kick-off that is always ahead of the test's clock.
  const AHEAD = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    api.fetchMatchCentre.mockResolvedValue(centre('scheduled', AHEAD));
    api.fetchForecastSummaries.mockResolvedValue(summaries(FORECAST));
    api.fetchFounderAnalysis.mockResolvedValue({
      ok: true,
      data: { fixture_id: FIXTURE, analysis: null },
    });
    api.fetchConsensus.mockResolvedValue({ ok: true, data: { fixture_id: FIXTURE, data: null } });
    api.fetchEvaluations.mockReset();
  });

  it('shows the linked match’s forecast as the model’s, with the way to the pick card', async () => {
    const out = await render('summary', 'en', true);
    expect(out).toContain('data-testid="story-predictions" data-state="forecast"');
    expect(out).toContain('data-testid="story-model"');
    const words = out.replace(/<[^>]+>/g, '');
    expect(words).toContain('60.8%');
    expect(words).toContain('dixon-coles-elo@0.6.0');
    expect(out).toContain(`href="/en/match/${FIXTURE}#pick"`);
    expect(out).toContain('data-testid="story-product-analysis" data-state="none"');
    expect(out).toContain('data-testid="story-product-community" data-state="below_floor"');
    // Each product from its own endpoint, asked once; no evaluation for a preview.
    expect(api.fetchMatchCentre).toHaveBeenCalledWith(FIXTURE, 'en');
    expect(api.fetchForecastSummaries).toHaveBeenCalledWith([FIXTURE]);
    expect(api.fetchFounderAnalysis).toHaveBeenCalledWith(FIXTURE);
    expect(api.fetchConsensus).toHaveBeenCalledWith(FIXTURE);
    expect(api.fetchEvaluations).not.toHaveBeenCalled();
    expect(out).not.toMatch(PHYSICAL);
  });

  it('says there is no forecast with the coverage state, never an empty bar', async () => {
    api.fetchForecastSummaries.mockResolvedValue(summaries(null));
    const out = await render('summary', 'en', true);
    expect(out).toContain('data-testid="story-predictions" data-state="no_forecast"');
    expect(out).toContain('data-coverage-badge="not_supplied"');
    expect(out).not.toContain('data-segment=');
    // The forecast service not answering is delayed, not "none".
    api.fetchForecastSummaries.mockResolvedValue({ ok: false, status: 503 });
    const down = await render('summary', 'en', true);
    expect(down).toContain('data-coverage-badge="delayed"');
  });

  it('says a story with no linked match in one line, and asks nothing about a match', async () => {
    api.fetchMatchCentre.mockClear();
    const out = await render('summary');
    expect(out).toContain('data-testid="story-predictions" data-state="no_match"');
    expect(out).toMatch(/data-testid="story-predictions-missing" data-coverage="not_supplied"/);
    expect(out).not.toContain('data-testid="story-model"');
    expect(api.fetchMatchCentre).not.toHaveBeenCalled();
  });

  it('offers no pick for a match that has kicked off, or that could not be read', async () => {
    api.fetchMatchCentre.mockResolvedValue(centre('finished', '2026-10-25T16:00:00.000Z'));
    const over = await render('summary', 'en', true);
    expect(over).toContain('data-testid="story-predictions" data-state="started"');
    expect(over).not.toContain('#pick');
    api.fetchMatchCentre.mockResolvedValue({ ok: false, status: 503 });
    const down = await render('summary', 'en', true);
    expect(down).toContain('data-testid="story-predictions" data-state="unreachable"');
    expect(down).not.toContain('#pick');
  });
});

describe('the story page’s targets (T-1621, D-291)', () => {
  it('draws no "Not categorised" and folds one version with no correction into the source line (T-1797)', async () => {
    const out = await render('summary');
    expect(out).not.toContain('Not categorised');
    expect(out).not.toContain('data-testid="story-type-none"');
    const source = out.split('data-testid="story-source"')[1]?.split('</p>')[0] ?? '';
    expect(source).toContain('data-testid="story-version-line"');
    expect(source).toContain('the publisher&#x27;s own words');
    expect(source).toContain('data-testid="story-no-corrections"');
    expect(source).toContain('No corrections noted');
    expect(out).not.toContain('id="languages"');
    expect(out).not.toContain('id="corrections"');
    // A correction keeps its card, in words.
    const corrected = await render('summary', 'en', false, (data) => {
      data.corrections.push({ note: 'The fee was misreported.', noted_at: '2026-10-26T08:00:00Z' });
    });
    expect(corrected).toContain('id="corrections"');
    expect(corrected).toContain('The fee was misreported.');
    expect(corrected).not.toContain('data-testid="story-version-line"');
  });

  it('gives the back link, the language and the entity links a 44px target', async () => {
    const out = await render('summary');
    for (const testId of ['back-to-news']) {
      expect(out).toMatch(
        new RegExp(`<a[^>]*class="[^"]*min-h-touch[^"]*"[^>]*data-testid="${testId}"`),
      );
    }
    // Two versions keep the Languages card and its links (T-1797).
    const two = await render('summary', 'en', false, (data) => {
      data.versions.push({
        language: 'fa',
        version_number: 1,
        updated_at: '2026-10-25T19:05:00Z',
        origin: 'translation',
        review_state: 'translated',
      });
    });
    const language = /<a[^>]*data-language="en"[^>]*>/.exec(two)?.[0] ?? '';
    expect(language).toContain('min-h-touch');
    expect(language).toContain('aria-current="true"');
    expect(out).toMatch(
      /<a[^>]*href="\/en\/team\/00000000-0000-4000-8000-000000000601"[^>]*min-h-touch|<a[^>]*min-h-touch[^>]*href="\/en\/team\//,
    );
  });
});
