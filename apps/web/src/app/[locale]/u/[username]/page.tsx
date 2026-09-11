import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PredictionHistory } from '@/components/prediction-history';
import { fetchMe, fetchPredictionHistory, fetchProfile, fetchRating } from '@/lib/api';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { historyQuery, readHistoryPage } from '@/lib/prediction-history';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${decodeURIComponent(username)} · FMIP` };
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
  const cookie = await sessionCookieHeader();
  const name = decodeURIComponent(username);
  const result = await fetchProfile(name, cookie);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">@{name}</h1>
        <p role="alert">The service is unreachable right now, so this profile cannot be shown.</p>
      </main>
    );
  }

  const view = result.data;

  if (view.kind === 'restricted') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold" data-testid="profile-name">
          {view.display_name}
        </h1>
        <p className="opacity-70">@{view.username}</p>
        <p data-testid="profile-restricted">
          {view.visibility === 'friends'
            ? 'This profile is visible to friends only.'
            : 'This profile is private.'}
        </p>
      </main>
    );
  }

  const { profile } = view;
  const page = readHistoryPage(query);
  const [me, rating, history] = await Promise.all([
    fetchMe(cookie),
    fetchRating(profile.username),
    fetchPredictionHistory(profile.username, historyQuery(page), cookie),
  ]);
  const timeZone = me?.timezone ?? 'UTC';
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
            {profile.display_name}
          </h1>
          <p className="opacity-70">@{profile.username}</p>
          <p className="text-sm opacity-70">
            Member since <time dateTime={profile.member_since}>{profile.member_since}</time>
          </p>
        </div>
        {view.is_self && (
          <Link href={`/${locale}/settings`} className="ms-auto text-sm underline">
            Edit profile
          </Link>
        )}
      </header>

      {profile.bio !== null ? (
        <p className="whitespace-pre-line" data-testid="profile-bio">
          {profile.bio}
        </p>
      ) : (
        <p className="text-sm opacity-70">No biography yet.</p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Favourite teams</h2>
        {profile.favourite_teams.length === 0 ? (
          <p className="text-sm opacity-70">No favourite teams yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="favourite-teams">
            {profile.favourite_teams.map((team) => (
              <li key={team} className="rounded border border-current/30 px-2 py-1 text-sm">
                {team}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="rating">
        <h2 className="text-lg font-semibold">Performance Rating</h2>
        {!rating.ok ? (
          <p role="alert" className="text-sm">
            The rating cannot be shown right now.
          </p>
        ) : rating.data.rating === null ? (
          <p className="text-sm opacity-70" data-testid="rating-none">
            No rating yet: a rating starts with the first settled prediction.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase opacity-60">Rating</dt>
              <dd className="text-2xl font-semibold tabular-nums" data-testid="rating-value">
                {ratingLabel(rating.data.rating)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-60">Tier</dt>
              <dd>{tierLabel(rating.data.rating.tier)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-60">Status</dt>
              <dd>{statusLabel(rating.data.rating)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-60">Settled</dt>
              <dd className="tabular-nums">{rating.data.rating.settled_count}</dd>
            </div>
            <dd className="col-span-full text-xs opacity-60">
              {rating.data.rating.formula_version} · computed{' '}
              <time dateTime={rating.data.rating.computed_at}>
                {rating.data.rating.computed_at}
              </time>
            </dd>
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Predictions</h2>
        {!history.ok ? (
          <p role="alert" className="text-sm" data-testid="history-unreachable">
            The prediction history cannot be shown right now.
          </p>
        ) : history.data.kind === 'restricted' ? (
          <p className="text-sm opacity-70" data-testid="history-restricted">
            {history.data.visibility === 'friends'
              ? 'Prediction history is visible to friends only.'
              : 'Prediction history is private.'}
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
