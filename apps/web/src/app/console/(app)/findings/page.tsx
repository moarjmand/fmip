import Link from '@/components/ui/link';
import type { Metadata } from 'next';
import { consoleSnapshot } from '@/lib/console-api';
import { Card, FindingRow, SEVERITY_WORDS, STATUS_WORDS, agentTitle, fa } from '../../ui';

export const metadata: Metadata = { title: 'یافته‌ها' };

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : '';

/** Every agent's findings (T-1698, D-340), filtered by agent, severity and status. */
export default async function ConsoleFindingsPage({ searchParams }: Search) {
  const query = await searchParams;
  const filter = {
    agent: one(query.agent),
    severity: one(query.severity),
    status: one(query.status) || 'open',
  };
  const result = await consoleSnapshot();
  const snapshot = result.ok ? result.data.snapshot : null;
  const all = snapshot?.findings ?? [];
  const shown = all.filter(
    (f) =>
      (filter.agent === '' || f.agent === filter.agent) &&
      (filter.severity === '' || f.severity === filter.severity) &&
      (filter.status === 'all' || f.status === filter.status),
  );
  const href = (change: Partial<typeof filter>) => {
    const next = { ...filter, ...change };
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== ''));
    return `/findings?${params.toString()}`;
  };
  const chip = (label: string, change: Partial<typeof filter>, active: boolean) => (
    <Link
      key={label}
      href={href(change)}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-9 items-center rounded-pill border px-3 text-xs ${active ? 'border-fg bg-fg text-canvas' : 'border-default text-muted hover:border-strong'}`}
    >
      {label}
    </Link>
  );
  const agents = [...new Set(all.map((f) => f.agent))].sort();

  return (
    <Card title={`یافته‌ها · ${fa(shown.length)}`}>
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {chip('همه‌ی عامل‌ها', { agent: '' }, filter.agent === '')}
          {agents.map((agent) => chip(agentTitle(agent), { agent }, filter.agent === agent))}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip('همه‌ی شدت‌ها', { severity: '' }, filter.severity === '')}
          {(['critical', 'major', 'minor', 'info'] as const).map((s) =>
            chip(SEVERITY_WORDS[s], { severity: s }, filter.severity === s),
          )}
          <span className="mx-1 border-s border-default" aria-hidden="true" />
          {(['open', 'fixed', 'all'] as const).map((s) =>
            chip(s === 'all' ? 'همه' : (STATUS_WORDS[s] ?? s), { status: s }, filter.status === s),
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">با این فیلترها یافته‌ای نیست.</p>
      ) : (
        <ul>
          {shown.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </ul>
      )}
    </Card>
  );
}
