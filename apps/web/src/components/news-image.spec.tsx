import type {
  EntityNewsResponse,
  FixtureNewsResponse,
  NewsImage,
  NewsStoryCard,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NewsCardImage,
  NewsImageCredit,
  NewsPhoto,
  NewsThumb,
  drawableNewsImage,
} from './news-image';
import { EntityNews, RelatedNews } from './related-news';

/**
 * News photos and their credit (T-1323, D-177): only our own `/media/news/`
 * address is drawn, its credit and the licence go with it wherever it is,
 * and a story without one draws nothing. Rendered, not read from the source.
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
const READ = '2026-10-01T10:00:00Z';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const srcs = (markup: string) =>
  [...markup.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] ?? '');

function card(id: string, image: NewsImage | null | undefined): NewsStoryCard {
  return {
    story_id: `00000000-0000-4000-8000-00000000000${id}`,
    article_id: `00000000-0000-4000-8000-00000000010${id}`,
    headline: `Headline ${id}`,
    summary: null,
    byline: null,
    language: 'en',
    origin: 'publisher',
    review_state: null,
    published_at: READ,
    fetched_at: READ,
    url: `https://example.org/${id}`,
    source: {
      id: 's',
      name: 'Mehr News',
      homepage_url: 'https://example.org',
      rights: 'summary',
    },
    entities: [],
    other_reports: 0,
    type: { coverage: 'not_supplied', data: null, last_updated_at: null },
    discussion: null,
    debate: null,
    breaking: null,
    ...(image === undefined ? {} : { image }),
  } as NewsStoryCard;
}

const CARDS = [card('1', PHOTO), card('2', null), card('3', undefined)];

describe('drawableNewsImage', () => {
  it('accepts only our own /media/news/ address', () => {
    expect(drawableNewsImage(PHOTO)).toBe(true);
    expect(drawableNewsImage(null)).toBe(false);
    expect(drawableNewsImage(undefined)).toBe(false);
    for (const url of [
      'https://www.mehrnews.com/photo.jpg',
      '//mehrnews.com/photo.jpg',
      '/api/media/crest/t-1/abc',
      '/media/news/../secret',
    ]) {
      expect(drawableNewsImage({ ...PHOTO, url })).toBe(false);
    }
  });
});

describe('the credit', () => {
  it('says the credit and links the licence by its name', () => {
    const out = html(<NewsImageCredit image={PHOTO} locale="en" />);
    expect(out).toContain('Photo: <bdi>Mehr News Agency</bdi> · ');
    expect(out).toMatch(
      /<a href="https:\/\/creativecommons.org\/licenses\/by\/4.0\/" rel="license noopener"[^>]*>CC BY 4.0<\/a>/,
    );
  });

  it('is Persian on a Persian page, the licence name kept', () => {
    const out = html(<NewsImageCredit image={PHOTO} locale="fa" />);
    expect(out).toContain('عکس: <bdi>Mehr News Agency</bdi>');
    expect(out).toContain('>CC BY 4.0</a>');
    expect(out).not.toContain('data-translation="untranslated"');
  });
});

describe('the story page photo', () => {
  it('is eager, sized from the contract, named by the headline, credited beneath', () => {
    const out = html(<NewsPhoto image={PHOTO} headline="Esteghlal win" locale="en" />);
    expect(out).toContain('<figure');
    expect(out).toContain('width="1200"');
    expect(out).toContain('height="800"');
    expect(out).toContain('alt="Esteghlal win"');
    expect(out).toContain('loading="eager"');
    expect(out).toMatch(/<figcaption>.*CC BY 4.0.*<\/figcaption>/);
  });

  it('reserves 16:9 when the size is unknown', () => {
    const out = html(
      <NewsPhoto image={{ ...PHOTO, width: null, height: null }} headline="x" locale="en" />,
    );
    expect(out).toContain('width="1600"');
    expect(out).toContain('height="900"');
    expect(out).toContain('aspect-video');
  });

  it('draws nothing without a photo, or with an address not ours', () => {
    expect(html(<NewsPhoto image={null} headline="x" locale="en" />)).toBe('');
    expect(html(<NewsPhoto image={undefined} headline="x" locale="en" />)).toBe('');
    expect(
      html(
        <NewsPhoto
          image={{ ...PHOTO, url: 'https://www.mehrnews.com/p.jpg' }}
          headline="x"
          locale="en"
        />,
      ),
    ).toBe('');
  });
});

describe('card and thumbnail', () => {
  it('a card image is lazy, full width, 16:9 and decorative', () => {
    const out = html(<NewsCardImage image={PHOTO} />);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('alt=""');
    expect(out).toContain('aspect-video');
    expect(out).toContain('w-full');
    expect(out).toContain('object-cover');
  });

  it('a thumbnail is a lazy 72px cover', () => {
    const out = html(<NewsThumb image={PHOTO} />);
    expect(out).toContain('width="72"');
    expect(out).toContain('height="72"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('object-cover');
    expect(out).toContain('alt=""');
  });

  it('draws nothing for null or absent', () => {
    for (const image of [null, undefined]) {
      expect(html(<NewsCardImage image={image} />)).toBe('');
      expect(html(<NewsThumb image={image} />)).toBe('');
    }
  });

  it('uses no physical side', () => {
    for (const node of [
      <NewsCardImage key="c" image={PHOTO} />,
      <NewsThumb key="t" image={PHOTO} />,
      <NewsPhoto key="p" image={PHOTO} headline="x" locale="fa" />,
      <NewsImageCredit key="k" image={PHOTO} locale="fa" />,
    ]) {
      expect(html(node)).not.toMatch(PHYSICAL);
    }
  });
});

describe('the dense lists', () => {
  const entity: EntityNewsResponse = {
    entity: { type: 'team', id: 't' },
    stories: { coverage: 'available', data: CARDS, last_updated_at: READ },
    reason: null,
  };
  const fixture: FixtureNewsResponse = {
    fixture_id: 'f',
    period: { since: READ, until: READ },
    stories: { coverage: 'available', data: CARDS, last_updated_at: READ },
    reason: null,
  };

  for (const [name, out] of [
    ['entity news', () => html(<EntityNews locale="en" timeZone="UTC" news={entity} />)],
    ['related news', () => html(<RelatedNews locale="en" timeZone="UTC" news={fixture} />)],
  ] as const) {
    it(`${name}: one thumbnail and one credit, for the story with a photo only`, () => {
      const markup = out();
      const drawn = srcs(markup);
      expect(drawn).toEqual([PHOTO.url]);
      expect(drawn.every((src) => src.startsWith('/media/news/'))).toBe(true);
      expect(markup.match(/data-testid="news-image-credit"/g)).toHaveLength(1);
      expect(markup).toContain('>CC BY 4.0</a>');
      expect(markup).not.toMatch(PHYSICAL);
    });
  }
});
