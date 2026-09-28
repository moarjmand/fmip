import { Translated } from '@/components/translated';
import { saveArticleAction, unsaveArticleAction } from '@/lib/saved-actions';

/**
 * The save control on a news card and the story page (T-842): a plain form
 * over a server action, so it works without script. Saved, it says so and
 * offers to remove; not saved, it offers to save. The headline is in the
 * accessible name, in the publisher's own language, so a list of these is
 * not a list of identical buttons.
 */
export function SaveArticle({
  locale,
  storyId,
  headline,
  language,
  saved,
}: {
  locale: string;
  storyId: string;
  headline: string;
  language: string;
  saved: boolean;
}) {
  const action = (saved ? unsaveArticleAction : saveArticleAction).bind(null, locale);
  return (
    <form action={action} className="inline" data-testid="save-article" data-saved={saved}>
      <input type="hidden" name="story_id" value={storyId} />
      {saved && (
        <span className="me-2 text-sm text-muted" data-testid="save-article-state">
          <Translated locale={locale} message="saved.isSaved" />
        </span>
      )}
      <button type="submit" className="text-sm underline">
        <Translated locale={locale} message={saved ? 'saved.remove' : 'saved.save'} />
        <span className="sr-only" lang={language}>
          {' '}
          {headline}
        </span>
      </button>
    </form>
  );
}
