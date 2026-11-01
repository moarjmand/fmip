import { ConsoleLink as Link } from '@/app/console/console-link';
import type { Metadata } from 'next';
import { consoleSnapshot } from '@/lib/console-api';
import { Card, agentTitle, when } from '../../ui';

export const metadata: Metadata = { title: 'گزارش‌ها' };

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Every agent's reports, newest first, and the one chosen (T-1698, D-340). */
export default async function ConsoleReportsPage({ searchParams }: Search) {
  const query = await searchParams;
  const path = typeof query.path === 'string' ? query.path : '';
  const result = await consoleSnapshot();
  const reports = result.ok ? (result.data.snapshot?.reports ?? []) : [];
  const chosen = reports.find((r) => r.path === path) ?? reports[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card title="گزارش‌ها">
        <ul className="flex flex-col">
          {reports.map((report) => (
            <li key={report.path}>
              <Link
                href={`/reports?path=${encodeURIComponent(report.path)}`}
                aria-current={report.path === chosen?.path ? 'page' : undefined}
                className={`flex flex-col rounded-control px-2 py-2 text-sm hover:bg-surface-raised ${report.path === chosen?.path ? 'bg-surface-raised' : ''}`}
              >
                <span className="font-bold text-fg" dir="auto">
                  {report.title}
                </span>
                <span className="text-xs text-caption">
                  {agentTitle(report.agent)} · {when(report.date, false)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={chosen === undefined ? 'گزارشی نیست' : chosen.title}>
        {chosen === undefined ? (
          <p className="text-sm text-muted">هنوز گزارشی نرسیده.</p>
        ) : chosen.text === '' ? (
          <p className="text-sm text-muted">
            گزارش عامل امنیت فقط روی رایانه‌ی شماست (D-340). مسیر:{' '}
            <span dir="ltr">{chosen.path}</span>
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-caption" dir="ltr">
              {chosen.path}
            </p>
            <div className="whitespace-pre-wrap text-sm leading-7 text-fg" dir="auto">
              {chosen.text}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
