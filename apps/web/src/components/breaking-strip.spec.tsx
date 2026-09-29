import type { NewsStoryCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { directionOf } from '@/i18n/locales';
import { BreakingStrip } from './breaking-strip';

/** The homepage's breaking strip (T-1004, D-125), left to right and right to left. */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function card(id: string, breaking: NewsStoryCard['breaking']): NewsStoryCard {
  return {
    story_id: id,
    article_id: `a-${id}`,
    headline: `Headline ${id}`,
    summary: null,
    byline: null,
    language: 'en',
    origin: 'publisher',
    review_state: null,
    published_at: '2026-09-29T08:00:00.000Z',
    fetched_at: '2026-09-29T08:05:00.000Z',
    url: `https://publisher.test/${id}`,
    source: {
      id: 's',
      name: 'The Publisher',
      homepage_url: 'https://publisher.test',
      rights: 'headline',
    },
    entities: [],
    other_reports: 0,
    type: { coverage: 'not_supplied', last_updated_at: null, data: null },
    discussion: null,
    debate: null,
    breaking,
  };
}

const MARK = {
  note: 'The manager has been sacked.',
  marked_at: '2026-09-29T08:10:00.000Z',
  ends_at: '2026-09-29T14:10:00.000Z',
};

describe('BreakingStrip', () => {
  it('draws nothing when nothing is marked -- no empty strip', () => {
    expect(renderToStaticMarkup(<BreakingStrip locale="en" stories={[]} />)).toBe('');
    expect(renderToStaticMarkup(<BreakingStrip locale="en" stories={[card('1', null)]} />)).toBe(
      '',
    );
  });

  it("shows each marked story with the editor's note, the headline in its language and the story page", () => {
    const html = renderToStaticMarkup(
      <BreakingStrip locale="en" stories={[card('1', MARK), card('2', null)]} />,
    );
    expect(html).toContain('data-testid="breaking-strip"');
    expect(html.match(/data-testid="breaking-story"/g)).toHaveLength(1);
    expect(html).toContain('Headline 1');
    expect(html).not.toContain('Headline 2');
    expect(html).toContain('The manager has been sacked.');
    expect(html).toContain('href="/en/news/story/1"');
    expect(html).toContain('lang="en"');
  });

  it('uses no physical side under the right-to-left pseudo-locale (rule 7)', () => {
    expect(directionOf('x-rtl')).toBe('rtl');
    const html = renderToStaticMarkup(<BreakingStrip locale="x-rtl" stories={[card('1', MARK)]} />);
    expect(html).toContain('href="/x-rtl/news/story/1"');
    expect(html).toContain('border-s-4');
    expect(html).not.toMatch(PHYSICAL);
  });
});
