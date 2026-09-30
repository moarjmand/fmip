import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AchievementsSection } from '@/components/achievements';
import { StartConversation } from '@/components/conversation-controls';
import { isDeletedMember } from '@fmip/contracts';
import { FriendControls } from '@/components/friend-controls';
import { MemberHandle, MemberName } from '@/components/member-name';
import { memberName } from '@/lib/member-name';
import { ShareLink } from '@/components/share-link';
import { PredictionHistory } from '@/components/prediction-history';
import { RatingHistorySection } from '@/components/rating-history';
import { Translated } from '@/components/translated';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import {
  fetchAchievements,
  fetchFriendStatus,
  fetchMe,
  fetchPredictionHistory,
  fetchProfile,
  fetchRating,
  fetchRatingHistory,
} from '@/lib/api';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { inviteUrl } from '@/lib/invite';
import { historyQuery, readHistoryPage } from '@/lib/prediction-history';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

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
    path: `/u/${encodeURIComponent(name)}`,
    title: `${memberName(locale, { username: name })} · FMIP`,
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
  const page = readHistoryPage(query);
  const [me, rating, history, ratingHistory, achievements] = await Promise.all([
    fetchMe(cookie),
    fetchRating(profile.username),
    fetchPredictionHistory(profile.username, historyQuery(page), cookie),
    fetchRatingHistory(profile.username, cookie),
    fetchAchievements(profile.username, cookie),
  ]);
  const timeZone = me?.timezone ?? 'UTC';
  // English has always shown these instants as the API gives them; every
  // other language reads them in its own calendar and digits (T-1306).
  const shownDay = (iso: string): string =>
    lang === DEFAULT_LOCALE
      ? iso
      : formatDate(lang, iso, 'UTC', { day: 'numeric', month: 'short', year: 'numeric' });
  const shownInstant = (iso: string): string =>
    lang === DEFAULT_LOCALE ? iso : formatDateTime(lang, iso, timeZone);
  const pageHref = (p: number): string =>
    `/${locale}/u/${encodeURIComponent(profile.username)}${p > 1 ? `?page=${p}` : ''}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-start gap-4">
        {profile.avatar_url !== null && (
          // A plain <img>: avatars are remote URLs the member chose, and Next's
          // image optimiser would need every host allow-listed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-full object-cover"
          />
        )}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold" data-testid="profile-name">
            <MemberName locale={locale} member={profile} />
          </h1>
          <MemberHandle username={profile.username} className="text-muted" />
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
      {view.is_self && (
        <p className="text-sm" data-testid="invite-link">
          <ShareLink
            url={inviteUrl(locale, profile.username)}
            title={t(lang, 'profile.inviteTitle')}
            label={t(lang, 'profile.inviteLabel')}
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

      {profile.bio !== null ? (
        <p className="whitespace-pre-line" data-testid="profile-bio">
          {profile.bio}
        </p>
      ) : (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="profile.noBio" />
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="profile.favourites" />
        </h2>
        {profile.favourite_teams.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="profile.noFavourites" />
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="favourite-teams">
            {profile.favourite_teams.map((team) => (
              <li key={team} className="rounded border border-default px-2 py-1 text-sm">
                {team}
              </li>
            ))}
          </ul>
        )}
      </section>

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
                {ratingLabel(rating.data.rating)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">
                <Translated locale={locale} message="profile.rating.tier" />
              </dt>
              <dd>{tierLabel(rating.data.rating.tier)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted">
                <Translated locale={locale} message="profile.rating.status" />
              </dt>
              <dd>{statusLabel(rating.data.rating)}</dd>
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
      </section>

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

      {/* The anchor an achievement notification opens (T-946). */}
      <section id="achievements" className="flex flex-col gap-2" data-testid="achievements">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="achievements.title" />
        </h2>
        <AchievementsSection locale={locale} result={achievements} />
      </section>

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
    </main>
  );
}
