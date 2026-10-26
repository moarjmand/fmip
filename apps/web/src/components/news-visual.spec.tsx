import type { NewsEntity, NewsImage, NewsStoryCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewsVisual, type NewsVisualSize } from './news-visual';

/**
 * A story's picture (T-1613, D-284). A licensed photo (D-177) is drawn from
 * our own server, its size said, its credit with it. Without one the picture
 * is never a stand-in photo (rule 3): it is a panel of the crests, logos and
 * photos we hold (D-176), or the source's name in type -- marked as a panel,
 * hidden from assistive technology and lite mode, linking where the headline
 * does but out of the tab order.
 */

const PHOTO: NewsImage = {
  url: '/media/news/0b6f9c1e-3a52-4e0c-9d7a-1f2e3d4c5b6a.jpg',
  credit: 'Mehr News Agency',
  licence: 'cc-by-4.0',
  licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  width: 1200,
  height: 800,
};
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const SIZES: NewsVisualSize[] = ['lead', 'card', 'thumb'];

const team = (id: string, pictured: boolean): NewsEntity => ({
  entity_type: 'team',
  entity_id: id,
  name: `Club ${id}`,
  localised_name: null,
  media: pictured
    ? { coverage: 'available', url: `/api/media/crest/${id}/abcdef123456.png` }
    : { coverage: 'not_supplied', url: null },
});

function story(over: Partial<NewsStoryCard> = {}): NewsStoryCard {
  return {
    story_id: '00000000-0000-4000-8000-000000000001',
    article_id: '00000000-0000-4000-8000-000000000101',
    headline: 'Headline',
    summary: null,
    byline: null,
    language: 'en',
    origin: 'publisher',
    review_state: null,
    published_at: null,
    fetched_at: '2026-10-26T00:00:00Z',
    url: 'https://example.org/1',
    source: {
      id: 's',
      name: 'Yahoo Sports',
      homepage_url: 'https://example.org',
      rights: 'summary',
    },
    entities: [],
    other_reports: 0,
    type: { coverage: 'not_supplied', data: null, last_updated_at: null },
    discussion: null,
    debate: null,
    breaking: null,
    ...over,
  } as NewsStoryCard;
}

const html = (card: NewsStoryCard, size: NewsVisualSize, eager = false) =>
  renderToStaticMarkup(<NewsVisual card={card} locale="en" size={size} eager={eager} />);
const srcs = (markup: string) =>
  [...markup.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] ?? '');

describe('with a licensed photo', () => {
  it('draws it from our own server, sized, decorative, credited beneath', () => {
    const out = html(story({ image: PHOTO }), 'card');
    expect(srcs(out)).toEqual([PHOTO.url]);
    expect(out).toContain('width="1200"');
    expect(out).toContain('height="800"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('aspect-video');
    expect(out).toMatch(/data-testid="news-image-credit"[^>]*>.*Mehr News Agency.*CC BY 4.0/);
    // The credit is not inside the picture's link.
    expect(out).toMatch(/<\/a><p [^>]*data-testid="news-image-credit"/);
  });

  it('loads the lead at once, and reserves 16:9 when the size is unknown', () => {
    const out = html(story({ image: { ...PHOTO, width: null, height: null } }), 'lead', true);
    expect(out).toContain('loading="eager"');
    expect(out).toContain('width="1600"');
    expect(out).toContain('height="900"');
  });

  it("leaves a row's credit to the row, and keeps a thumbnail's box", () => {
    const out = html(story({ image: PHOTO }), 'thumb');
    expect(out).toContain('width="128"');
    expect(out).toContain('height="72"');
    expect(out).not.toContain('data-testid="news-image-credit"');
  });

  it('treats an address that is not ours as no photo', () => {
    const out = html(story({ image: { ...PHOTO, url: 'https://www.mehrnews.com/p.jpg' } }), 'card');
    expect(out).not.toContain('mehrnews.com');
    expect(out).toContain('data-testid="news-panel"');
  });
});

describe('without one: the designed panel, never a stand-in photo', () => {
  for (const size of SIZES) {
    it(`${size}: the crests we hold, clubs first, at most the panel's number`, () => {
      const card = story({
        entities: [team('a', true), team('b', false), team('c', true), team('d', true)],
      });
      const out = html(card, size);
      expect(out).toMatch(/data-testid="news-panel" data-kind="marks"/);
      const drawn = srcs(out);
      expect(drawn.length).toBe(size === 'thumb' ? 2 : 3);
      expect(drawn.every((src) => src.startsWith('/api/media/crest/'))).toBe(true);
      // b has no crest: never a lettered stand-in on the panel.
      expect(out).not.toContain('data-letters');
      expect(out).not.toMatch(PHYSICAL);
    });

    it(`${size}: the source's name in type when we hold no image of what it is filed under`, () => {
      const out = html(story({ entities: [team('b', false)] }), size);
      expect(out).toMatch(/data-testid="news-panel" data-kind="source"/);
      expect(out).toContain('<bdi');
      expect(out).toContain('Yahoo Sports</bdi>');
      expect(srcs(out)).toEqual([]);
    });
  }

  it('is a graphic: hidden from assistive technology and lite mode, out of the tab order', () => {
    const out = html(story(), 'card');
    expect(out).toMatch(
      /^<a href="https:\/\/example.org\/1" rel="noopener" tabindex="-1" aria-hidden="true" class="[^"]*lite:hidden/,
    );
    expect(out).toContain('<svg');
    expect(out).not.toContain('<img');
  });
});
