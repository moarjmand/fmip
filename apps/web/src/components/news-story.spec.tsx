import type { NewsImage, NewsStoryCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewsStory, type NewsStoryVariant } from './news-story';

/**
 * One story on the news front page (T-1570; T-1613, D-284). The publisher's
 * headline and summary carry the story's language and their own direction,
 * so an English story on `/fa` reads left to right with its full stop at its
 * end; the reader's own words around them keep the page's language. Every
 * shape says the source and the time, files the story under its clubs with
 * their crests, links each to its page by id, and gives its links a touch
 * target on a phone. A photo is always credited; without one the picture is
 * the designed panel, never a stand-in photo.
 */

const NOW = '2026-10-26T00:10:00.000Z';
const LIVERPOOL = '00000000-0000-4000-8000-000000000601';
const CREST = `/api/media/crest/${LIVERPOOL}/abcdef123456.png`;

const card: NewsStoryCard = {
  story_id: '00000000-0000-4000-8000-000000000001',
  article_id: '00000000-0000-4000-8000-000000000101',
  headline: 'Howe open to talks',
  summary: 'Eddie Howe is open to talks, plus more.',
  byline: null,
  language: 'en-US',
  origin: 'publisher',
  review_state: null,
  published_at: '2026-10-25T21:10:00.000Z',
  fetched_at: '2026-10-25T21:35:00.000Z',
  url: 'https://example.org/1',
  source: { id: 's', name: 'Yahoo Sports', homepage_url: 'https://example.org', rights: 'summary' },
  entities: [
    {
      entity_type: 'fixture',
      entity_id: '00000000-0000-4000-8000-000000000901',
      name: null,
      localised_name: null,
    },
    {
      entity_type: 'team',
      entity_id: LIVERPOOL,
      name: 'Liverpool',
      localised_name: 'لیورپول',
      media: { coverage: 'available', url: CREST },
    },
  ],
  other_reports: 2,
  type: { coverage: 'not_supplied', data: null, last_updated_at: null },
  discussion: null,
  debate: null,
  breaking: null,
} as NewsStoryCard;

const PHOTO: NewsImage = {
  url: '/media/news/0b6f9c1e-3a52-4e0c-9d7a-1f2e3d4c5b6a.jpg',
  credit: 'Tehran Times / Mehr News Agency',
  licence: 'cc-by-4.0',
  licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  width: 1200,
  height: 800,
};

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const VARIANTS: NewsStoryVariant[] = ['lead', 'card', 'row'];

const render = (variant: NewsStoryVariant, over: Partial<NewsStoryCard> = {}, locale = 'fa') =>
  renderToStaticMarkup(
    <NewsStory
      card={{ ...card, ...over }}
      locale={locale}
      timeZone="UTC"
      now={NOW}
      variant={variant}
    />,
  );
const srcs = (markup: string) =>
  [...markup.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] ?? '');

describe('a story on the news page', () => {
  const html = render('lead');

  it("marks the publisher's words with their language and direction, not the whole card", () => {
    expect(html).toMatch(/<article [^>]*data-testid="story"/);
    expect(html).not.toMatch(/<article [^>]*lang=/);
    expect(html).toMatch(/<a [^>]*lang="en-US" dir="auto"[^>]*data-testid="story-link"/);
    expect(html).toMatch(/<p [^>]*lang="en-US" dir="auto" data-testid="story-summary">/);
  });

  it('gives its links a touch target on a phone', () => {
    expect(html).toMatch(/data-testid="story-more"><a [^>]*class="[^"]*min-h-touch[^"]*md:min-h-6/);
    expect(html).toMatch(
      /<a [^>]*class="[^"]*min-h-touch[^"]*"[^>]*data-testid="story-tag"[^>]*>.*?<bdi>لیورپول<\/bdi>/,
    );
  });
});

describe('the three shapes (T-1613, D-284)', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: the source and the time, the story filed under its club with its crest`, () => {
      const out = render(variant, {}, 'en');
      expect(out).toContain(`data-variant="${variant}"`);
      expect(out).toMatch(/data-testid="story-source"[^>]*>.*Yahoo Sports/);
      // Three hours before the page's clock: said as an age, the full time on hover.
      expect(out).toMatch(
        /<time dateTime="2026-10-25T21:10:00.000Z" title="[^"]+">3 hr ago<\/time>/,
      );
      expect(out).toContain(`href="/en/team/${LIVERPOOL}"`);
      expect(out).toMatch(/data-testid="story-tag" data-type="team"/);
      // Clubs before the match, whatever order the API gave.
      expect(out.indexOf('data-type="team"')).toBeLessThan(out.indexOf('data-type="fixture"'));
      expect(out).not.toMatch(PHYSICAL);
    });

    it(`${variant}: without a photo, the designed panel of its crest -- no stand-in photo`, () => {
      const out = render(variant);
      expect(out).toContain('data-testid="news-panel"');
      expect(out).not.toContain('data-testid="news-image"');
      expect(out).not.toContain('data-testid="news-image-credit"');
      expect(srcs(out).every((src) => src.startsWith('/api/media/'))).toBe(true);
    });

    it(`${variant}: with a licensed photo, the photo and its credit, once`, () => {
      const out = render(variant, { image: PHOTO });
      expect(srcs(out)).toContain(PHOTO.url);
      expect(out).not.toContain('data-testid="news-panel"');
      expect(out.match(/data-testid="news-image-credit"/g)).toHaveLength(1);
      expect(out).toContain('>CC BY 4.0</a>');
    });
  }

  it('says the date, not an age, for a story more than a day old', () => {
    const out = render('card', { published_at: '2026-10-20T09:00:00.000Z' }, 'en');
    expect(out).toMatch(/<time dateTime="2026-10-20T09:00:00.000Z"[^>]*>20 Oct<\/time>/);
  });

  it('says a publisher gave no time, never the fetch time', () => {
    const out = render('row', { published_at: null }, 'en');
    expect(out).not.toContain('<time');
    expect(out).toContain('time not given by the publisher');
  });

  it('loads only the lead at once', () => {
    expect(render('lead', { image: PHOTO })).toContain('loading="eager"');
    expect(render('card', { image: PHOTO })).toContain('loading="lazy"');
    expect(render('row', { image: PHOTO })).toContain('loading="lazy"');
  });

  it('heads the lead at h2, a card or a row at h3', () => {
    expect(render('lead')).toMatch(/<h2[^>]*><a [^>]*data-testid="story-link"/);
    expect(render('card')).toMatch(/<h3[^>]*><a [^>]*data-testid="story-link"/);
    expect(render('row')).toMatch(/<h3[^>]*><a [^>]*data-testid="story-link"/);
  });

  it("keeps a card short: no summary, the other reports as the way to the story's page", () => {
    const out = render('card', {}, 'en');
    expect(out).not.toContain('data-testid="story-summary"');
    expect(out).toMatch(
      /<a [^>]*data-testid="story-others"[^>]*href="\/en\/news\/story\/00000000-0000-4000-8000-000000000001"/,
    );
  });

  it("carries the editor's breaking note and the story type where there is one", () => {
    const out = render(
      'card',
      {
        breaking: { note: 'Signed', marked_at: NOW, ends_at: NOW },
        type: {
          coverage: 'available',
          last_updated_at: NOW,
          data: { type: 'transfer', origin: 'publisher' },
        },
      },
      'en',
    );
    expect(out).toMatch(/data-testid="story-breaking"[^>]*>.*Signed/);
    expect(out).toMatch(/data-testid="story-type" data-type="transfer"/);
  });
});
