import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RATING_THRESHOLD_BOUNDS, RATING_THRESHOLD_FIELDS } from '@fmip/contracts';
import { ActionForm, type Field } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { setRatingThresholdsAction } from '@/lib/admin-actions';
import { fetchMe, fetchRatingThresholds } from '@/lib/api';
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
    path: '/admin/rating-thresholds',
    title: 'Rating thresholds',
    description: 'The versioned thresholds ratings and contributor eligibility are judged by.',
    index: false,
  });
}

/** What each value means, in the console's words. */
const LABELS: Record<(typeof RATING_THRESHOLD_FIELDS)[number], string> = {
  provisional_below: 'Provisional below (settled predictions)',
  established_at: 'Established from (settled predictions)',
  contributor_min_rating: 'Contributor rating threshold',
  contributor_min_settled: 'Contributor settled predictions',
  conduct_window_days: 'Conduct window (days)',
  flag_period_days: 'Days below the threshold before a flag',
};

/**
 * Rating thresholds as versioned rows (T-1160, D-152, D-164), administrators
 * only, over the audited API. A change is a new version with a reason and a
 * start; no version is edited, and the formula is not here.
 */
export default async function RatingThresholdsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/rating-thresholds`);

  const result = await fetchRatingThresholds(cookie);
  const current = result.ok
    ? result.data.versions.find((v) => v.version === result.data.in_force)
    : undefined;

  const fields: Field[] = [
    ...RATING_THRESHOLD_FIELDS.map((name) => ({
      name,
      label: LABELS[name],
      required: true,
      defaultValue: current === undefined ? '' : String(current[name]),
      hint: `From ${RATING_THRESHOLD_BOUNDS[name].min} to ${RATING_THRESHOLD_BOUNDS[name].max}${
        RATING_THRESHOLD_BOUNDS[name].integer ? '' : ', one decimal place at most'
      }.`,
    })),
    {
      name: 'effective_from',
      label: 'In force from',
      hint: 'An instant with its zone, e.g. 2026-10-01T00:00Z. Empty means now; never in the past.',
    },
    {
      name: 'reason',
      label: 'Reason for this version',
      type: 'textarea',
      required: true,
      maxLength: 500,
      hint: 'Recorded with the version and in the audit log with the version it supersedes.',
    },
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Rating thresholds</h1>
      <p className="text-sm text-muted">
        The counts that make a rating provisional or established, the contributor thresholds and the
        days below them before administrators are asked to look. A change is a new version from its
        start; every rating and eligibility names the version it was computed under, so earlier ones
        stay explainable. The formula itself changes only by a new version in code.
      </p>

      {!result.ok ? (
        result.status === 403 ? (
          <Notice tone="warning" data-testid="rating-thresholds-forbidden">
            Setting rating thresholds needs the administrator role.
          </Notice>
        ) : (
          <Notice tone="danger">
            <Translated locale={locale} message="common.unreachable" />
          </Notice>
        )
      ) : (
        <>
          <section className="flex flex-col gap-2" data-testid="rating-thresholds-versions">
            <h2 className="text-lg font-semibold">Versions</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start">
                    <th className="pe-3 text-start">Version</th>
                    <th className="pe-3 text-start">In force from</th>
                    {RATING_THRESHOLD_FIELDS.map((name) => (
                      <th key={name} className="pe-3 text-start">
                        {LABELS[name]}
                      </th>
                    ))}
                    <th className="pe-3 text-start">Set by</th>
                    <th className="text-start">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.versions.map((v) => (
                    <tr
                      key={v.version}
                      className="border-t border-default align-top"
                      data-testid={`rating-threshold-version-${v.version}`}
                    >
                      <td className="pe-3 tabular-nums">
                        {v.version}
                        {v.version === result.data.in_force ? ' (in force)' : ''}
                      </td>
                      <td className="pe-3">{v.effective_from}</td>
                      {RATING_THRESHOLD_FIELDS.map((name) => (
                        <td key={name} className="pe-3 tabular-nums">
                          {v[name]}
                        </td>
                      ))}
                      <td className="pe-3">{v.set_by ?? 'migration'}</td>
                      <td>{v.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">New version</h2>
            <ActionForm
              action={setRatingThresholdsAction.bind(null, locale)}
              fields={fields}
              submitLabel="Record new version (audited)"
              testId="rating-thresholds-form"
            />
          </section>
        </>
      )}
    </main>
  );
}
