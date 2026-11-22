import { ConsoleLink as Link } from '@/app/console/console-link';
import type { Metadata } from 'next';
import { consoleHeartbeat, consoleMe, consoleSnapshot } from '@/lib/console-api';
import { TriageCounts, TriageRow } from '../../findings';
import { TRIAGE_GROUPS, type TriageGroup, triageCounts, triageGroup } from '../../triage';
import { Card, SEVERITY_WORDS, agentTitle, fa } from '../../ui';

export const metadata: Metadata = { title: 'یافته‌ها' };

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : '';

/** `?status=`: one of the five groups or `all`; the older `open` and `fixed` still land where they did. */
function groupOf(status: string): TriageGroup | 'all' {
  if (status === 'all') return 'all';
  if (status === 'fixed') return 'closed';
  return TRIAGE_GROUPS.find((group) => group === status) ?? 'needs';
}

/**
 * Every agent's findings (T-1698, D-340), filtered by agent and severity, and
 * settled here (T-1908, D-456 point 2): the five counts, and on each finding
 * its triage. The list is the whole list, not yet paged (T-1916).
 */
export default async function ConsoleFindingsPage({ searchParams }: Search) {
  const query = await searchParams;
  const filter = { agent: one(query.agent), severity: one(query.severity) };
  const group = groupOf(one(query.status));
  const [result, heartbeat, me] = await Promise.all([
    consoleSnapshot(),
    consoleHeartbeat(),
    consoleMe(),
  ]);
  const snapshot = result.ok ? result.data.snapshot : null;
  const all = snapshot?.findings ?? [];
  // The counts are of what the agent and severity filters leave, so they sum to that total.
  const inScope = all.filter(
    (f) =>
      (filter.agent === '' || f.agent === filter.agent) &&
      (filter.severity === '' || f.severity === filter.severity),
  );
  const shown = group === 'all' ? inScope : inScope.filter((f) => triageGroup(f) === group);
  const href = (change: Partial<typeof filter & { status: string }>) => {
    const next = { ...filter, status: group, ...change };
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
  const context = {
    heartbeat: heartbeat.ok ? heartbeat.data : null,
    me: me.ok ? me.data : null,
    now: new Date(),
  };

  return (
    <Card title={`یافته‌ها · ${fa(shown.length)}`}>
      <div className="mb-4 flex flex-col gap-3">
        <TriageCounts
          counts={triageCounts(inScope)}
          current={group}
          hrefOf={(status) => href({ status })}
        />
        <div className="flex flex-wrap gap-2">
          {chip('همه‌ی عامل‌ها', { agent: '' }, filter.agent === '')}
          {agents.map((agent) => chip(agentTitle(agent), { agent }, filter.agent === agent))}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip('همه‌ی شدت‌ها', { severity: '' }, filter.severity === '')}
          {(['critical', 'major', 'minor', 'info'] as const).map((s) =>
            chip(SEVERITY_WORDS[s], { severity: s }, filter.severity === s),
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">با این فیلترها یافته‌ای نیست.</p>
      ) : (
        <ul>
          {shown.map((finding) => (
            <TriageRow key={finding.id} finding={finding} context={context} />
          ))}
        </ul>
      )}
    </Card>
  );
}
