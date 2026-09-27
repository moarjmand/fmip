import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ModerationQueue } from '@/components/moderation-queue';
import { fetchMe, fetchModerationQueue } from '@/lib/api';
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
    path: '/admin/moderation',
    title: 'Moderation queue',
    description: 'Open reports, grouped by member.',
    index: false,
  });
}

/**
 * The moderation queue on the web (blueprint 16, T-610), over the API of T-212.
 *
 * The role is checked by the API, not here: a page that decided for itself who
 * may moderate would be a second gate, and the one in the browser is the one
 * that goes stale. A member without the role gets 403 and is told so.
 */
export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/moderation`);

  const result = await fetchModerationQueue(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Reports waiting for a decision</h1>

      {result.ok || result.status !== 403 ? (
        <ModerationQueue
          locale={locale}
          subjects={result.ok ? result.data.subjects : []}
          assistant={result.ok ? result.data.assistant : { state: 'absent' }}
          openTotal={result.ok ? result.data.open_total : 0}
          reachable={result.ok}
        />
      ) : (
        // "You may not see this" and "nothing is waiting" are different facts.
        <p role="alert" data-testid="moderation-queue-forbidden">
          The moderation queue needs the moderator or administrator role.
        </p>
      )}
    </main>
  );
}
