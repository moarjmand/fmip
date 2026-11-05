import type { FollowedEntity, NewsEntity } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { Translated } from '@/components/translated';
import { storyFollowAction } from '@/lib/story-actions';

/**
 * The story page's controls that lead somewhere else (T-941, blueprint 3.3):
 * following what the story is about. The match's prediction products are
 * `story-predictions.tsx` since T-1741 (D-362).
 */

type Followable = NewsEntity & { entity_type: 'team' | 'competition' };

/** The teams and competitions a story links, in the order it links them. */
export function followableEntities(entities: readonly NewsEntity[]): Followable[] {
  return entities.filter(
    (e): e is Followable => e.entity_type === 'team' || e.entity_type === 'competition',
  );
}

/**
 * A follow control per team and competition the story links. A guest is
 * asked to sign in; a member whose follows could not be read is told so,
 * rather than offered a button that may say the opposite of the truth.
 * Each is a plain form, so it works without JavaScript.
 */
export function StoryFollowControls({
  locale,
  storyId,
  entities,
  signedIn,
  following,
}: {
  locale: string;
  storyId: string;
  entities: readonly Followable[];
  signedIn: boolean;
  /** `null` when `/me/following` could not be read. */
  following: readonly FollowedEntity[] | null;
}) {
  if (entities.length === 0) return null;
  const action = storyFollowAction.bind(null, locale, storyId);
  return (
    <section aria-labelledby="story-follow" className="flex flex-col gap-2 text-sm">
      <h2 id="story-follow" className="font-semibold">
        <Translated locale={locale} message="story.follow.title" />
      </h2>
      {!signedIn ? (
        <p className="text-muted" data-testid="story-follow-sign-in">
          <Link href={`/${locale}/login`} className="underline">
            <Translated locale={locale} message="story.follow.signIn" />
          </Link>
        </p>
      ) : following === null ? (
        <p className="text-muted" data-testid="story-follow-unavailable">
          <Translated locale={locale} message="story.follow.unavailable" />
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="story-follow">
          {entities.map((entity) => {
            const followed = following.some(
              (f) => f.entity_type === entity.entity_type && f.entity_id === entity.entity_id,
            );
            const name = entity.localised_name ?? entity.name ?? '';
            return (
              <li
                key={`${entity.entity_type}:${entity.entity_id}`}
                className="flex flex-wrap items-center gap-2"
              >
                <bdi>{name}</bdi>
                <form action={action} className="contents">
                  <input type="hidden" name="entity_type" value={entity.entity_type} />
                  <input type="hidden" name="entity_id" value={entity.entity_id} />
                  <input type="hidden" name="intent" value={followed ? 'unfollow' : 'follow'} />
                  {followed && (
                    <span className="text-muted" data-testid="story-following">
                      <Translated locale={locale} message="story.follow.following" />
                    </span>
                  )}
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center underline"
                    data-testid={followed ? 'story-unfollow' : 'story-follow-button'}
                  >
                    <Translated
                      locale={locale}
                      message={followed ? 'story.follow.unfollow' : 'story.follow.follow'}
                    />
                    <span className="sr-only"> {name}</span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
