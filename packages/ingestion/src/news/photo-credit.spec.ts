import { describe, expect, it } from 'vitest';
import { parseFeed } from './feed';
import { stripPhotoCredit } from './photo-credit';

/** A photo credit glued into a publisher's summary (T-1797), from the stories read on 2026-11-10. */
describe('stripPhotoCredit', () => {
  it('takes out a credit glued between two sentences, one space where it was', () => {
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

  it('takes out a credit with more than one agency, and one with its own full stop', () => {
    expect(
      stripPhotoCredit(
        'The deal is done.Photo by Mike Egerton/PA Wire/PA ImagesThe club confirmed.',
      ),
    ).toBe('The deal is done. The club confirmed.');
    expect(
      stripPhotoCredit('A late winner. Photograph by Sam Roe/Reuters. The coach smiled.'),
    ).toBe('A late winner. The coach smiled.');
  });

  it('leaves the publisher’s words alone otherwise (rule 3)', () => {
    for (const text of [
      'Images by fans flooded social media after the final whistle',
      'The U.S. side won 2-1... and then the rain came.',
      'A photo by the club shows the new kit.',
      'He was signed by Arsenal/Chelsea scouts, the report says.',
      // No agency closes these (code review 2026-11-12): prose, kept whole.
      'Pictures by fans show the chaos outside the stadium as police held back supporters…',
      'Fans gathered early. Images by drone captured the new stadium site at Bramley-Moore Dock...',
      // A credit the feed cut off: no agency closes it, so it is not known to be one.
      'Chelsea are weighing a January move. Photo by Lewis St...',
      'A late winner. Photo by Lewis St…',
      // A credit followed by more than a new sentence: left whole, never half cut.
      'Photo by Julian Finney/Getty Images for Premier League. Ten Hag said.',
      'Ten Hag spoke. Photo by Julian Finney/Getty Images for Premier League.',
      // Inside a sentence, not after one: kept.
      'The club shared a Photo by Sam Roe/Reuters The coach liked.',
      // A summary's line breaks and spacing are the publisher's, kept when nothing is cut.
      'Line one.\n\nLine  two.',
    ]) {
      expect(stripPhotoCredit(text)).toBe(text);
    }
    expect(stripPhotoCredit(null)).toBeNull();
  });

  it('never empties a summary: one that is a credit alone stays as written', () => {
    for (const text of [
      'Photo by Maja Hitij/Getty Images',
      '(Photo by Jane Doe/AFP via Getty Images)',
    ]) {
      expect(stripPhotoCredit(text)).toBe(text);
    }
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
