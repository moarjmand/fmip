import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotificationList } from '@/components/notification-list';
import { fetchMe, fetchNotifications } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/notifications',
    title: 'Notifications',
    description: 'What happened while you were away.',
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
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/notifications`);

  const result = await fetchNotifications(cookie);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <Link href={`/${locale}/settings/notifications`} className="text-sm underline">
          Choose what arrives
        </Link>
      </div>

      <NotificationList
        locale={locale}
        page={result.ok ? result.data : null}
        reachable={result.ok}
      />
    </main>
  );
}
