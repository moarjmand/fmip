import type { ConsoleFinding, ConsoleHeartbeat, ConsoleMe } from '@fmip/contracts';
import { ConsoleLink as Link } from './console-link';
import { FindingTriage, type TriageView } from './finding-triage';
import {
  GROUP_WORDS,
  TRIAGE_GROUPS,
  type TriageGroup,
  hasPrivateTask,
  isSecurityFinding,
  nextSyncWords,
  rejectReason,
  snoozeDays,
  taskId,
  titleWithheld,
  triageGroup,
} from './triage';
import { Badge, FindingTitle, STATUS_WORDS, SeverityBadge, agentTitle, fa, when } from './ui';

/**
 * The findings page's server pieces (T-1908, D-456 point 2): a row with its
 * triage, the five counts, and the view the client part is handed. Dates and
 * times are worded here, on the server, in Tehran time.
 */

/** What every row's triage is worded from: the heartbeat, who reads, the clock. */
export interface TriageContext {
  heartbeat: ConsoleHeartbeat | null;
  me: ConsoleMe | null;
  now: Date;
}

/** Said to an account that is not the owner, in place of buttons the server would refuse (D-456, 2026-11-21). */
export const OWNER_ONLY_WORDS =
  'تصمیم درباره‌ی یافته‌ی امنیتی فقط با حساب مالک کنسول (نگهدارنده) است. با این حساب نمی‌شود آن را قبول یا رد کرد یا به تعویق انداخت.';

export function triageView(finding: ConsoleFinding, context: TriageContext): TriageView {
  const days = snoozeDays(finding.severity, context.now);
  const pending = finding.pending ?? null;
  return {
    id: finding.id,
    group: triageGroup(finding),
    // `owner` absent (an API from before T-1908): not known, so the server's refusal is what is said.
    refusal: isSecurityFinding(finding) && context.me?.owner === false ? OWNER_ONLY_WORDS : null,
    pending:
      pending === null
        ? null
        : {
            commandId: pending.command_id,
            kind: pending.kind,
            asked: `${pending.requested_by} · ${when(pending.requested_at)}`,
            until: pending.until === null ? null : when(pending.until, false),
            taken: pending.taken === true,
          },
    nextSync: nextSyncWords(context.heartbeat, context.now),
    task: taskId(finding.task),
    privateTask: hasPrivateTask(finding.task),
    reason: rejectReason(finding.detail),
    until: finding.until == null ? null : when(finding.until, false),
    by: finding.triaged_by ?? null,
    snooze: {
      choices: days.choices.map((choice) => ({
        until: choice.until,
        label: `${choice.label} · ${when(choice.until, false)}`,
      })),
      // The days between are worded in the browser when the form opens, not sent with every row.
      min: days.min,
      max: days.max,
      limit: `حداکثر ${fa(days.limit)} روز برای این شدت: تا ${when(days.max, false)}.`,
    },
  };
}

/** `/findings/<id>`, the id as one path segment. */
export const findingHref = (id: string): string => `/findings/${encodeURIComponent(id)}`;

/** The badges and the line that name a finding: severity, the snapshot's status, a waiting command, id, agent, day. */
export function FindingMeta({ finding }: { finding: ConsoleFinding }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeverityBadge severity={finding.severity} />
      <Badge>{STATUS_WORDS[finding.status] ?? finding.status}</Badge>
      {finding.pending != null && (
        <Badge tone="border-dashed border-strong text-fg">در انتظار رایانه</Badge>
      )}
      <span className="text-xs text-caption" dir="ltr">
        {finding.id}
      </span>
      <span className="text-xs text-caption">
        · {agentTitle(finding.agent)} · {when(finding.opened_at, false)}
      </span>
    </div>
  );
}

/** A finding on the findings page: what it is, a link to its own page, and its triage. */
export function TriageRow({
  finding,
  context,
}: {
  finding: ConsoleFinding;
  context: TriageContext;
}) {
  const titleId = `finding-${finding.id.replace(/[^A-Za-z0-9-]/g, '')}`;
  const view = triageView(finding, context);
  return (
    <li className="flex flex-col gap-2 border-b border-default py-4 last:border-b-0">
      <FindingMeta finding={finding} />
      <h3 id={titleId} className="text-sm font-bold text-fg">
        <Link href={findingHref(finding.id)} className="flex min-h-9 items-center hover:underline">
          <FindingTitle finding={finding} />
        </Link>
      </h3>
      {titleWithheld(finding) ? (
        <p className="text-xs text-caption">
          عنوان و جزئیات این یافته‌ی امنیتی در کنسول نمایش داده نمی‌شود؛ تصمیم با شناسه ثبت می‌شود.
        </p>
      ) : (
        <p className="text-xs">
          <Link
            href={findingHref(finding.id)}
            className="inline-flex min-h-9 items-center font-semibold text-accent underline underline-offset-4"
          >
            شواهد، علت و پیشنهاد
          </Link>
        </p>
      )}
      {view.group !== 'closed' && <FindingTriage view={view} labelledBy={titleId} />}
    </li>
  );
}

/**
 * The five counts and the total (T-1908): each finding is in one group, so
 * they sum to the total, which is said beside them. Each is a link that
 * filters the list; the one shown is marked for a screen reader too.
 */
export function TriageCounts({
  counts,
  current,
  hrefOf,
}: {
  counts: Record<TriageGroup, number>;
  current: TriageGroup | 'all';
  hrefOf: (group: TriageGroup | 'all') => string;
}) {
  const total = TRIAGE_GROUPS.reduce((sum, group) => sum + counts[group], 0);
  const tile = (key: TriageGroup | 'all', label: string, count: number) => (
    <li key={key}>
      <Link
        href={hrefOf(key)}
        aria-current={current === key ? 'true' : undefined}
        data-count={key}
        className={`flex min-h-touch flex-col justify-center rounded-tile border px-3 py-2 ${current === key ? 'border-fg bg-surface-raised' : 'border-default hover:border-strong'}`}
      >
        <span className="text-xs text-muted">{label}</span>
        <span className="text-lg font-bold text-fg">{fa(count)}</span>
      </Link>
    </li>
  );
  return (
    <ul aria-label="شمار یافته‌ها" className="grid grid-cols-3 gap-2 md:grid-cols-6">
      {TRIAGE_GROUPS.map((group) => tile(group, GROUP_WORDS[group], counts[group]))}
      {tile('all', 'همه', total)}
    </ul>
  );
}
