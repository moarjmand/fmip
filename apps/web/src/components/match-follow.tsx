import Link from 'next/link';
import type { FixtureStatus, FollowedEntity } from '@fmip/contracts';
import { followAction, unfollowAction } from '@/lib/auth-actions';
import { Translated } from '@/components/translated';
import { Button } from '@/components/ui';

/** A match whose follow window is closing or closed: full-time or a result by other means. */
const OVER: readonly FixtureStatus[] = ['finished', 'awarded', 'cancelled', 'abandoned'];

/**
 * Follow a match (blueprint 12.1, T-945, D-116). One plain form, posting the
 * same follow the settings page posts, so it works without JavaScript.
 *
 * A followed match joins the member to its alerts under their own match-alert
 * switches, mutes and quiet hours; following it as well as its teams tells
 * them nothing twice. The follow ends by itself three hours after full-time,
 * and the sentence beside the button says so, so nobody wonders why a match
 * from last week is no longer followed. A match that is over is not offered
 * (the API would allow the last three hours, but there is nothing left to be
 * told), and an unreachable follow list is a sentence, never a guessed button.
 */
export function MatchFollow({
  locale,
  fixtureId,
  status,
  signedIn,
  following,
}: {
  locale: string;
  fixtureId: string;
  status: FixtureStatus;
  signedIn: boolean;
  /** The member's follows, or null when they could not be read. */
  following: FollowedEntity[] | null;
}) {
  if (!signedIn) {
    return (
      <p className="text-sm text-muted" data-testid="match-follow-guest">
        <Link href={`/${locale}/login`} className="underline">
          <Translated locale={locale} message="match.follow.signIn" />
        </Link>
      </p>
    );
  }
  if (following === null) {
    return (
      <p className="text-sm text-muted" data-testid="match-follow-unreachable">
        <Translated locale={locale} message="match.follow.unreachable" />
      </p>
    );
  }
  const followed = following.some((f) => f.entity_type === 'fixture' && f.entity_id === fixtureId);
  if (!followed && OVER.includes(status)) {
    return (
      <p className="text-sm text-muted" data-testid="match-follow-over">
        <Translated locale={locale} message="match.follow.over" />
      </p>
    );
  }
  const action = (followed ? unfollowAction : followAction).bind(null, locale);
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="match-follow"
    >
      <input type="hidden" name="entity_type" value="fixture" />
      <input type="hidden" name="entity_id" value={fixtureId} />
      <Button type="submit" variant={followed ? 'ghost' : 'secondary'} size="sm">
        <Translated
          locale={locale}
          message={followed ? 'match.follow.stop' : 'match.follow.start'}
        />
      </Button>
      <span className="text-sm text-muted">
        <Translated
          locale={locale}
          message={followed ? 'match.follow.following' : 'match.follow.note'}
        />
      </span>
    </form>
  );
}
