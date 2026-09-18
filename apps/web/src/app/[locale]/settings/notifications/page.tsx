import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotificationSettingsForm } from '@/components/notification-settings';
import { fetchCompetitions, fetchMe, fetchNotificationSettings, fetchTeams } from '@/lib/api';
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
    path: '/settings/notifications',
    title: 'Notification settings',
    description: 'Choose what reaches you, and when.',
    index: false,
  });
}

/** What arrives, and when (blueprint 12.2, T-273). */
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/settings/notifications`);

  const [result, teams, competitions] = await Promise.all([
    fetchNotificationSettings(cookie),
    fetchTeams(),
    fetchCompetitions(),
  ]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/notifications`} className="underline">
          ← Notifications
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">What reaches you</h1>

      {result.ok ? (
        <NotificationSettingsForm
          locale={locale}
          settings={result.data}
          teams={teams}
          competitions={competitions}
        />
      ) : (
        // Stated, not a blank page. A form that silently showed the defaults
        // would let a member "change" something that was never saved, and they
        // would find out weeks later by not being told something.
        <p role="alert" data-testid="settings-unreachable">
          Your settings cannot be shown right now.
        </p>
      )}
    </main>
  );
}
