import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MemberModerationHistoryView } from '@/components/member-moderation-history';
import { fetchMe, fetchMemberModerationHistory } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  return pageMetadata({
    locale,
    path: `/admin/moderation/${username}`,
    title: 'Moderation history',
    description: 'Reports, decisions and restrictions for one member.',
    index: false,
  });
}

/**
 * One member's moderation history (T-611), over `GET /admin/moderation/members/:username`.
 * The role is the API's to check; a 403 is said, a 404 is said, and neither is
 * shown as a clean record.
 */
export default async function MemberModerationPage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username: raw } = await params;
  const username = decodeURIComponent(raw);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) {
    redirect(`/${locale}/login?next=/${locale}/admin/moderation/${encodeURIComponent(username)}`);
  }

  const result = await fetchMemberModerationHistory(username, cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin/moderation`} className="underline">
          ← Moderation queue
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        <Link href={`/${locale}/u/${encodeURIComponent(username)}`} className="underline">
          @{username}
        </Link>
      </h1>

      {result.ok ? (
        <MemberModerationHistoryView locale={locale} history={result.data} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="moderation-history-forbidden">
          A member&apos;s moderation history needs the moderator or administrator role.
        </Notice>
      ) : result.status === 404 ? (
        <Notice tone="warning" data-testid="moderation-history-missing">
          There is no member with that username.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="moderation-history-unreachable">
          This history cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
