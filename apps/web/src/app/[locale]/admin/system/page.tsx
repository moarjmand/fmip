import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertsSection, FailuresSection, WatchdogSection } from '@/components/system-report';
import { Notice } from '@/components/ui';
import { directionOf } from '@/i18n/locales';
import { fetchAdminAlerts, fetchFailureCounts, fetchWatchdog } from '@/lib/api';
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
    path: '/admin/system',
    title: 'System',
    description: 'The watchdog, alert delivery, API errors and job failures.',
    index: false,
  });
}

/**
 * The System page (T-804, blueprint 16): the watchdog's conditions and
 * incidents (T-801), where its alerts went (T-802), and API errors and job
 * failures per hour (T-803). Each section is fetched on its own and says
 * separately "nothing recorded" (the API answered, and there is nothing)
 * and "cannot be shown" (the API did not answer): the first is good news,
 * the second is not, and rendering it as empty would be rule 3 on the page
 * whose job is to say what is wrong.
 *
 * A member without the role is told so in words: an operator who lost the
 * role, or a link followed by mistake, should not be left guessing between a
 * missing page and a missing permission.
 */
export default async function AdminSystemPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const [watchdog, day, week, alerts] = await Promise.all([
    fetchWatchdog(cookie),
    fetchFailureCounts(24, cookie),
    fetchFailureCounts(168, cookie),
    fetchAdminAlerts(cookie),
  ]);
  const results = [watchdog, day, week, alerts];
  if (results.some((r) => !r.ok && r.status === 401)) {
    redirect(`/${locale}/login?next=/${locale}/admin/system`);
  }
  if (results.some((r) => !r.ok && r.status === 403)) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">System</h1>
        <Notice tone="danger" data-testid="system-forbidden">
          This page is for administrators. Your account does not have the admin role, so the system
          report is not shown.
        </Notice>
      </main>
    );
  }
  if (results.every((r) => !r.ok)) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">System</h1>
        <Notice tone="danger" data-testid="system-unreachable">
          The API cannot be reached right now, so nothing about the system can be shown. That is
          itself a finding: check the API process and its log.
        </Notice>
      </main>
    );
  }
  const direction = directionOf(locale);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 p-4 sm:p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Administration
        </Link>
      </p>
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        System
      </h1>

      <WatchdogSection report={watchdog.ok ? watchdog.data : null} />
      <p className="text-sm">
        Findings behind the data-quality condition, by competition:{' '}
        <Link
          href={`/${locale}/admin/data-quality`}
          className="underline"
          data-testid="system-data-quality-link"
        >
          Data quality
        </Link>
      </p>
      <AlertsSection report={alerts.ok ? alerts.data : null} />
      <FailuresSection
        day={day.ok ? day.data : null}
        week={week.ok ? week.data : null}
        direction={direction}
      />
    </main>
  );
}
