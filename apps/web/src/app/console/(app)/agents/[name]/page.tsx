import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  CONSOLE_AGENT_MODELS,
  CONSOLE_AGENT_SCHEDULES,
  type ConsoleMemorySource,
} from '@fmip/contracts';
import { queueCommand } from '@/lib/console-actions';
import { consoleCommands, consoleSnapshot } from '@/lib/console-api';
import { ConsoleForm } from '../../../console-form';
import {
  Badge,
  Card,
  FindingRow,
  RunsBars,
  SCHEDULE_WORDS,
  STATUS_WORDS,
  WorkflowDiagram,
  agentTitle,
  fa,
  inputClass,
  when,
} from '../../../ui';

type Params = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: agentTitle((await params).name) };
}

const SOURCE_WORDS: Record<ConsoleMemorySource['kind'], string> = {
  instructions: 'دستورالعمل',
  project: 'قواعد پروژه',
  charter: 'منشور تیم',
  skill: 'مهارت',
  history: 'سابقه',
  memory: 'حافظه‌ی خودش',
};

function Reason() {
  return (
    <input
      name="reason"
      required
      maxLength={500}
      placeholder="چرا؟ (در کارنامه ثبت می‌شود)"
      className={inputClass}
    />
  );
}

/** One agent (T-1698, D-340): how it works, what it can touch, what feeds its memory and what it holds, its runs, and its controls. */
export default async function ConsoleAgentPage({ params }: Params) {
  const { name } = await params;
  const [snapshotResult, commandsResult] = await Promise.all([
    consoleSnapshot(),
    consoleCommands(),
  ]);
  const snapshot = snapshotResult.ok ? snapshotResult.data.snapshot : null;
  const agent = snapshot?.agents.find((a) => a.name === name);
  if (snapshot === null || agent === undefined) notFound();

  const findings = snapshot.findings.filter((f) => f.agent === name);
  const open = findings.filter((f) => f.status === 'open');
  const reports = snapshot.reports.filter((r) => r.agent === name).slice(0, 10);
  const commands = (commandsResult.ok ? commandsResult.data.commands : [])
    .filter((c) => c.target === name)
    .slice(0, 10);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-brand">
          → همه‌ی عامل‌ها
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">{agentTitle(agent.name)}</h1>
          <span className="text-sm text-caption" dir="ltr">
            {agent.name}
          </span>
          {agent.paused ? (
            <Badge tone="border-warning text-warning">متوقف</Badge>
          ) : (
            <Badge tone="border-success text-success">فعال</Badge>
          )}
          <Badge>مدل: {agent.model}</Badge>
          <Badge>{SCHEDULE_WORDS[agent.schedule] ?? agent.schedule}</Badge>
        </div>
        <p className="max-w-measure text-sm text-muted" dir="auto">
          {agent.description}
        </p>
      </div>

      <Card title="چطور کار می‌کند">
        <WorkflowDiagram workflow={agent.workflow} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="به چه چیزهایی دسترسی دارد">
          <ul className="flex flex-col gap-3">
            {agent.access.map((group) => (
              <li key={group.area} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      group.level === 'write'
                        ? 'border-warning text-warning'
                        : 'border-default text-muted'
                    }
                  >
                    {group.level === 'write' ? 'نوشتن' : 'خواندن'}
                  </Badge>
                  <span className="text-sm text-fg" dir="auto">
                    {group.area}
                  </span>
                </div>
                <span className="text-xs text-caption" dir="ltr">
                  {group.tools.join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-caption">
            منشور تیم همه‌ی عامل‌ها را روی سرور فقط‌خواندنی نگه می‌دارد؛ هیچ عاملی داده‌ی سایت را
            عوض نمی‌کند.
          </p>
        </Card>

        <Card title="حافظه‌اش از کجا تغذیه می‌شود">
          <ul className="flex flex-col gap-2">
            {agent.memory.sources.map((source) => (
              <li
                key={`${source.kind}-${source.path}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge>{SOURCE_WORDS[source.kind]}</Badge>
                <span dir="auto">{source.label}</span>
                <span className="text-xs text-caption" dir="ltr">
                  {source.path}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-2 text-sm font-bold">آنچه الان در حافظه‌ی خودش دارد</h3>
          {agent.memory.entries.length === 0 ? (
            <p className="text-sm text-muted">
              هنوز چیزی ننوشته؛ از اجرای بعدی، آموخته‌هایش اینجا دیده می‌شود.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agent.memory.entries.map((entry) => (
                <li key={entry.path}>
                  <details className="rounded-control border border-default p-2">
                    <summary className="cursor-pointer text-sm">
                      <span dir="ltr">{entry.path.split('/').at(-1)}</span>
                      <span className="ms-2 text-xs text-caption">{when(entry.updated_at)}</span>
                    </summary>
                    <pre
                      className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted"
                      dir="auto"
                    >
                      {entry.text}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`اجراها و یافته‌ها در هر اجرا · ${fa(open.length)} یافته‌ی باز`}>
        <RunsBars runs={agent.runs} />
      </Card>

      <Card title="کنترل">
        <p className="mb-4 text-sm text-muted">
          هر دستور در صف می‌ماند تا رایانه آن را بردارد (همگام‌سازی ساعتی و اجرای روزانه‌ی ۸ صبح)؛
          نتیجه زیر «دستورها» دیده می‌شود.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <ConsoleForm action={queueCommand} submit={agent.paused ? 'ادامه بده' : 'متوقف کن'}>
            <input
              type="hidden"
              name="kind"
              value={agent.paused ? 'agent.resume' : 'agent.pause'}
            />
            <input type="hidden" name="target" value={agent.name} />
            <Reason />
          </ConsoleForm>
          <ConsoleForm action={queueCommand} submit="همین حالا اجرا کن">
            <input type="hidden" name="kind" value="agent.run" />
            <input type="hidden" name="target" value={agent.name} />
            <Reason />
          </ConsoleForm>
          <ConsoleForm action={queueCommand} submit="مدل را عوض کن">
            <input type="hidden" name="kind" value="agent.model" />
            <input type="hidden" name="target" value={agent.name} />
            <select name="model" defaultValue={agent.model} className={inputClass} aria-label="مدل">
              {CONSOLE_AGENT_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <Reason />
          </ConsoleForm>
          <ConsoleForm action={queueCommand} submit="برنامه را عوض کن">
            <input type="hidden" name="kind" value="agent.schedule" />
            <input type="hidden" name="target" value={agent.name} />
            <select
              name="schedule"
              defaultValue={agent.schedule}
              className={inputClass}
              aria-label="برنامه"
            >
              {CONSOLE_AGENT_SCHEDULES.map((schedule) => (
                <option key={schedule} value={schedule}>
                  {SCHEDULE_WORDS[schedule]}
                </option>
              ))}
            </select>
            <Reason />
          </ConsoleForm>
        </div>
        <h3 className="mt-5 mb-2 text-sm font-bold">دستورها</h3>
        {commands.length === 0 ? (
          <p className="text-sm text-muted">دستوری برای این عامل نیامده.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {commands.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2">
                <Badge>{STATUS_WORDS[c.status]}</Badge>
                <span dir="ltr">{c.kind}</span>
                <span className="text-muted">
                  {c.requested_by} · {when(c.requested_at)}
                  {c.outcome !== null ? ` · ${c.outcome}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="یافته‌های اخیر">
          {findings.length === 0 ? (
            <p className="text-sm text-muted">یافته‌ای ثبت نکرده.</p>
          ) : (
            <ul>
              {findings.slice(0, 10).map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          )}
        </Card>
        <Card title="گزارش‌ها">
          {reports.length === 0 ? (
            <p className="text-sm text-muted">گزارشی ننوشته.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.map((report) => (
                <li key={report.path} className="text-sm">
                  <Link
                    href={`/reports?path=${encodeURIComponent(report.path)}`}
                    className="text-fg hover:underline"
                    dir="auto"
                  >
                    {report.title}
                  </Link>
                  <span className="ms-2 text-xs text-caption">{when(report.date, false)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
