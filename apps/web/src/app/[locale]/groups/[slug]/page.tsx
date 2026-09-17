import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GroupControls, JoinRequestControls } from '@/components/group-controls';
import { fetchGroup, fetchGroupLeaderboard, fetchGroupRequests, fetchMe } from '@/lib/api';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';

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
  // `members === null` is the API's own answer to "may this viewer see who is
  // in this group", and the board is that list with numbers beside it — so it
  // is the same question, asked once, rather than a 403 fetched on purpose.
  const board = group.members === null ? null : await fetchGroupLeaderboard(slug, cookie);
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
          <Translated locale={locale} message="groups.memberCount" count={group.member_count} /> ·{' '}
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

      {board !== null && (
        <section className="flex flex-col gap-3" data-testid="group-board">
          <h2 className="text-lg font-semibold">The board</h2>
          {!board.ok ? (
            <p role="alert" data-testid="group-board-unreachable">
              The board cannot be shown right now.
            </p>
          ) : board.data.entries.length === 0 ? (
            // The floor does not bend for a small group (D-037), so a group can
            // have no board at all — and saying which filter produced that is
            // the difference between an honest absence and a page that looks
            // like nobody is here.
            <p className="text-sm opacity-70" data-testid="group-board-none">
              Nobody in this group has settled {board.data.min_settled} predictions yet, so there is
              nobody to rank. That is the same filter the whole product uses.
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {board.data.entries.map((entry) => (
                  <li key={entry.username} className="flex items-baseline gap-3 text-sm">
                    <span className="w-6 text-end opacity-70">{entry.rank}</span>
                    <Link
                      href={`/${locale}/u/${encodeURIComponent(entry.username)}`}
                      className="underline"
                    >
                      @{entry.username}
                    </Link>
                    <span className="ms-auto tabular-nums">{ratingLabel(entry)}</span>
                    <span className="opacity-70">{tierLabel(entry.tier)}</span>
                    <span className="opacity-70">{statusLabel(entry)}</span>
                  </li>
                ))}
              </ol>
              {board.data.total > board.data.entries.length && (
                <p className="text-sm opacity-70" data-testid="group-board-more">
                  Showing {board.data.entries.length} of {board.data.total} ranked members.
                </p>
              )}
            </>
          )}
          <p className="text-sm opacity-70" data-testid="group-board-note">
            Ranked among this group&rsquo;s members by the same rating as the{' '}
            <Link href={`/${locale}/leaderboard`} className="underline">
              global board
            </Link>
            . The rating is the one number; only who it is measured against changes.
          </p>
        </section>
      )}

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
