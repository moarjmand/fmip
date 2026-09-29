import type { Covered, StoryTypeLabel } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { LABEL_ORIGIN_KEY, STORY_TYPE_KEY } from '@/lib/news';

/**
 * A story's type and whose word it is (T-1001, D-123): the publisher's own
 * category or an editor's label, named as such. A story with no type says so
 * where `sayNone` is set (the story page); a card simply carries no tag,
 * because a list of "no type" lines would bury the headlines. Never a
 * default type (rule 3).
 */
export function StoryTypeTag({
  locale,
  type,
  sayNone = false,
}: {
  locale: string;
  type: Covered<StoryTypeLabel>;
  sayNone?: boolean;
}) {
  if (type.data === null || type.coverage === 'not_supplied') {
    return sayNone ? (
      <p className="text-sm text-muted" data-testid="story-type-none">
        <Translated locale={locale} message="story.type.none" />
      </p>
    ) : null;
  }
  return (
    <p className="text-sm" data-testid="story-type" data-type={type.data.type}>
      <span className="rounded bg-surface-raised px-2 py-0.5 font-medium">
        <Translated locale={locale} message={STORY_TYPE_KEY[type.data.type]} />
      </span>{' '}
      <span className="text-muted">
        <Translated locale={locale} message={LABEL_ORIGIN_KEY[type.data.origin]} />
      </span>
    </p>
  );
}
