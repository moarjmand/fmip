import type { TranslationDesk as Desk } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the component only binds them.
vi.mock('@/lib/translation-actions', () => ({
  writeTranslationAction: async () => null,
  reviewTranslationAction: async () => null,
}));

const { TranslationDesk } = await import('./translation-desk');

/**
 * The translator's desk (T-1013): the form in Arabic, right to left (rule 7);
 * the headline alone for a headline-only source (PL016); no review form for
 * the author; each check beside its field; and the glossary shown, never
 * written into a field.
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const PERSON_A = { id: 'a', username: 'writer' };
const PERSON_B = { id: 'b', username: 'reviewer' };

function desk(overrides: Partial<Desk> = {}): Desk {
  return {
    article_id: '00000000-0000-4000-8000-000000000aaa',
    story_id: '00000000-0000-4000-8000-000000000bbb',
    language: 'ar',
    source: {
      name: 'A Publisher',
      language: 'en',
      rights: 'summary',
      url: 'https://publisher.test/a',
      version_number: 1,
      headline: 'A goal settles it 2-1',
      summary: 'A late goal.',
      byline: null,
      updated_at: '2026-09-29T10:00:00.000Z',
    },
    fields: ['headline', 'summary'],
    translation: {
      version_number: 1,
      review_state: 'translated',
      written_by: PERSON_A,
      reviewed_by: null,
      updated_at: '2026-09-29T11:00:00.000Z',
      headline: 'هدف يحسمها ١-٢',
      summary: 'هدف متأخر.',
      byline: null,
    },
    checks: [
      {
        check: 'scorelines',
        field: 'headline',
        outcome: 'fail',
        expected: ['2-1'],
        found: ['1-2'],
        detail: 'The scorelines differ: missing 2-1; not in the source: 1-2.',
      },
      {
        check: 'numbers',
        field: 'headline',
        outcome: 'pass',
        expected: ['1', '2'],
        found: ['1', '2'],
        detail: 'The same numbers.',
      },
    ],
    glossary: [
      { key: 'term.goal', source: 'goal', locked: false, text: '', status: 'untranslated' },
    ],
    viewer_is_author: false,
    ...overrides,
  };
}

const render = (value: Desk) => renderToStaticMarkup(<TranslationDesk locale="ar" desk={value} />);

describe("the translator's desk", () => {
  it('writes Arabic right to left, in its own language, with nothing physical in the layout', () => {
    const html = render(desk());
    expect(html).toMatch(
      /<textarea[^>]*lang="ar"[^>]*dir="rtl"|<textarea[^>]*dir="rtl"[^>]*lang="ar"/,
    );
    expect(html).not.toMatch(PHYSICAL);
  });

  it('shows each check beside the field it concerns, in words', () => {
    const html = render(desk());
    expect(html).toContain('data-testid="desk-checks-headline"');
    expect(html).toContain('scorelines fails');
    expect(html).toContain('numbers passes');
    expect(html).toContain('missing 2-1');
  });

  it('asks the reviewer for a reason for each failing check, and only those', () => {
    const html = render(desk());
    expect(html).toContain('name="reason:headline.scorelines"');
    expect(html).not.toContain('name="reason:headline.numbers"');
  });

  it('offers no review to the author', () => {
    const html = render(desk({ viewer_is_author: true }));
    expect(html).toContain('data-testid="desk-review-author"');
    expect(html).not.toContain('desk-review-submit');
  });

  it('offers only the headline for a headline-only source', () => {
    const html = render(
      desk({
        source: { ...desk().source, rights: 'headline', summary: null },
        fields: ['headline'],
        translation: null,
        checks: [],
      }),
    );
    expect(html).toContain('name="headline"');
    expect(html).not.toContain('name="summary"');
    expect(html).toContain('data-testid="desk-headline-only"');
  });

  it('shows the glossary term unwritten, and never puts it in a field', () => {
    const written = desk({
      glossary: [
        { key: 'term.goal', source: 'goal', locked: true, text: 'هدف-مصطلح', status: 'reviewed' },
      ],
      translation: null,
      checks: [],
    });
    const html = render(written);
    expect(render(desk())).toContain('not written yet');
    // The term is shown once, beside the form, and no textarea holds it.
    expect(html.match(/هدف-مصطلح/g)).toHaveLength(1);
    expect(html).not.toMatch(/<textarea[^>]*>[^<]*هدف-مصطلح/);
  });
});
