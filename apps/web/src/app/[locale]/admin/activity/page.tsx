import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ACTIVITY_DEFAULT_DAYS } from '@fmip/contracts';
import { ActivitySections } from '@/components/activity-report';
import { Notice } from '@/components/ui';
import { directionOf } from '@/i18n/locales';
import { fetchActivity } from '@/lib/api';
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
    path: '/admin/activity',
    title: 'Activity',
    description: 'Registrations, predictions, messages and notifications per day.',
    index: false,
  });
}

/**
 * The Activity page (T-807, blueprint 19): how much of each thing happened
 * per UTC day over the last thirty days, from `GET /admin/activity`. Counts
 * only: the API sums rows the product already keeps, and this page receives
 * numbers, never a member. A member without the role is told so in words; an
 * API that does not answer is said, never drawn as a quiet month.
 */
export default async function AdminActivityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const activity = await fetchActivity(ACTIVITY_DEFAULT_DAYS, cookie);
  if (!activity.ok && activity.status === 401) {
    redirect(`/${locale}/login?next=/${locale}/admin/activity`);
  }
  if (!activity.ok && activity.status === 403) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <Notice tone="danger" data-testid="activity-forbidden">
          This page is for administrators. Your account does not have the admin role, so the
          activity counts are not shown.
        </Notice>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Administration
        </Link>
      </p>
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        Activity
      </h1>
      <p className="text-sm text-muted" data-testid="activity-aggregates-note">
        Counts are aggregates only: how many, per UTC day, from rows the product already keeps for
        its own work. No member is named, there is no per-member series, and nothing is recorded to
        make these numbers. A deleted account’s registration, predictions, settlements, messages and
        reports still count, unnamed; its verification and sign-ins were erased with it and do not.
      </p>
      <ActivitySections
        report={activity.ok ? activity.data : null}
        direction={directionOf(locale)}
      />
    </main>
  );
}
