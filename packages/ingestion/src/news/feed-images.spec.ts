import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeed, type ParsedFeed } from './feed';

/**
 * News photos in a feed (T-1322, D-177), against a recording of Mehr's
 * Iranian-football feed (`_recorded/mehrnews-rss-tp24.xml`, trimmed) and
 * format samples for the other places a feed puts a photo.
 */
const recorded = (name: string): string => readFileSync(join(__dirname, '_recorded', name), 'utf8');

const parsed = (xml: string, images: boolean): ParsedFeed => {
  const feed = parseFeed(xml, { images });
  if (!('items' in feed)) throw new Error(feed.message);
  return feed;
};

describe('feed photos', () => {
  it("reads Mehr's image enclosures, only when asked", () => {
    const xml = recorded('mehrnews-rss-tp24.xml');
    expect(parsed(xml, true).items.map((i) => i.imageUrl)).toEqual([
      'https://media.mehrnews.com/d/2015/07/16/4/1768355.jpg',
      'https://media.mehrnews.com/d/2026/09/01/4/6158165.jpg',
      'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg',
    ]);
    // A source whose licence does not cover photos: the URL is not even kept.
    expect(parsed(xml, false).items.map((i) => i.imageUrl)).toEqual([null, null, null]);
    expect(parseFeed(xml).kind).toBe('rss');
    expect(parsed(xml, true).items[1]).toMatchObject({
      headline: 'پیروزی پرگل آلومینیوم مقابل سپاهان در بازی دوستانه',
      language: 'fa',
    });
  });

  const rss = (inner: string): string =>
    `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title>
     <item><title>One</title><link>https://example.test/1</link>${inner}</item></channel></rss>`;

  it('takes media:content of an image type, then media:thumbnail', () => {
    expect(
      parsed(rss('<media:content url="https://img.example.test/a.jpg" medium="image" />'), true)
        .items[0]?.imageUrl,
    ).toBe('https://img.example.test/a.jpg');
    expect(
      parsed(rss('<media:thumbnail url="https://img.example.test/t.jpg"/>'), true).items[0]
        ?.imageUrl,
    ).toBe('https://img.example.test/t.jpg');
  });

  it('refuses what is not an image or not an absolute URL', () => {
    expect(
      parsed(rss('<enclosure url="https://a.example.test/clip.mp3" type="audio/mpeg"/>'), true)
        .items[0]?.imageUrl,
    ).toBeNull();
    expect(
      parsed(rss('<enclosure url="/relative.jpg" type="image/jpeg"/>'), true).items[0]?.imageUrl,
    ).toBeNull();
    expect(
      parsed(rss('<media:content url="https://v.example.test/v.mp4" type="video/mp4"/>'), true)
        .items[0]?.imageUrl,
    ).toBeNull();
  });

  it('reads an Atom enclosure link', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
      <entry><title>One</title><link href="https://example.test/1"/>
      <link rel="enclosure" type="image/png" href="https://img.example.test/p.png"/></entry></feed>`;
    expect(parsed(atom, true).items[0]?.imageUrl).toBe('https://img.example.test/p.png');
    expect(parsed(atom, true).items[0]?.url).toBe('https://example.test/1');
  });
});
