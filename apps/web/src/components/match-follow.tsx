import Link from '@/components/ui/link';
import type { FixtureStatus, FollowedEntity } from '@fmip/contracts';
import { followAction, unfollowAction } from '@/lib/auth-actions';
import { loginHref } from '@/lib/return-to';
import { FollowIntentMark } from '@/components/push-offer-mark';
import { PushOfferFor } from '@/components/push-offer-for';
import { Translated } from '@/components/translated';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/** A match whose follow window is closing or closed: full-time or a result by other means. */
const OVER: readonly FixtureStatus[] = ['finished', 'awarded', 'cancelled', 'abandoned'];

/**
 * Follow a match (blueprint 12.1, T-945, D-116). One plain form, posting the
 * same follow the settings page posts, so it works without JavaScript.
 *
 * A followed match joins the member to its alerts under their own match-alert
 * switches, mutes and quiet hours; following it as well as its teams tells
 * them nothing twice. Following it brings up the offer of push on this device
 * when the device has none (T-1429). The follow ends by itself three hours after full-time,
 * and the sentence beside the button says so, so nobody wonders why a match
 * from last week is no longer followed. A match that is over is not offered
 * (the API would allow the last three hours, but there is nothing left to be
 * told), and an unreachable follow list is a sentence, never a guessed button.
 *
 * Since T-1743 (D-364) its pieces are items of the match page's tools row
 * (`MatchToolsRow`, a wrapping flex row). On a phone the control itself is
 * the row's last item -- for a guest the one word "Follow", a link to sign
 * in that comes back to this match (`loginHref`), where a line of its own
 * said "Sign in to follow this match" -- and every sentence takes a full line
 * under the row. From 768px each state is a line of its own under the row,
 * worded as before. A guest is offered nothing once the match is over: the
 * short word would promise a follow the member's own page then refuses.
 */
export function MatchFollow({
  locale,
  fixtureId,
  name,
  status,
  signedIn,
  following,
}: {
  locale: string;
  fixtureId: string;
  /** "Arsenal v Chelsea", for the push offer. */
  name: string;
  status: FixtureStatus;
  signedIn: boolean;
  /** The member's follows, or null when they could not be read. */
  following: FollowedEntity[] | null;
}) {
  const over = OVER.includes(status);
  if (!signedIn) {
    if (over) return null;
    return (
      <p
        className="ms-auto text-sm md:ms-0 md:mt-4 md:basis-full md:text-muted"
        data-testid="match-follow-guest"
      >
        <Link
          href={loginHref(locale, `/${locale}/match/${fixtureId}`)}
          className="inline-flex min-h-touch items-center gap-1.5 font-bold text-accent md:min-h-0 md:font-normal md:text-muted md:underline"
        >
          <Icon name="star" className="md:hidden" />
          <span className="md:hidden">
            <Translated locale={locale} message="match.follow.short" />
          </span>
          <span className="max-md:hidden">
            <Translated locale={locale} message="match.follow.signIn" />
          </span>
        </Link>
      </p>
    );
  }
  if (following === null) {
    return (
      <p className="basis-full text-sm text-muted md:mt-4" data-testid="match-follow-unreachable">
        <Translated locale={locale} message="match.follow.unreachable" />
      </p>
    );
  }
  const followed = following.some((f) => f.entity_type === 'fixture' && f.entity_id === fixtureId);
  if (!followed && over) {
    return (
      <p className="basis-full text-sm text-muted md:mt-4" data-testid="match-follow-over">
        <Translated locale={locale} message="match.follow.over" />
      </p>
    );
  }
  const action = (followed ? unfollowAction : followAction).bind(null, locale);
  const form = (
    // On a phone the form is no box (`contents`): its button is the tools
    // row's last item and its sentence the line under the row.
    <form
      action={action}
      className="max-md:contents md:mt-4 md:flex md:basis-full md:flex-wrap md:items-center md:gap-x-3 md:gap-y-1"
      data-testid="match-follow"
    >
      <input type="hidden" name="entity_type" value="fixture" />
      <input type="hidden" name="entity_id" value={fixtureId} />
      {!followed && <FollowIntentMark />}
      <span className="max-md:ms-auto">
        {/* In the phone's tools row every control is a 44px target. */}
        <Button
          type="submit"
          variant={followed ? 'ghost' : 'secondary'}
          size="sm"
          className="max-md:min-h-touch"
        >
          {followed ? (
            <Translated locale={locale} message="match.follow.stop" />
          ) : (
            <>
              <span className="md:hidden">
                <Translated locale={locale} message="match.follow.short" />
              </span>
              <span className="max-md:hidden">
                <Translated locale={locale} message="match.follow.start" />
              </span>
            </>
          )}
        </Button>
      </span>
      <span className="text-sm text-muted max-md:basis-full max-md:pb-2 max-md:text-xs">
        <Translated
          locale={locale}
          message={followed ? 'match.follow.following' : 'match.follow.note'}
        />
      </span>
    </form>
  );
  if (!followed) return form;
  return (
    <>
      {form}
      <div className="basis-full md:mt-2">
        <PushOfferFor locale={locale} entity={{ type: 'fixture', id: fixtureId }} name={name} />
      </div>
    </>
  );
}
