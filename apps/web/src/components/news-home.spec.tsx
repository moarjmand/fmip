import type { NewsImage, NewsStoryCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeNews } from './news-home';

/**
 * The home page's news (T-1613, D-284): a small front page -- the lead, two
 * cards, then rows -- each story with a picture that is its licensed photo,
 * credited, or the designed panel, never a stand-in photo (rule 3); all
 * lazy, being below the fold; the headline and the picture opening the
 * story's page; the source and the time on every story.
 */

const NOW = '2026-10-26T13:00:00.000Z';
const PHOTO: NewsImage = {
  url: '/media/news/ad899c1b-08ae-4ede-a6e0-89c9e0a124d1.jpg',
  credit: 'Tehran Times / Mehr News Agency',
  licence: 'cc-by-4.0',
  licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  width: 535,
  height: 326,
};
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function story(index: number, over: Partial<NewsStoryCard> = {}): NewsStoryCard {
  return {
    story_id: `00000000-0000-4000-8000-00000000000${index}`,
    article_id: `00000000-0000-4000-8000-00000000010${index}`,
    headline: `Headline ${index}`,
    summary: `Summary ${index}`,
    byline: null,
    language: 'en',
    origin: 'publisher',
    review_state: null,
    published_at: '2026-10-26T10:00:00.000Z',
    fetched_at: NOW,
    url: `https://example.org/${index}`,
    source: {
      id: 's',
      name: 'Yahoo Sports',
      homepage_url: 'https://example.org',
      rights: 'summary',
    },
    entities: [
      {
        entity_type: 'team',
        entity_id: '00000000-0000-4000-8000-000000000601',
        name: 'Liverpool',
        localised_name: null,
        media: {
          coverage: 'available',
          url: '/api/media/crest/00000000-0000-4000-8000-000000000601/abcdef123456.png',
        },
      },
    ],
    other_reports: 0,
    type: { coverage: 'not_supplied', data: null, last_updated_at: null },
    discussion: null,
    debate: null,
    breaking: null,
    ...over,
  } as NewsStoryCard;
}

const SIX = [1, 2, 3, 4, 5, 6].map((i) => story(i, i === 2 || i === 5 ? { image: PHOTO } : {}));
const render = (stories: NewsStoryCard[], stale = false, locale = 'en') =>
  renderToStaticMarkup(
    <HomeNews stories={stories} stale={stale} locale={locale} timeZone="UTC" now={NOW} />,
  );

describe("the home page's news", () => {
  const html = render(SIX);

  it('is the lead, two cards, then rows', () => {
    const variants = [...html.matchAll(/data-testid="home-story" data-variant="(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(variants).toEqual(['lead', 'card', 'card', 'thumb', 'thumb', 'thumb']);
  });

  it('gives every story a picture: the photo where licensed, else the designed panel', () => {
    expect(html.match(/data-testid="news-image"/g)).toHaveLength(2);
    expect(html.match(/data-testid="news-panel"/g)).toHaveLength(4);
    // Every photo credited, once: under a card's photo, in a row's words.
    expect(html.match(/data-testid="news-image-credit"/g)).toHaveLength(2);
    const srcs = [...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(
      srcs.every((src) => src.startsWith('/media/news/') || src.startsWith('/api/media/')),
    ).toBe(true);
  });

  it('loads every picture lazily, its size said', () => {
    expect(html).not.toContain('loading="eager"');
    for (const img of html.match(/<img [^>]*>/g) ?? []) {
      expect(img).toContain('loading="lazy"');
      expect(img).toMatch(/width="\d+" height="\d+"/);
    }
  });

  it("opens the story's page from the headline and the picture", () => {
    const story = '/en/news/story/00000000-0000-4000-8000-000000000001';
    expect(html).toMatch(new RegExp(`<a href="${story}"[^>]*tabindex="-1" aria-hidden="true"`));
    expect(html).toMatch(
      new RegExp(
        `<a [^>]*href="${story}"[^>]*data-testid="home-story-link"|<a [^>]*data-testid="home-story-link"[^>]*href="${story}"`,
      ),
    );
  });

  it('says the source and the time of every story, and links all the news', () => {
    expect(html.match(/Yahoo Sports<\/bdi>/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html.match(/>3 hr ago<\/time>/g)).toHaveLength(6);
    expect(html).toMatch(
      /data-testid="home-news-all"[^>]*href="\/en\/news"|href="\/en\/news"[^>]*data-testid="home-news-all"/,
    );
    expect(html).not.toMatch(PHYSICAL);
  });

  it("marks the publisher's words with their language and direction", () => {
    expect(html).toMatch(/<a [^>]*lang="en" dir="auto"[^>]*data-testid="home-story-link"/);
  });

  it('says when the feeds are behind, and draws nothing with no story', () => {
    expect(render(SIX, true)).toContain('data-testid="home-news-stale"');
    expect(html).not.toContain('data-testid="home-news-stale"');
    expect(render([])).toBe('');
  });

  it("is Persian around the publisher's words on /fa", () => {
    const fa = render(SIX, false, 'fa');
    expect(fa).toContain('همهٔ اخبار');
    expect(fa).not.toContain('data-translation="untranslated"');
  });
});
