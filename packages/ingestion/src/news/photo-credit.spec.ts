import { describe, expect, it } from 'vitest';
import { parseFeed } from './feed';
import { stripPhotoCredit } from './photo-credit';

/** A photo credit glued into a publisher's summary (T-1797), from the stories read on 2026-11-10. */
describe('stripPhotoCredit', () => {
  it('takes out a credit glued between two sentences', () => {
    expect(
      stripPhotoCredit(
        'RB Leipzig remain reluctant to sell Antonio Nusa in the January transfer window, amid new links with a move to Arsenal.Photo by Maja Hitij/Getty ImagesPhilipp Hinze of Sky Sport Germany reports that the club wants up to £75m.',
      ),
    ).toBe(
      'RB Leipzig remain reluctant to sell Antonio Nusa in the January transfer window, amid new links with a move to Arsenal. Philipp Hinze of Sky Sport Germany reports that the club wants up to £75m.',
    );
  });

  it('takes out a bracketed credit and one through an agency "via" another', () => {
    expect(
      stripPhotoCredit('The striker scored twice. (Photo by Jane Doe/AFP via Getty Images)'),
    ).toBe('The striker scored twice.');
    expect(stripPhotoCredit('Image by Sam Roe / Reuters The coach said nothing.')).toBe(
      'The coach said nothing.',
    );
  });

  it('takes out a credit the feed cut off at the end', () => {
    expect(stripPhotoCredit('Chelsea are weighing a January move. Photo by Lewis St...')).toBe(
      'Chelsea are weighing a January move.',
    );
    expect(stripPhotoCredit('A late winner. Photo by Lewis St…')).toBe('A late winner.');
  });

  it('leaves the publisher’s words alone otherwise (rule 3)', () => {
    for (const text of [
      'Images by fans flooded social media after the final whistle',
      'The U.S. side won 2-1... and then the rain came.',
      'A photo by the club shows the new kit.',
      'He was signed by Arsenal/Chelsea scouts, the report says.',
    ]) {
      expect(stripPhotoCredit(text)).toBe(text);
    }
    expect(stripPhotoCredit(null)).toBeNull();
    expect(stripPhotoCredit('Photo by Maja Hitij/Getty Images')).toBeNull();
  });

  it('is applied when a feed item is taken in', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item>
      <title>Leipzig hold out</title><link>https://publisher.example/a</link>
      <description><![CDATA[<p>Linked with Arsenal.</p>Photo by Maja Hitij/Getty ImagesThe club wants more.]]></description>
    </item></channel></rss>`;
    const parsed = parseFeed(xml);
    if (!('items' in parsed)) throw new Error('feed did not parse');
    expect(parsed.items[0]?.summary).toBe('Linked with Arsenal. The club wants more.');
  });
});
