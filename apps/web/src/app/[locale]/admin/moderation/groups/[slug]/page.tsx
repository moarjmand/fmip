import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppealNotes, GroupDecisionForm } from '@/components/group-moderation';
import { fetchGroupModeration, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  return pageMetadata({
    locale,
    path: `/admin/moderation/groups/${slug}`,
    title: 'A group, for moderation',
    description: 'Reports, decisions and the appeal for one group.',
    index: false,
  });
}

/**
 * One group before a moderator decides (blueprint 10.4, T-1025, D-135), over
 * `GET /admin/moderation/groups/:slug`. Close, reopen, remove its description,
 * or answer its reports with no action -- each with a reason. The role is the
 * API's to check; a 403 is said, a 404 is said.
 */
export default async function GroupModerationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) {
    redirect(
      `/${locale}/login?next=/${locale}/admin/moderation/groups/${encodeURIComponent(slug)}`,
    );
  }

  const result = await fetchGroupModeration(slug, cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin/moderation`} className="underline">
          ← Moderation queue
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{result.ok ? result.data.name : 'A group'}</h1>

      {!result.ok ? (
        result.status === 403 ? (
          <Notice tone="warning" data-testid="moderation-group-forbidden">
            A group&apos;s moderation needs the moderator or administrator role.
          </Notice>
        ) : result.status === 404 ? (
          <Notice tone="warning" data-testid="moderation-group-missing">
            There is no group with that handle.
          </Notice>
        ) : (
          <Notice tone="danger" data-testid="moderation-group-unreachable">
            This group cannot be shown right now.
          </Notice>
        )
      ) : (
        <>
          <section className="flex flex-col gap-1 text-sm" data-testid="moderation-group-facts">
            <p>
              {result.data.visibility} · {result.data.member_count} member
              {result.data.member_count === 1 ? '' : 's'}
              {result.data.owner !== null && <> · owned by @{result.data.owner}</>}
            </p>
            {result.data.description !== null && <p>{result.data.description}</p>}
            {result.data.closed !== null ? (
              <Notice tone="warning" data-testid="moderation-group-closed">
                Closed: {result.data.closed.reason}
              </Notice>
            ) : (
              <p className="text-muted">Open.</p>
            )}
          </section>

          <section className="flex flex-col gap-2" data-testid="moderation-group-reports">
            <h2 className="text-lg font-semibold">Reports</h2>
            {result.data.reports.length === 0 ? (
              <p className="text-sm text-muted">Nobody has reported this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.data.reports.map((report) => (
                  <li key={report.id} className="text-sm">
                    {report.reason} from @{report.reporter}
                    {report.detail !== null && <>: {report.detail}</>}
                    {report.decision_id === null ? ' · open' : ' · answered'}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4" data-testid="moderation-group-decide">
            <h2 className="text-lg font-semibold">Decide</h2>
            {result.data.closed === null ? (
              <GroupDecisionForm
                locale={locale}
                slug={result.data.slug}
                kind="close"
                openReports={result.data.reports.filter((r) => r.decision_id === null)}
              />
            ) : (
              <GroupDecisionForm
                locale={locale}
                slug={result.data.slug}
                kind="reopen"
                openReports={result.data.reports.filter((r) => r.decision_id === null)}
              />
            )}
            {result.data.description !== null && (
              <GroupDecisionForm
                locale={locale}
                slug={result.data.slug}
                kind="removal"
                openReports={result.data.reports.filter((r) => r.decision_id === null)}
              />
            )}
            <GroupDecisionForm
              locale={locale}
              slug={result.data.slug}
              kind="dismissal"
              openReports={result.data.reports.filter((r) => r.decision_id === null)}
            />
          </section>

          {result.data.closed !== null && (
            <section className="flex flex-col gap-2" data-testid="moderation-group-appeal">
              <h2 className="text-lg font-semibold">The owner&apos;s appeal</h2>
              <AppealNotes notes={result.data.appeal} />
            </section>
          )}

          <section className="flex flex-col gap-2" data-testid="moderation-group-decisions">
            <h2 className="text-lg font-semibold">Decisions</h2>
            {result.data.decisions.length === 0 ? (
              <p className="text-sm text-muted">No decision has been made about this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.data.decisions.map((decision) => (
                  <li key={decision.id} className="text-sm">
                    <time dateTime={decision.created_at}>{decision.created_at}</time> ·{' '}
                    {decision.outcome} by @{decision.moderator}: {decision.reason}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
