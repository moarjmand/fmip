import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FriendControls } from '@/components/friend-controls';
import { formatDateTime } from '@/i18n/format';
import { Translated } from '@/components/translated';
import { fetchBlocks, fetchFriendRequests, fetchFriends, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/friends',
    title: 'Friends · FMIP',
    description: 'Your friends, your pending requests and the members you have blocked.',
  });
}

/**
 * Friends, requests and blocks on one page (blueprint 8.1, T-202).
 *
 * Three sections, and **each states its own absence**. An empty section that
 * renders nothing is the mistake the Predictions page made (T-137): a reader
 * cannot tell whether they have no pending requests or whether the page failed
 * to ask. That matters more here than there — a member who has been sent a
 * friend request and sees a blank page has been told something false about
 * another person's action.
 *
 * The block list is on this page rather than buried in settings for the same
 * reason: a block a member cannot find is a block they cannot lift.
 */
export default async function FriendsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const [friends, requests, blocks] = await Promise.all([
    fetchFriends(cookie),
    fetchFriendRequests(cookie),
    fetchBlocks(cookie),
  ]);

  const zone = me.timezone;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="title">
          Friends
        </h1>
        <p className="text-sm opacity-70">
          Friends can see one another&rsquo;s friends-only profile and prediction history, and
          nothing more than that until you share it.
        </p>
      </div>

      <section className="flex flex-col gap-3" data-testid="friend-requests">
        <h2 className="text-lg font-semibold">Requests</h2>
        {!requests.ok ? (
          <p role="alert" className="text-sm">
            Your requests cannot be listed right now.
          </p>
        ) : requests.data.incoming.length === 0 && requests.data.outgoing.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="requests-none">
            Nobody has asked to be your friend, and you have no request waiting for an answer.
          </p>
        ) : (
          <>
            {requests.data.incoming.map((request) => (
              <div key={`in-${request.member.username}`} className="flex flex-col gap-1">
                <p className="text-sm">
                  <Link
                    href={`/${locale}/u/${encodeURIComponent(request.member.username)}`}
                    className="underline"
                  >
                    {request.member.display_name}
                  </Link>{' '}
                  <span className="opacity-70">
                    @{request.member.username} · asked{' '}
                    {formatDateTime(locale, request.sent_at, zone)}
                  </span>
                </p>
                <FriendControls
                  locale={locale}
                  username={request.member.username}
                  status="request_received"
                />
              </div>
            ))}
            {requests.data.outgoing.map((request) => (
              <div key={`out-${request.member.username}`} className="flex flex-col gap-1">
                <p className="text-sm">
                  <Link
                    href={`/${locale}/u/${encodeURIComponent(request.member.username)}`}
                    className="underline"
                  >
                    {request.member.display_name}
                  </Link>{' '}
                  <span className="opacity-70">
                    @{request.member.username} · you asked{' '}
                    {formatDateTime(locale, request.sent_at, zone)}
                  </span>
                </p>
                <FriendControls
                  locale={locale}
                  username={request.member.username}
                  status="request_sent"
                />
              </div>
            ))}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="friend-list">
        <h2 className="text-lg font-semibold">Your friends</h2>
        {!friends.ok ? (
          <p role="alert" className="text-sm">
            Your friends cannot be listed right now.
          </p>
        ) : friends.data.friends.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="friends-none">
            You have no friends here yet. Open a member&rsquo;s profile to send a request.
          </p>
        ) : (
          friends.data.friends.map((friend) => (
            <div key={friend.member.username} className="flex flex-col gap-1">
              <p className="text-sm">
                <Link
                  href={`/${locale}/u/${encodeURIComponent(friend.member.username)}`}
                  className="underline"
                >
                  {friend.member.display_name}
                </Link>{' '}
                <span className="opacity-70">
                  @{friend.member.username} · friends since{' '}
                  {formatDateTime(locale, friend.friends_since, zone)}
                  {friend.mutual_friends > 0 && (
                    <>
                      {' · '}
                      <Translated
                        locale={locale}
                        message="friends.mutualCount"
                        count={friend.mutual_friends}
                      />
                    </>
                  )}
                </span>
              </p>
              <div className="flex flex-wrap items-start gap-4">
                <FriendControls
                  locale={locale}
                  username={friend.member.username}
                  status="friends"
                />
                <Link
                  href={`/${locale}/u/${encodeURIComponent(friend.member.username)}/compare`}
                  className="text-sm underline"
                >
                  Compare records
                </Link>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="block-list">
        <h2 className="text-lg font-semibold">Blocked</h2>
        <p className="text-xs opacity-60">
          A blocked member cannot send you a friend request, and is not told. Lifting a block makes
          contact possible again; it does not restore a friendship the block ended.
        </p>
        {!blocks.ok ? (
          <p role="alert" className="text-sm">
            Your block list cannot be shown right now.
          </p>
        ) : blocks.data.blocked.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="blocks-none">
            You have blocked nobody.
          </p>
        ) : (
          blocks.data.blocked.map((entry) => (
            <div key={entry.member.username} className="flex flex-col gap-1">
              <p className="text-sm">
                {entry.member.display_name}{' '}
                <span className="opacity-70">
                  @{entry.member.username} · blocked{' '}
                  {formatDateTime(locale, entry.blocked_at, zone)}
                </span>
              </p>
              <FriendControls locale={locale} username={entry.member.username} status="blocked" />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
