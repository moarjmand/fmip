import Link from 'next/link';
import type { NewsCoverageReport as Report, NewsCoverageState } from '@fmip/contracts';
import { Notice } from '@/components/ui';

/**
 * News coverage per competition (T-1010, D-129), for the console: every
 * active competition with the carried sources that linked a story to it in
 * the window and the count, the gaps first. It names the gaps and offers no
 * way to add a source: which publishers to carry is the maintainer's (N-8).
 */

const STATE_LABEL: Record<NewsCoverageState, string> = {
  no_carried_source: 'No carried source',
  below_floor: 'Below the floor',
  covered: 'Covered',
};

export function NewsCoverageReport({ locale, report }: { locale: string; report: Report }) {
  const gaps = report.competitions.filter((row) => row.state !== 'covered').length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" data-testid="coverage-summary">
        {report.competitions.length} active competitions; {gaps} under the floor of {report.floor}{' '}
        stories from carried sources in the last {report.window_days} days. {report.carried_sources}{' '}
        source{report.carried_sources === 1 ? '' : 's'} carried now.
      </p>
      {report.feeds_read_at === null && (
        <Notice tone="warning" data-testid="coverage-feeds-unread">
          No feed has been read yet, so every competition shows as a gap.
        </Notice>
      )}
      {report.carried_sources === 0 && (
        <Notice tone="warning" data-testid="coverage-no-sources">
          No news source is carried, so no competition has news.
        </Notice>
      )}
      <p className="text-sm text-muted">
        Which publishers to add, and on what terms, is the maintainer&apos;s decision (N-8). This
        page names the gaps and adds nothing.
      </p>
      {report.competitions.length === 0 ? (
        <p className="text-sm text-muted">No competition is active.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm" data-testid="coverage-table">
            <thead>
              <tr className="border-b border-default">
                <th scope="col" className="py-2 pe-4 text-start font-semibold">
                  Competition
                </th>
                <th scope="col" className="py-2 pe-4 text-start font-semibold">
                  State
                </th>
                <th scope="col" className="py-2 pe-4 text-end font-semibold">
                  Stories
                </th>
                <th scope="col" className="py-2 text-start font-semibold">
                  Carried sources (stories)
                </th>
              </tr>
            </thead>
            <tbody>
              {report.competitions.map((row) => (
                <tr
                  key={row.competition.id}
                  className="border-b border-default align-top"
                  data-testid="coverage-row"
                  data-state={row.state}
                >
                  <td className="py-2 pe-4">
                    <Link
                      href={`/${locale}/competition/${row.competition.id}`}
                      className="underline"
                    >
                      {row.competition.name}
                    </Link>
                  </td>
                  <td className={`py-2 pe-4 ${row.state === 'covered' ? '' : 'font-medium'}`}>
                    {STATE_LABEL[row.state]}
                  </td>
                  <td className="py-2 pe-4 text-end tabular-nums">{row.coverage.stories}</td>
                  <td className="py-2">
                    {row.coverage.sources.length === 0
                      ? 'None'
                      : row.coverage.sources
                          .map((source) => `${source.name} (${String(source.stories)})`)
                          .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
