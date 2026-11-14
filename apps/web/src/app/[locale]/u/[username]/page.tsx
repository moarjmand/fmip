import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import { AchievementsSection } from '@/components/achievements';
import { StartConversation } from '@/components/conversation-controls';
import { Pictured } from '@/components/lite-mode';
import { isDeletedMember } from '@fmip/contracts';
import { FirstStepsCard, ProfileStateRow } from '@/components/first-steps';
import { HowRatingsWork, SettledProgressBar } from '@/components/settled-progress';
import { Said } from '@/components/community-text';
import { FriendControls } from '@/components/friend-controls';
import { MemberHandle, MemberName } from '@/components/member-name';
import { memberName } from '@/lib/member-name';
import { ShareLink } from '@/components/share-link';
import { PredictionHistory } from '@/components/prediction-history';
import { RatingHistorySection } from '@/components/rating-history';
import { Translated } from '@/components/translated';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import {
  fetchAchievements,
  fetchFollowing,
  fetchFriendStatus,
  fetchMe,
  fetchPredictionHistory,
  fetchProfile,
  fetchRating,
  fetchRatingHistory,
} from '@/lib/api';
import { firstSteps } from '@/lib/first-steps';
import { plainNumber } from '@/lib/prediction-text';
import { stepHref } from '@/lib/first-run';
import { PICKS_PATH } from '@/lib/shell-nav';
import { floorProgress, ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { inviteUrl } from '@/lib/invite';
import { historyQuery, readHistoryPage } from '@/lib/prediction-history';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  const name = decodeURIComponent(username);
  return pageMetadata({
    locale,
    // The member's own card (`opengraph-image.tsx`), never the brand one.
    card: 'own',
    path: `/u/${encodeURIComponent(name)}`,
    title: `${memberName(locale, { username: name })} · Stadiomind`,
  });
}

