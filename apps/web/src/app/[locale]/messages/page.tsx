import type { Metadata } from 'next';
import { conversationTitle, threadStanding } from '@/lib/conversation-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchConversations, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { Said } from '@/components/community-text';
import { Notice } from '@/components/ui';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';

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
    path: '/messages',
    title: `${t(resolved, 'messagesPage.title')} · FMIP`,
    description: t(resolved, 'messagesPage.description'),
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
          <Translated locale={locale} message="messagesPage.title" />
        </h1>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="messagesPage.lead" />
        </p>
      </div>

      {!result.ok ? (
        <Notice tone="danger" data-testid="messages-unreachable">
          <Translated locale={locale} message="messagesPage.listUnreachable" />
        </Notice>
      ) : result.data.conversations.length === 0 ? (
        // Stated, not vanished: a reader has to be able to tell "nobody has
        // written to you" from "the page did not ask".
        <p className="text-sm text-muted" data-testid="messages-none">
          <Translated locale={locale} message="messagesPage.none" />{' '}
          <Link href={`/${locale}/friends`} className="underline">
            <Translated locale={locale} message="friendsPage.yours" />
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="conversation-list">
          {result.data.conversations.map((conversation) => {
            const last = conversation.last_message;
            const standing = threadStanding(conversation, locale);
            return (
              <li key={conversation.id} className="flex flex-col gap-1">
                <Link
                  href={`/${locale}/messages/${conversation.id}`}
                  className="text-sm font-medium underline"
                >
                  {conversationTitle(conversation, me.username, locale)}
                </Link>
                {standing !== null && (
                  <p className="text-xs text-muted" data-testid="conversation-standing">
                    {standing}
                  </p>
                )}
                <p className="text-sm text-muted">
                  {last === null ? (
                    <Translated locale={locale} message="messagesPage.nothingSaid" />
                  ) : last.removed !== null ? (
                    <span className="italic">
                      <Translated locale={locale} message="messagesPage.lastRemoved" />
                    </span>
                  ) : (
                    (last.body ?? <Translated locale={locale} message="messagesPage.sharedCard" />)
                  )}
                </p>
                <p className="text-xs text-muted">
                  {conversation.unread > 0 && (
                    <span data-testid="conversation-unread">
                      <Said
                        locale={locale}
                        message="messagesPage.unread"
                        params={{ count: formatNumber(locale, conversation.unread) }}
                      />
                      {' · '}
                    </span>
                  )}
                  {conversation.muted && (
                    <span>
                      <Translated locale={locale} message="messagesPage.muted" />
                      {' · '}
                    </span>
                  )}
                  {conversation.left && (
                    <span>
                      <Translated locale={locale} message="messagesPage.youLeft" />
                      {' · '}
                    </span>
                  )}
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
