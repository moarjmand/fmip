import { STORY_LABEL_ORIGINS, STORY_TYPES } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/messages';
import { LABEL_ORIGIN_KEY, STORY_TYPE_KEY } from '@/lib/news';
import { StoryTypeTag } from './story-type';

/** A story's type on the card and the story page (T-1001, D-123). */
describe('StoryTypeTag', () => {
  it('names the type and whose word it is', () => {
    const html = renderToStaticMarkup(
      <StoryTypeTag
        locale="en"
        type={{
          coverage: 'available',
          last_updated_at: '2026-09-29T10:00:00.000Z',
          data: { type: 'transfer', origin: 'publisher' },
        }}
      />,
    );
    expect(html).toContain('data-type="transfer"');
    expect(html).toContain('Transfer');
    expect(html).toContain('from the publisher&#x27;s own category');
  });

  it('says a story has no type on the story page, and draws nothing on a card', () => {
    const none = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
    expect(renderToStaticMarkup(<StoryTypeTag locale="en" type={none} />)).toBe('');
    const page = renderToStaticMarkup(<StoryTypeTag locale="en" type={none} sayNone />);
    expect(page).toContain('data-testid="story-type-none"');
    expect(page).toContain('No type');
  });

  it('has an English name for every type and every origin', () => {
    for (const type of STORY_TYPES) expect(t('en', STORY_TYPE_KEY[type])).not.toBe('');
    for (const origin of STORY_LABEL_ORIGINS)
      expect(t('en', LABEL_ORIGIN_KEY[origin])).not.toBe('');
  });
});