/**
 * A member's public profile (blueprint 7.2). What arrives is already filtered
 * by the API for this viewer: a restricted profile carries only the username
 * and display name, and that is all this page can show. The prediction
 * history (T-056) has its own visibility, decided by the API the same way.
 */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, username }, query] = await Promise.all([params, searchParams]);
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cookie = await sessionCookieHeader();
  const name = decodeURIComponent(username);
  const [result, friendStatus] = await Promise.all([
    fetchProfile(name, cookie),
    // The controls belong on both branches below: a friends-only profile the
    // viewer cannot see is exactly the profile they may want to ask about.
    fetchFriendStatus(name, cookie),
  ]);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">{memberName(locale, { username: name })}</h1>
        <Notice tone="danger">
          <Translated locale={locale} message="profile.unreachable" />
        </Notice>
      </main>
    );
  }

  if (isDeletedMember(name)) {
    // A tombstone (T-812, T-908): the account is gone, so there is no name,
    // no handle, and nothing to befriend or message.
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold" data-testid="profile-name">
          <MemberName locale={locale} member={{ username: name }} />
        </h1>
      </main>
    );
  }

  const view = result.data;
  // Arrived here from registering through this member's invite link (T-522).
  const invited =
    query.invited === '1' &&
    friendStatus !== null &&
    friendStatus !== 'self' &&
    friendStatus !== 'friends' ? (
      <p role="status" data-testid="invited-note">
        {interpolate(t(lang, 'profile.invited'), { name: memberName(locale, { username: name }) })}
      </p>
    ) : null;

  if (view.kind === 'restricted') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold" data-testid="profile-name">
          <MemberName locale={locale} member={view} />
        </h1>
        <MemberHandle username={view.username} className="text-muted" />
        {invited}
        <p data-testid="profile-restricted">
          <Translated
            locale={locale}
            message={
              view.visibility === 'friends'
                ? 'profile.restrictedFriends'
                : 'profile.restrictedPrivate'
            }
          />
        </p>
        <FriendControls locale={locale} username={view.username} status={friendStatus} />
      </main>
    );
  }

  const { profile } = view;
  const own = view.is_self;
  const page = readHistoryPage(query);
  const [me, rating, history, ratingHistory, achievements, following] = await Promise.all([
    fetchMe(cookie),
    fetchRating(profile.username),
    fetchPredictionHistory(profile.username, historyQuery(page), cookie),
    fetchRatingHistory(profile.username, cookie),
    fetchAchievements(profile.username, cookie),
    // Only for "Your first steps" (T-1787): whether the member follows a team.
    own ? fetchFollowing(cookie) : Promise.resolve(null),
  ]);
  const { timeZone } = await pageTimeZone(locale, me);
  // English has always shown these instants as the API gives them; every
  // other language reads them in its own calendar and digits (T-1306).
  const shownDay = (iso: string): string =>
    lang === DEFAULT_LOCALE
      ? iso
      : formatDate(lang, iso, 'UTC', { day: 'numeric', month: 'short', year: 'numeric' });
  const shownInstant = (iso: string): string =>
    lang === DEFAULT_LOCALE ? iso : formatDateTime(lang, iso, timeZone);
  const profileHref = `/${locale}/u/${encodeURIComponent(profile.username)}`;
  const pageHref = (p: number): string => `${profileHref}${p > 1 ? `?page=${p}` : ''}`;

  // A new member's profile (T-1787, D-390; board P7-6). The count is the
  // rating's own (0 while it is null), the floor the one the rating response
  // carries -- the leaderboard's -- never a typed number (rule 3). The bar is
  // drawn only below the floor (null from it on), on the card and under the
  // rating alike: from the floor `settled_count` is no longer "N of floor".
  const rated = rating.ok ? rating.data.rating : null;
  const progress = rating.ok ? floorProgress(rated?.settled_count ?? 0, rating.data.floor) : null;
  const visibleHistory = history.ok && history.data.kind !== 'restricted' ? history.data : null;
  const steps = own
    ? firstSteps({
        settled: rating.ok ? (rated?.settled_count ?? 0) : null,
        predictions: visibleHistory === null ? null : visibleHistory.total,
        followsTeam:
          following === null ? null : following.some((entity) => entity.entity_type === 'team'),
        favouriteTeams: profile.favourite_teams.length,
        bio: profile.bio,
      })
    : null;
  const stepsShown = steps?.shown === true;
  // The bar under a rating: a visitor's, or the member's own once the card has gone.
  const ratingBar = progress !== null && !stepsShown;
  // An empty section is one 48px line with its state word (D-383's row).
  const ratingOverTimeEmpty =
    ratingHistory.ok &&
    ratingHistory.data.kind === 'visible' &&
    ratingHistory.data.history === null;
  const achievementsEmpty =
    achievements.ok &&
    achievements.data.kind === 'visible' &&
    achievements.data.achievements.earned.length === 0;
  const historyEmpty = visibleHistory !== null && visibleHistory.items.length === 0 && page === 1;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-start gap-4">
        {profile.avatar_url !== null && (
          // A plain <img>: avatars are remote URLs the member chose, and Next's
          // image optimiser would need every host allow-listed. None in lite
          // mode (T-1387); the name beside it is the profile's heading.
          <Pictured>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profile.avatar_url}
              alt=""
              width={64}
              height={64}
              className="size-16 rounded-full object-cover"
            />
          </Pictured>
        )}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold" data-testid="profile-name">
            <bdi>
              <MemberName locale={locale} member={profile} />
            </bdi>
          </h1>
          <bdi>
            <MemberHandle username={profile.username} className="text-muted" />
          </bdi>
          <p className="text-sm text-muted">
            <Translated locale={locale} message="profile.memberSince" />{' '}
            <time dateTime={profile.member_since}>{shownDay(profile.member_since)}</time>
          </p>
        </div>
        {view.is_self && (
          <Link href={`/${locale}/settings`} className="ms-auto text-sm underline">
            <Translated locale={locale} message="profile.edit" />
          </Link>
        )}
      </header>

      {invited}
      {steps !== null && stepsShown && (
        <FirstStepsCard
          locale={locale}
          steps={steps.steps}
          progress={progress}
          hrefs={{
            pick: `/${locale}${PICKS_PATH}`,
            follow: stepHref(locale, 'teams', profileHref),
            bio: `/${locale}/settings`,
          }}
        />
      )}
      {view.is_self && (
        <p className="text-sm" data-testid="invite-link">
          <ShareLink
            url={inviteUrl(locale, profile.username)}
            title={t(lang, 'profile.inviteTitle')}
            label={t(lang, 'profile.inviteLabel')}
            messages={{
              copied: message(lang, 'share.copied'),
              manual: message(lang, 'share.manual'),
            }}
          />
        </p>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <FriendControls locale={locale} username={profile.username} status={friendStatus} />
        {friendStatus === 'friends' && (
          <StartConversation locale={locale} username={profile.username} />
        )}
        {friendStatus !== null && friendStatus !== 'self' && (
          <Link
            href={`/${locale}/u/${encodeURIComponent(profile.username)}/compare`}
            className="text-sm underline"
            data-testid="compare-link"
          >
            <Translated locale={locale} message="profile.compareLink" />
          </Link>
        )}
      </div>

      {/* No bio is not drawn (T-1787, D-390): to a visitor it says nothing,
          and the member's own page asks for one in its first steps. */}
      {profile.bio !== null && (
        <p className="whitespace-pre-line" data-testid="profile-bio">
          {profile.bio}
        </p>
      )}

      {profile.favourite_teams.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="profile.favourites" />
          </h2>
          <ul className="flex flex-wrap gap-2" data-testid="favourite-teams">
            {profile.favourite_teams.map((team) => (
              <li key={team} className="rounded border border-default px-2 py-1 text-sm">
                <bdi>{team}</bdi>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        // None is drawn for a visitor; the member sees the line that will fill in.
        own && (
          <ProfileStateRow
            locale={locale}
            id="profile-favourites"
            heading="profile.favourites"
            word="profile.state.none"
            testId="favourites-none"
          >
            <Translated locale={locale} message="profile.noFavourites" />
          </ProfileStateRow>
        )
      )}

      {own && rated === null && rating.ok ? (
        // The member's own: the count and the floor are on the first steps' card.
        <div data-testid="rating">
          <ProfileStateRow
            locale={locale}
            id="profile-rating"
            heading="profile.rating.heading"
            word="profile.state.notRated"
            testId="rating-none"
          >
            <Translated locale={locale} message="profile.rating.none" />
          </ProfileStateRow>
        </div>
      ) : (
        <section className="flex flex-col gap-2" data-testid="rating">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="profile.rating.heading" />
          </h2>
          {!rating.ok ? (
            <Notice tone="danger">
              <Translated locale={locale} message="profile.rating.unreachable" />
            </Notice>
          ) : rating.data.rating === null ? (
            <p className="text-sm text-muted" data-testid="rating-none">
              <Translated locale={locale} message="profile.rating.none" />
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted">
                  <Translated locale={locale} message="profile.rating.rating" />
                </dt>
                <dd className="text-2xl font-semibold tabular-nums" data-testid="rating-value">
                  {ratingLabel(rating.data.rating, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">
                  <Translated locale={locale} message="profile.rating.tier" />
                </dt>
                <dd>{tierLabel(rating.data.rating.tier, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">
                  <Translated locale={locale} message="profile.rating.status" />
                </dt>
                <dd>{statusLabel(rating.data.rating, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">
                  <Translated locale={locale} message="profile.rating.settled" />
                </dt>
                <dd className="tabular-nums">
                  {formatNumber(lang, rating.data.rating.settled_count)}
                </dd>
              </div>
              <dd className="col-span-full text-xs text-muted">
                {rating.data.rating.formula_version} ·{' '}
                <Translated locale={locale} message="profile.rating.computed" />{' '}
                <time dateTime={rating.data.rating.computed_at}>
                  {shownInstant(rating.data.rating.computed_at)}
                </time>
              </dd>
            </dl>
          )}
          {/* Under a missing or provisional rating, the way to the floor (T-1787, D-390). */}
          {ratingBar && progress !== null && (
            <div className="flex flex-col gap-1">
              <SettledProgressBar
                locale={locale}
                own={own}
                progress={progress}
                note={
                  rated === null ? (
                    <Translated locale={locale} message="profile.progress.unrated" />
                  ) : (
                    <Said
                      locale={locale}
                      message="profile.progress.belowFloor"
                      params={{ floor: plainNumber(locale, progress.floor) }}
                    />
                  )
                }
              />
              <div>
                <HowRatingsWork locale={locale} testId="how-ratings-work" />
              </div>
            </div>
          )}
        </section>
      )}

      {ratingOverTimeEmpty ? (
        <div data-testid="rating-over-time">
          <ProfileStateRow
            locale={locale}
            id="profile-rating-over-time"
            heading="profile.ratingOverTime"
            word="profile.state.none"
            testId="rating-history-none"
          >
            <Translated locale={locale} message="profile.ratingHistory.none" />
          </ProfileStateRow>
        </div>
      ) : (
        <section className="flex flex-col gap-2" data-testid="rating-over-time">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="profile.ratingOverTime" />
          </h2>
          <RatingHistorySection
            locale={locale}
            direction={directionOf(locale)}
            result={ratingHistory}
          />
        </section>
      )}

      {/* The anchor an achievement notification opens (T-946). */}
      {achievementsEmpty ? (
        <div id="achievements" data-testid="achievements">
          <ProfileStateRow
            locale={locale}
            id="profile-achievements"
            heading="achievements.title"
            word="profile.state.none"
            testId="achievements-none"
          >
            <Translated locale={locale} message="achievements.none" />
          </ProfileStateRow>
        </div>
      ) : (
        <section id="achievements" className="flex flex-col gap-2" data-testid="achievements">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="achievements.title" />
          </h2>
          <AchievementsSection locale={locale} result={achievements} />
        </section>
      )}

      {historyEmpty ? (
        <ProfileStateRow
          locale={locale}
          id="profile-predictions"
          heading="nav.predictions"
          word="profile.state.none"
          testId="history-empty"
        >
          <Translated locale={locale} message="history.empty" />
        </ProfileStateRow>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="nav.predictions" />
          </h2>
          {!history.ok ? (
            <Notice tone="danger" data-testid="history-unreachable">
              <Translated locale={locale} message="profile.history.unreachable" />
            </Notice>
          ) : history.data.kind === 'restricted' ? (
            <p className="text-sm text-muted" data-testid="history-restricted">
              <Translated
                locale={locale}
                message={
                  history.data.visibility === 'friends'
                    ? 'profile.history.restrictedFriends'
                    : 'profile.history.restrictedPrivate'
                }
              />
            </p>
          ) : (
            <PredictionHistory
              locale={locale}
              timeZone={timeZone}
              items={history.data.items}
              total={history.data.total}
              page={page}
              pageHref={pageHref}
            />
          )}
        </section>
      )}
    </main>
  );
}
