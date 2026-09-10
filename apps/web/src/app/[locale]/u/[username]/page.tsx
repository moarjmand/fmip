import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchProfile } from '@/lib/api';
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
 * and display name, and that is all this page can show.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username } = await params;
  const result = await fetchProfile(decodeURIComponent(username), await sessionCookieHeader());

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">@{decodeURIComponent(username)}</h1>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Predictions</h2>
        {/* Rule 3: the prediction record does not exist yet; say so instead of an empty table. */}
        <p className="text-sm opacity-70">
          Prediction history and rating arrive with the predictions release (E5).
        </p>
      </section>
    </main>
  );
}
