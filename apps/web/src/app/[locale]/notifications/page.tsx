import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotificationList } from '@/components/notification-list';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { plural, resolveMessages, t } from '@/i18n/messages';
import { fetchMe, fetchNotifications } from '@/lib/api';
import { NOTIFICATION_LIST_KEYS } from '@/lib/notification-messages';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/notifications',
    title: t(resolved, 'notificationsPage.title'),
    description: t(resolved, 'notificationsPage.description'),
    // Somebody's inbox is not a page for a search engine.
    index: false,
  });
}

/**
 * The inbox (blueprint 12.2, T-272).
 *
 * A signed-out visitor is sent to sign in rather than shown an empty inbox: an
 * empty list would say "nothing happened", which is a different thing from
 * "we do not know who you are".
 *
 * The list is a client component, so its words are resolved here and handed
 * down (T-1040, T-1305): the "mark all" count as a plural, and each time in
 * the reader's language and zone.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/notifications`);

  const result = await fetchNotifications(cookie);
  const page = result.ok ? result.data : null;
  const times = Object.fromEntries(
    (page?.notifications ?? []).map((n) => [
      n.id,
      formatDateTime(resolved, n.created_at, me.timezone),
    ]),
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="notificationsPage.title" />
        </h1>
        <Link href={`/${locale}/settings/notifications`} className="text-sm underline">
          <Translated locale={locale} message="notificationsPage.manage" />
        </Link>
      </div>

      {/* T-330: with no provider, this page is the only place a notification exists. Said, not assumed. */}
      {result.ok && result.data.delivery.in_product_only && (
        <p className="text-sm text-muted" data-testid="delivery-in-product-only">
          <Translated locale={locale} message="notificationsPage.inProductOnly" />
        </p>
      )}

      <NotificationList
        locale={locale}
        page={page}
        reachable={result.ok}
        deletedMemberLabel={t(resolved, 'account.deletedMember')}
        messages={resolveMessages(resolved, NOTIFICATION_LIST_KEYS)}
        markAll={
          page !== null && page.unread > 0
            ? plural(resolved, 'notificationsPage.markAllRead', page.unread)
            : null
        }
        times={times}
      />
    </main>
  );
}
