import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GroupHistory } from '@/components/group-settings';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { fetchGroup, fetchGroupHistory, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: '/groups', title: "A group's history · FMIP" });
}

/**
 * A group's history (T-1026, over T-1020's `GET /groups/:slug/history`): its
 * audited changes, for the owner and moderators. Anybody else is sent to the
 * group's page rather than shown a refusal, because the page already says
 * everything they may know; a group they may not know at all is a 404, as
 * the API answers it.
 */
export default async function GroupHistoryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const found = await fetchGroup(slug, cookie);
  if (!found.ok && found.status === 404) notFound();
  const groupHref = `/${locale}/groups/${encodeURIComponent(slug)}`;
  if (found.ok) {
    const { standing } = found.data.group;
    if (standing !== 'owner' && standing !== 'moderator') redirect(groupHref);
  }
  const history = found.ok ? await fetchGroupHistory(slug, cookie) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <Link href={groupHref} className="self-start text-sm underline">
        <Translated locale={locale} message="groupSettings.history.back" />
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="group-history-title">
          <Translated locale={locale} message="groupSettings.history.title" />
          {found.ok && (
            <>
              {' · '}
              <span lang={found.data.group.language ?? undefined}>{found.data.group.name}</span>
            </>
          )}
        </h1>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="groupSettings.history.intro" />
        </p>
      </header>
      {history !== null ? (
        <GroupHistory locale={locale} timeZone={me.timezone} result={history} />
      ) : (
        <Notice tone="danger" data-testid="group-history-unreachable">
          <Translated locale={locale} message="groupSettings.history.unreachable" />
        </Notice>
      )}
    </main>
  );
}
