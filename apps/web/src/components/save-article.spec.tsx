import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/saved-actions', () => ({
  saveArticleAction: async () => undefined,
  unsaveArticleAction: async () => undefined,
}));

const { SaveArticle } = await import('./save-article');

/**
 * Saved articles on the web (T-842): a save control on the news cards and
 * the story page, and a Saved list under Following that shows the
 * publisher's headline and link only (D-061), says so when a publisher was
 * dropped, and is the member's own.
 */
const HERE = __dirname;
const read = (...path: string[]) => readFileSync(join(HERE, '..', ...path), 'utf8');
const NEWS = read('app', '[locale]', 'news', 'page.tsx');
const STORY = read('app', '[locale]', 'news', 'story', '[id]', 'page.tsx');
const FOLLOWING = read('app', '[locale]', 'following', 'page.tsx');
const SAVED = read('app', '[locale]', 'following', 'saved', 'page.tsx');
const ACTIONS = read('lib', 'saved-actions.ts');

const render = (saved: boolean, locale = 'en') =>
  renderToStaticMarkup(
    <SaveArticle
      locale={locale}
      storyId="00000000-0000-4000-8000-000000000001"
      headline="Le mercato"
      language="fr"
      saved={saved}
    />,
  );

describe('the save control (T-842)', () => {
  it('offers to save, naming the story in its own language', () => {
    const html = render(false);
    expect(html).toContain('data-saved="false"');
    expect(html).toContain('>Save<');
    expect(html).toContain('<span class="sr-only" lang="fr"> Le mercato</span>');
    expect(html).toContain('name="story_id" value="00000000-0000-4000-8000-000000000001"');
  });

  it('says a saved story is saved and offers to remove it', () => {
    const html = render(true);
    expect(html).toContain('data-saved="true"');
    expect(html).toContain('data-testid="save-article-state"');
    expect(html).toContain('Remove from saved');
  });

  it('marks its English as untranslated where nobody has translated it', () => {
    expect(render(false, 'ar')).toContain('data-translation="untranslated"');
  });
});

describe('where saving lives (T-842)', () => {
  it('puts the control on every news card for a member, outside the publisher-language article', () => {
    expect(NEWS).toContain('fetchSavedArticles(cookie)');
    expect(NEWS).toContain('saved={saved.has(card.story_id)}');
    expect(NEWS.indexOf('<SaveArticle')).toBeGreaterThan(NEWS.indexOf('<Story card={card}'));
  });

  it('puts it on the story page, and asks a guest to sign in instead', () => {
    expect(STORY).toContain('<SaveArticle');
    expect(STORY).toContain('data-testid="story-save-sign-in"');
  });

  it('lists the saved stories under Following, for the member only', () => {
    expect(FOLLOWING).toContain('/following/saved');
    expect(SAVED).toContain('redirect(`/${locale}/login?next=/${locale}/following/saved`)');
    expect(SAVED).toContain('fetchSavedArticles(cookie)');
    // A dropped publisher is said, not linked (D-061).
    expect(SAVED).toContain("'saved.dropped'");
    expect(SAVED).toContain("item.state !== 'available'");
    // Headline and link only: the list never renders a summary or a body.
    expect(SAVED).not.toMatch(/summary|body/);
  });

  it('writes through the API with the member session and refreshes the pages that show it', () => {
    expect(ACTIONS).toContain("method: 'PUT'");
    expect(ACTIONS).toContain("method: 'DELETE'");
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/following/saved`)');
  });
});
