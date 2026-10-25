import type { NewsStoryCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewsStory } from './news-story';

/**
 * One story on the news page (T-1570). The publisher's headline and summary
 * carry the story's language and their own direction, so an English story on
 * `/fa` reads left to right with its full stop at its end; the reader's own
 * words around them ("Read at", the story page) keep the page's language.
 * Its links are 44px tall on a phone and at least 24px everywhere.
 */

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
      entity_type: 'team',
      entity_id: '00000000-0000-4000-8000-000000000601',
      name: 'Liverpool',
      localised_name: 'لیورپول',
    },
  ],
  other_reports: 0,
  type: { coverage: 'not_supplied', data: null, last_updated_at: null },
  discussion: null,
  debate: null,
  breaking: null,
} as NewsStoryCard;

const html = renderToStaticMarkup(<NewsStory card={card} locale="fa" timeZone="UTC" />);

describe('a story on the news page', () => {
  it("marks the publisher's words with their language and direction, not the whole card", () => {
    expect(html).toMatch(/<article [^>]*data-testid="story"/);
    expect(html).not.toMatch(/<article [^>]*lang=/);
    expect(html).toMatch(/<a [^>]*lang="en-US" dir="auto"[^>]*data-testid="story-link"/);
    expect(html).toMatch(/<p lang="en-US" dir="auto" data-testid="story-summary">/);
  });

  it('gives its links a touch target on a phone', () => {
    expect(html).toMatch(/data-testid="story-more"><a [^>]*class="[^"]*min-h-touch[^"]*md:min-h-6/);
    expect(html).toMatch(/<a [^>]*class="[^"]*min-h-touch[^"]*"[^>]*>لیورپول<\/a>/);
  });
});
