import { ConsoleLink as Link } from '@/app/console/console-link';
import type { ConsoleSnapshot } from '@fmip/contracts';
import { consoleCommands, consoleSnapshot } from '@/lib/console-api';
import {
  Badge,
  Card,
  FindingRow,
  SCHEDULE_WORDS,
  Stat,
  agentTitle,
  fa,
  freshness,
  when,
} from '../ui';

const RANK = { critical: 0, major: 1, minor: 2, info: 3 } as const;

/** The console's first page (T-1698, D-340): how the team is, what waits on a person. */
export default async function ConsoleOverviewPage() {
  const [snapshotResult, commandsResult] = await Promise.all([
    consoleSnapshot(),
    consoleCommands(),
  ]);
  const snapshot: ConsoleSnapshot | null = snapshotResult.ok ? snapshotResult.data.snapshot : null;
  const fresh = freshness(snapshotResult.ok ? snapshotResult.data.loaded_at : null, new Date());
  const commands = commandsResult.ok ? commandsResult.data.commands : [];

  if (snapshot === null) {
    return (
      <Card title="هنوز چیزی نرسیده">
        <p className="text-sm text-muted">{fresh.words}</p>
      </Card>
    );
  }

  const open = snapshot.findings.filter((f) => f.status === 'open');
  const serious = open.filter((f) => f.severity === 'critical' || f.severity === 'major');
  const openDecisions = snapshot.decisions.filter((d) => d.status === 'open');
  const waiting = commands.filter((c) => c.status === 'queued' || c.status === 'taken');
  const paused = snapshot.agents.filter((a) => a.paused).length;

  return (
    <>
      <p
        role="status"
        className={fresh.stale ? 'text-sm font-bold text-warning' : 'text-sm text-muted'}
      >
        {fresh.words}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="عامل‌ها"
          value={`${fa(snapshot.agents.length - paused)} فعال${paused > 0 ? ` · ${fa(paused)} متوقف` : ''}`}
        />
        <Stat
          label="یافته‌های باز مهم"
          value={fa(serious.length)}
          tone={serious.length > 0 ? 'text-warning' : 'text-fg'}
        />
        <Stat
          label="تصمیم‌های منتظر شما"
          value={fa(openDecisions.length)}
          tone={openDecisions.length > 0 ? 'text-brand' : 'text-fg'}
        />
        <Stat label="دستورهای در صف" value={fa(waiting.length)} />
      </div>

      {openDecisions.length > 0 && (
        <Card
          title="منتظر تصمیم شما"
          action={
            <Link href="/decisions" className="text-sm text-brand">
              همه‌ی تصمیم‌ها
            </Link>
          }
        >
          <ul className="flex flex-col gap-2">
            {openDecisions.map((d) => (
              <li key={d.id} className="text-sm">
                <Link href={`/decisions#${d.id}`} className="font-bold text-fg hover:underline">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="تیم"
        action={<span className="text-xs text-caption">برای جزئیات روی هر عامل بزنید</span>}
      >
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" id="agents">
          {snapshot.agents.map((agent) => {
            const mine = open.filter((f) => f.agent === agent.name);
            const last = agent.runs[0];
            return (
              <li key={agent.name}>
                <Link
                  href={`/agents/${agent.name}`}
                  className="flex h-full flex-col gap-2 rounded-tile border border-default bg-surface-raised p-3 hover:border-strong"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-fg">{agentTitle(agent.name)}</span>
                    {agent.paused ? (
                      <Badge tone="border-warning text-warning">متوقف</Badge>
                    ) : (
                      <Badge tone="border-success text-success">فعال</Badge>
                    )}
                  </div>
                  <span className="text-xs text-caption" dir="ltr">
                    {agent.name} · {agent.model}
                  </span>
                  <span className="text-xs text-muted">
                    {SCHEDULE_WORDS[agent.schedule] ?? agent.schedule} · آخرین اجرا:{' '}
                    {last === undefined ? '—' : when(last.at, false)} · یافته‌ی باز:{' '}
                    {fa(mine.length)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="یافته‌های باز، مهم‌ترها اول"
          action={
            <Link href="/findings" className="text-sm text-brand">
              همه
            </Link>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-muted">یافته‌ی بازی نیست.</p>
          ) : (
            <ul>
              {[...open]
                .sort(
                  (a, b) =>
                    RANK[a.severity] - RANK[b.severity] || b.opened_at.localeCompare(a.opened_at),
                )
                .slice(0, 8)
                .map((finding) => (
                  <FindingRow key={finding.id} finding={finding} />
                ))}
            </ul>
          )}
        </Card>
        <Card
          title={
            snapshot.brief === null
              ? 'خلاصه‌ی روز'
              : `خلاصه‌ی روز · ${when(snapshot.brief.date, false)}`
          }
        >
          {snapshot.brief === null ? (
            <p className="text-sm text-muted">مدیر دفتر هنوز خلاصه‌ای ننوشته.</p>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-muted">
              {snapshot.brief.text}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
