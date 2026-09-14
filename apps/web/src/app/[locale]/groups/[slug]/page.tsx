import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GroupControls, JoinRequestControls } from '@/components/group-controls';
import { fetchGroup, fetchGroupRequests, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: '/groups', title: 'A group · FMIP' });
}

const VISIBILITY: Record<string, string> = {
  public: 'Anyone can find this group and join it.',
  discoverable: 'Anyone can find this group. Joining it is by request.',
  invite_only: 'This group is joined by invitation.',
};

/**
 * One group (blueprint 8.2, T-242).
 *
 * **A private group is not discoverable and an invite-only one is not
 * joinable** — the acceptance criterion, and neither half is enforced here. An
 * invite-only group the viewer has no invitation to answers 404 from the API, so
 * this page never learns it exists; a discoverable one answers with
 * `members: null`, so there is nothing to render and no filter to forget.
 *
 * What the page decides is only what to say about what it was given: the
 * membership when there is one, the queue when the viewer runs the group, and a
 * control that follows `standing` exactly.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const result = await fetchGroup(slug, cookie);
  if (!result.ok) {
    // 404 covers "no such group" and "you may not know it is there", which is
    // the API's answer and not something this page second-guesses.
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">A group</h1>
        <p role="alert" data-testid="group-unreachable">
          This group cannot be shown right now.
        </p>
      </main>
    );
  }

  const group = result.data.group;
  const decides = group.standing === 'owner' || group.standing === 'moderator';
  const queue = decides ? await fetchGroupRequests(slug, cookie) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <Link href={`/${locale}/groups`} className="text-sm underline">
        All groups
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="group-name">
          {group.name}
        </h1>
        <p className="text-sm opacity-70" data-testid="group-visibility">
          {group.member_count} member{group.member_count === 1 ? '' : 's'} ·{' '}
          {VISIBILITY[group.visibility] ?? group.visibility}
        </p>
        {group.description !== null && <p data-testid="group-description">{group.description}</p>}
      </header>

      <GroupControls locale={locale} slug={group.slug} standing={group.standing} />

      {group.conversation_id !== null && (
        <Link
          href={`/${locale}/messages/${group.conversation_id}`}
          className="underline"
          data-testid="group-conversation"
        >
          Open the group conversation
        </Link>
      )}

      <section className="flex flex-col gap-2" data-testid="group-members">
        <h2 className="text-lg font-semibold">Members</h2>
        {group.members === null ? (
          // Found, not read. Saying so is the point of the middle visibility;
          // an empty list would have said "nobody", which of a group is never
          // true.
          <p className="text-sm opacity-70" data-testid="group-members-hidden">
            Who is in this group is shown to its members.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {group.members.map((member) => (
              <li key={member.username} className="text-sm">
                <Link
                  href={`/${locale}/u/${encodeURIComponent(member.username)}`}
                  className="underline"
                >
                  {member.display_name}
                </Link>{' '}
                <span className="opacity-70">
                  @{member.username}
                  {member.role === 'member' ? '' : ` · ${member.role}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decides && (
        <section className="flex flex-col gap-3" data-testid="group-queue">
          <h2 className="text-lg font-semibold">Asking to join</h2>
          {queue === null || !queue.ok ? (
            <p role="alert" data-testid="group-queue-unreachable">
              The queue cannot be shown right now.
            </p>
          ) : queue.data.requests.length === 0 ? (
            <p className="text-sm opacity-70" data-testid="group-queue-none">
              Nobody is waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {queue.data.requests.map((request) => (
                <li key={request.username} className="flex flex-col gap-2">
                  <p className="text-sm">
                    <Link
                      href={`/${locale}/u/${encodeURIComponent(request.username)}`}
                      className="underline"
                    >
                      {request.display_name}
                    </Link>{' '}
                    <span className="opacity-70">@{request.username}</span>
                  </p>
                  {request.note !== null && <p className="text-sm">{request.note}</p>}
                  <JoinRequestControls
                    locale={locale}
                    slug={group.slug}
                    username={request.username}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-sm opacity-70">
        Blocking and reporting live on a member’s profile, where they work the same way everywhere
        else in the product.
      </p>
    </main>
  );
}
