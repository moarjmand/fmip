import type { NewsFeedPreview, NewsSourceRecord } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the page only binds them.
vi.mock('@/lib/news-source-actions', () => ({
  previewNewsFeedAction: async () => null,
  addNewsSourceAction: async () => null,
  editNewsSourceAction: async () => null,
  dropNewsSourceAction: async () => null,
}));

const { FeedPreview, NewsSourcesAdmin } = await import('./news-sources-admin');

/**
 * News sources in the console (T-1015): the preview says what robots.txt
 * said and what the feed would yield; a carried source can be edited and
 * dropped, each with a reason; a dropped one shows when and why, with no
 * form; and the page says which publishers to carry is not its choice
 * (N-8). Logical properties only (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function source(overrides: Partial<NewsSourceRecord> = {}): NewsSourceRecord {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    name: 'A Publisher',
    homepage_url: 'https://publisher.example',
    feed_url: 'https://publisher.example/feed.xml',
    kind: 'rss',
    rights: 'headline',
    language: 'en',
    created_at: '2026-09-29T08:00:00.000Z',
    updated_at: '2026-09-29T08:00:00.000Z',
    dropped_at: null,
    dropped_reason: null,
    last_fetch: null,
    ...overrides,
  };
}

describe('NewsSourcesAdmin (T-1015)', () => {
  it('offers to read a feed first, and says the choice of publishers is not the page’s', () => {
    const html = renderToStaticMarkup(<NewsSourcesAdmin locale="en" sources={[]} />);
    expect(html).toContain('data-testid="feed-preview-form"');
    expect(html).toContain('(N-8, D-061)');
    expect(html).toContain('No source is carried');
    // Nothing to add from until a feed was read.
    expect(html).not.toContain('news-source-add-form');
    expect(html).not.toMatch(PHYSICAL);
  });

  it('a carried source can be edited and dropped with a reason; a dropped one cannot', () => {
    const carried = source();
    const gone = source({
      id: '00000000-0000-4000-8000-00000000c002',
      name: 'Gone Paper',
      dropped_at: '2026-09-29T09:00:00.000Z',
      dropped_reason: 'The publisher asked to be dropped.',
    });
    const html = renderToStaticMarkup(<NewsSourcesAdmin locale="en" sources={[carried, gone]} />);
    expect(html).toContain(`data-testid="news-source-edit-${carried.id}"`);
    expect(html).toContain(`data-testid="news-source-drop-${carried.id}"`);
    expect(html).not.toContain(`news-source-edit-${gone.id}`);
    expect(html).not.toContain(`news-source-drop-${gone.id}`);
    expect(html).toContain('The publisher asked to be dropped.');
    expect(html).toContain('Never read.');
    expect(html.match(/name="reason"/g)).toHaveLength(2);
    expect(html).not.toMatch(PHYSICAL);
  });
});

describe('FeedPreview (T-1015)', () => {
  const base: NewsFeedPreview = {
    feed_url: 'https://publisher.example/feed.xml',
    checked_at: '2026-09-29T10:00:00.000Z',
    robots: { url: 'https://publisher.example/robots.txt', verdict: 'allowed', status: 200 },
    feed: {
      ok: true,
      kind: 'rss',
      title: 'A Publisher',
      language: 'ar',
      items: 12,
      skipped: 1,
      sample: [
        {
          headline: 'مدرب يرحل',
          url: 'https://publisher.example/a',
          published_at: null,
          summary: 'ملخص',
          language: 'ar',
        },
      ],
    },
  };

  it('shows what the feed would yield, right to left where the words are', () => {
    const html = renderToStaticMarkup(<FeedPreview preview={base} />);
    expect(html).toContain('data-verdict="allowed"');
    expect(html).toContain('12 items, 1 skipped');
    expect(html).toContain('no time given');
    expect(html).toMatch(/dir="auto"[^>]*lang="ar"|lang="ar"[^>]*dir="auto"/);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says robots.txt refused, and shows no items', () => {
    const html = renderToStaticMarkup(
      <FeedPreview
        preview={{ ...base, robots: { ...base.robots, verdict: 'disallowed' }, feed: null }}
      />,
    );
    expect(html).toContain('disallows the feed');
    expect(html).not.toContain('feed-preview-item');
  });

  it('says why a feed could not be read', () => {
    const html = renderToStaticMarkup(
      <FeedPreview preview={{ ...base, feed: { ok: false, error: 'malformed: not XML' } }} />,
    );
    expect(html).toContain('data-testid="feed-preview-failed"');
    expect(html).toContain('malformed: not XML');
  });
});
