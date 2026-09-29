import {
  STORY_TYPES,
  type DebateRecord,
  type NewsStoryCard,
  type StoryType,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the desk only binds them.
vi.mock('@/lib/story-type-actions', () => ({ labelStoryTypeAction: async () => null }));
vi.mock('@/lib/breaking-actions', () => ({
  markBreakingAction: async () => null,
  clearBreakingAction: async () => null,
}));
vi.mock('@/lib/debate-actions', () => ({
  selectDebateAction: async () => null,
  clearDebateAction: async () => null,
}));

const { NewsDesk } = await import('./news-desk');

/**
 * The news desk (T-1009): the three decisions on one page, each form asking
 * for the words its API asks for, the chosen story's record of decisions,
 * and the type's earlier labels named as not shown to an editor. Logical
 * properties only (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const STORY = '00000000-0000-4000-8000-00000000a001';
const TYPE_NAMES = Object.fromEntries(STORY_TYPES.map((type) => [type, `name:${type}`])) as Record<
  StoryType,
  string
>;

function card(overrides: Partial<NewsStoryCard> = {}): NewsStoryCard {
  return {
    story_id: STORY,
    article_id: '00000000-0000-4000-8000-00000000b001',
    headline: 'مدرب يرحل',
    summary: null,
    byline: null,
    language: 'ar',
    origin: 'publisher',
    review_state: null,
    published_at: null,
    fetched_at: '2026-09-29T08:00:00.000Z',
    url: 'https://publisher.test/a',
    source: {
      id: 's',
      name: 'A Publisher',
      homepage_url: 'https://publisher.test',
      rights: 'headline',
    },
    entities: [],
    other_reports: 0,
    type: { coverage: 'not_supplied', data: null, last_updated_at: null },
    discussion: null,
    debate: null,
    breaking: null,
    ...overrides,
  } as NewsStoryCard;
}

const OPEN_DEBATE: DebateRecord = {
  story_id: STORY,
  headline: 'مدرب يرحل',
  selected_by: 'editor_a',
  note: 'Two readings.',
  selected_at: '2026-09-29T08:00:00.000Z',
  cleared_by: null,
  cleared_reason: null,
  cleared_at: null,
};

function render(props: Partial<Parameters<typeof NewsDesk>[0]> = {}): string {
  return renderToStaticMarkup(
    <NewsDesk
      locale="en"
      typeNames={TYPE_NAMES}
      stories={[card()]}
      openDebates={[]}
      liveMarks={[]}
      selection={null}
      asked={null}
      {...props}
    />,
  );
}

describe('NewsDesk (T-1009)', () => {
  it('offers the three decisions for the chosen story, each with its words', () => {
    const html = render({
      selection: { card: card(), debate: null, history: [], typeHistory: 'shown' },
    });
    expect(html).toContain('data-testid="desk-type-form"');
    expect(html).toContain('data-testid="desk-breaking-mark"');
    expect(html).toContain('data-testid="desk-debate-select"');
    // Every form requires its words: the reason for a type, the note for a mark or a selection.
    expect(html).toMatch(/name="reason"[^>]*required|required[^>]*name="reason"/);
    expect(html.match(/name="note"/g)).toHaveLength(2);
    for (const type of STORY_TYPES) expect(html).toContain(`value="${type}"`);
    expect(html).toContain('data-testid="story-type-none"');
    expect(html).toContain('data-testid="desk-history-empty"');
    expect(html).not.toContain('desk-type-history-hidden');
  });

  it('offers to clear a mark in force and a selection with a reason', () => {
    const html = render({
      selection: {
        card: card({
          breaking: {
            note: 'Gone.',
            marked_at: '2026-09-29T09:00:00.000Z',
            ends_at: '2026-09-29T15:00:00.000Z',
          },
        }),
        debate: OPEN_DEBATE,
        history: [
          {
            kind: 'type_labelled',
            at: '2026-09-29T10:00:00.000Z',
            by: 'editor_c',
            words: 'It is a transfer.',
            type: { previous: null, next: 'transfer' },
          },
          { kind: 'breaking_expired', at: '2026-09-29T09:00:00.000Z', by: null, words: null },
        ],
        typeHistory: 'administrators_only',
      },
    });
    expect(html).toContain('data-testid="desk-breaking-clear"');
    expect(html).toContain('data-testid="desk-debate-clear"');
    expect(html).not.toContain('desk-breaking-mark');
    expect(html).not.toContain('desk-debate-select');
    expect(html.match(/data-testid="desk-history-event"/g)).toHaveLength(2);
    expect(html).toContain('none → name:transfer');
    expect(html).toContain('by editor_c');
    expect(html).toContain('data-testid="desk-type-history-hidden"');
  });

  it('lists the latest stories with their state, right to left where the headline is', () => {
    const html = render({ openDebates: [OPEN_DEBATE] });
    expect(html).toContain('data-testid="desk-story-item"');
    expect(html).toContain('on the debate page');
    expect(html).toMatch(/lang="ar"[^>]*dir="auto"/);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says so when the stories cannot be read or the asked story does not exist', () => {
    const html = render({ stories: null, asked: STORY });
    expect(html).toContain('data-testid="desk-latest-unreachable"');
    expect(html).toContain('data-testid="desk-no-story"');
  });
});
