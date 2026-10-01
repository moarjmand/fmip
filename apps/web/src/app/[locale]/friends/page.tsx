import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FriendControls } from '@/components/friend-controls';
import { MemberHandle, MemberName } from '@/components/member-name';
import { formatDateTime } from '@/i18n/format';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { fetchBlocks, fetchFriendRequests, fetchFriends, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/friends',
    title: `${t(resolved, 'friendsPage.title')} · FMIP`,
    description: t(resolved, 'friendsPage.description'),
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
          <Translated locale={locale} message="friendsPage.title" />
        </h1>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="friendsPage.lead" />
        </p>
      </div>

      <section className="flex flex-col gap-3" data-testid="friend-requests">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="friendsPage.requests" />
        </h2>
        {!requests.ok ? (
          <Notice tone="danger">
            <Translated locale={locale} message="friendsPage.requestsUnreachable" />
          </Notice>
        ) : requests.data.incoming.length === 0 && requests.data.outgoing.length === 0 ? (
          <p className="text-sm text-muted" data-testid="requests-none">
            <Translated locale={locale} message="friendsPage.requestsNone" />
          </p>
        ) : (
          <>
            {requests.data.incoming.map((request) => (
              <div key={`in-${request.member.username}`} className="flex flex-col gap-1">
                <p className="text-sm">
                  <MemberName locale={locale} member={request.member} link className="underline" />{' '}
                  <span className="text-muted">
                    <MemberHandle username={request.member.username} /> ·{' '}
                    <Said
                      locale={locale}
                      message="friendsPage.askedAt"
                      params={{ when: formatDateTime(locale, request.sent_at, zone) }}
                    />
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
                  <MemberName locale={locale} member={request.member} link className="underline" />{' '}
                  <span className="text-muted">
                    <MemberHandle username={request.member.username} /> ·{' '}
                    <Said
                      locale={locale}
                      message="friendsPage.youAskedAt"
                      params={{ when: formatDateTime(locale, request.sent_at, zone) }}
                    />
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
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="friendsPage.yours" />
        </h2>
        {!friends.ok ? (
          <Notice tone="danger">
            <Translated locale={locale} message="friendsPage.friendsUnreachable" />
          </Notice>
        ) : friends.data.friends.length === 0 ? (
          <p className="text-sm text-muted" data-testid="friends-none">
            <Translated locale={locale} message="friendsPage.friendsNone" />
          </p>
        ) : (
          friends.data.friends.map((friend) => (
            <div key={friend.member.username} className="flex flex-col gap-1">
              <p className="text-sm">
                <MemberName locale={locale} member={friend.member} link className="underline" />{' '}
                <span className="text-muted">
                  <MemberHandle username={friend.member.username} /> ·{' '}
                  <Said
                    locale={locale}
                    message="friendsPage.friendsSince"
                    params={{ when: formatDateTime(locale, friend.friends_since, zone) }}
                  />
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
                  <Translated locale={locale} message="friendsPage.compare" />
                </Link>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="block-list">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="friendsPage.blocked" />
        </h2>
        <p className="text-xs text-muted">
          <Translated locale={locale} message="friendsPage.blockedHint" />
        </p>
        {!blocks.ok ? (
          <Notice tone="danger">
            <Translated locale={locale} message="friendsPage.blocksUnreachable" />
          </Notice>
        ) : blocks.data.blocked.length === 0 ? (
          <p className="text-sm text-muted" data-testid="blocks-none">
            <Translated locale={locale} message="friendsPage.blocksNone" />
          </p>
        ) : (
          blocks.data.blocked.map((entry) => (
            <div key={entry.member.username} className="flex flex-col gap-1">
              <p className="text-sm">
                <MemberName locale={locale} member={entry.member} />{' '}
                <span className="text-muted">
                  <MemberHandle username={entry.member.username} /> ·{' '}
                  <Said
                    locale={locale}
                    message="friendsPage.blockedAt"
                    params={{ when: formatDateTime(locale, entry.blocked_at, zone) }}
                  />
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
