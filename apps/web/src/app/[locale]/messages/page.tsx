import type { Metadata } from 'next';
import { conversationTitle, threadStanding } from '@/lib/conversation-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchConversations, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { formatDateTime } from '@/i18n/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/messages',
    title: 'Messages · FMIP',
    description: 'Your conversations.',
  });
}

/**
 * The conversation list (blueprint 8.3, T-224).
 *
 * **There is no socket behind this page and deliberately is not one yet.**
 * T-230 is the transport; E22 was ordered so that the surface is correct over
 * ordinary requests first, because a page that is only right while a connection
 * is open has made the connection the source of truth by accident.
 */
export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const result = await fetchConversations(cookie);
  const zone = me.timezone;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="title">
          Messages
        </h1>
        <p className="text-sm opacity-70">
          You can open a conversation with a member you are friends with, from their profile.
        </p>
      </div>

      {!result.ok ? (
        <p role="alert" data-testid="messages-unreachable">
          Your conversations cannot be listed right now.
        </p>
      ) : result.data.conversations.length === 0 ? (
        // Stated, not vanished: a reader has to be able to tell "nobody has
        // written to you" from "the page did not ask".
        <p className="text-sm opacity-70" data-testid="messages-none">
          You have no conversations yet.{' '}
          <Link href={`/${locale}/friends`} className="underline">
            Your friends
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="conversation-list">
          {result.data.conversations.map((conversation) => {
            const last = conversation.last_message;
            const standing = threadStanding(conversation);
            return (
              <li key={conversation.id} className="flex flex-col gap-1">
                <Link
                  href={`/${locale}/messages/${conversation.id}`}
                  className="text-sm font-medium underline"
                >
                  {conversationTitle(conversation, me.username)}
                </Link>
                {standing !== null && (
                  <p className="text-xs opacity-60" data-testid="conversation-standing">
                    {standing}
                  </p>
                )}
                <p className="text-sm opacity-70">
                  {last === null ? (
                    'Nothing said yet.'
                  ) : last.removed !== null ? (
                    <span className="italic">A message was removed.</span>
                  ) : (
                    (last.body ?? 'Shared a football card.')
                  )}
                </p>
                <p className="text-xs opacity-60">
                  {conversation.unread > 0 && (
                    <span data-testid="conversation-unread">{conversation.unread} unread · </span>
                  )}
                  {conversation.muted && <span>muted · </span>}
                  {conversation.left && <span>you have left · </span>}
                  {last !== null && (
                    <time dateTime={last.created_at}>
                      {formatDateTime(locale, last.created_at, zone)}
                    </time>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
