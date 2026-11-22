import type { ConsoleFinding, ConsoleHeartbeat, ConsoleSeverity } from '@fmip/contracts';
import {
  CONSOLE_SNOOZE_MAX_DAYS,
  CONSOLE_SNOOZE_MAX_DAYS_SEVERE,
  CONSOLE_SYNC_TIME_ZONE,
  CONSOLE_WITHHELD_FINDING_TITLE,
  consolePcState,
  dayToIso,
  isoToDay,
  wallClock,
} from '@fmip/contracts/console';
import { tehranClock } from './words';

/**
 * Finding triage on the findings page (T-1908, D-456 point 2), the pure part:
 * which of the five groups a finding is in, what its page may say of a
 * command not applied yet, the days a snooze may name, and what the
 * publisher's one `detail` text holds. No React, so the server pages, the
 * client forms and the specs share it.
 */

/** The five groups the counts are split into; every finding is in exactly one. */
export const TRIAGE_GROUPS = ['needs', 'accepted', 'rejected', 'snoozed', 'closed'] as const;
export type TriageGroup = (typeof TRIAGE_GROUPS)[number];

export const GROUP_WORDS: Record<TriageGroup, string> = {
  needs: 'نیاز به تصمیم',
  accepted: 'پذیرفته',
  rejected: 'رد شده',
  snoozed: 'به تعویق افتاده',
  closed: 'بسته',
};

/**
 * A finding's group from the status the snapshot carries, and nothing else:
 * a command still waiting does not move it (the computer has not applied
 * it). A status this page does not know still wants someone, so it needs
 * triage rather than vanish from the counts.
 */
export function triageGroup(finding: Pick<ConsoleFinding, 'status'>): TriageGroup {
  switch (finding.status) {
    case 'planned':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'snoozed':
      return 'snoozed';
    case 'fixed':
    case 'wontfix':
    case 'duplicate':
      return 'closed';
    default:
      return 'needs';
  }
}

/** The five counts; they sum to `findings.length` because each finding is counted once. */
export function triageCounts(
  findings: readonly Pick<ConsoleFinding, 'status'>[],
): Record<TriageGroup, number> {
  const counts: Record<TriageGroup, number> = {
    needs: 0,
    accepted: 0,
    rejected: 0,
    snoozed: 0,
    closed: 0,
  };
  for (const finding of findings) counts[triageGroup(finding)] += 1;
  return counts;
}

/** The API's rule (`isSecurityFinding`): the security agent's, or an id `sec-YYYY-MM-DD-NN`. */
export const isSecurityFinding = (finding: Pick<ConsoleFinding, 'id' | 'agent'>): boolean =>
  finding.agent === 'security' || /^sec-\d{4}-\d{2}-\d{2}-\d+$/i.test(finding.id.trim());

/**
 * What stands in place of a security finding's title while its detail is
 * withheld (D-456 point 3, decided by the maintainer on 2026-11-22: hidden
 * everywhere in the console, both accounts): the console draws neither. Since
 * T-1948 the snapshot does not carry the title either: the computer and the
 * server put this same phrase in its place, so nothing here may read
 * `finding.title` of a withheld finding as if it were its own (`similarFindings`
 * does not, and nothing sorts or filters by a title). The id still names it,
 * and the actions work by id.
 */
export const WITHHELD_TITLE = CONSOLE_WITHHELD_FINDING_TITLE;
export const titleWithheld = (finding: Pick<ConsoleFinding, 'id' | 'agent' | 'detail'>): boolean =>
  isSecurityFinding(finding) && finding.detail === null;

/** The publisher's `detail` (`findingsFrom`): evidence, then labelled paragraphs. */
export interface FindingParts {
  evidence: string;
  cause: string;
  proposal: string;
  /** The person's triage line as the computer wrote it, in English. */
  triage: string;
}

export function findingParts(detail: string | null): FindingParts {
  const parts: FindingParts = { evidence: '', cause: '', proposal: '', triage: '' };
  if (detail === null) return parts;
  const evidence: string[] = [];
  for (const block of detail.split(/\n{2,}/)) {
    const labelled = /^(Likely cause|Proposal|Triage): ([\s\S]*)$/.exec(block);
    if (labelled === null) evidence.push(block);
    else if (labelled[1] === 'Likely cause' && parts.cause === '') parts.cause = labelled[2]!;
    else if (labelled[1] === 'Proposal' && parts.proposal === '') parts.proposal = labelled[2]!;
    else if (labelled[1] === 'Triage') parts.triage = labelled[2]!;
    else evidence.push(block);
  }
  parts.evidence = evidence.join('\n\n').trim();
  return parts;
}

/**
 * A reject's reason, from the line the computer wrote («…» is its own
 * quotation: the reason is stored without guillemets, T-1907). `null` when
 * the snapshot does not carry it, which the page says rather than guess.
 */
export function rejectReason(detail: string | null): string | null {
  const line = findingParts(detail).triage;
  const quoted = /^Rejected on the agents console\b[^«]*«([^»]*)»\s*$/.exec(line)?.[1]?.trim();
  return quoted === undefined || quoted === '' ? null : quoted;
}

/** A task row's id (`T-1950`); a security finding carries a private marker instead, which is not one. */
export const taskId = (task: string | null | undefined): string | null =>
  typeof task === 'string' && /^T-\d+$/.test(task.trim()) ? task.trim() : null;
export const hasPrivateTask = (task: string | null | undefined): boolean =>
  typeof task === 'string' && task.trim() !== '' && taskId(task) === null;

/** The longest a finding of this severity may be snoozed, in days (the API's `snoozeMaxDays`). */
export const snoozeLimit = (severity: ConsoleSeverity): number =>
  severity === 'critical' || severity === 'major'
    ? CONSOLE_SNOOZE_MAX_DAYS_SEVERE
    : CONSOLE_SNOOZE_MAX_DAYS;

export interface SnoozeDays {
  /** The three quick choices, each a day the API takes. */
  choices: { label: string; until: string }[];
  /** The date field's first and last day, YYYY-MM-DD. */
  min: string;
  max: string;
  limit: number;
}

/**
 * The days a snooze may name. "Tomorrow" is tomorrow in Tehran, where the
 * page's readers are; the API counts from its own UTC day, which is never
 * ahead of Tehran's, so every day here is after it, and the last one is the
 * API's own limit from the UTC day.
 */
export function snoozeDays(severity: ConsoleSeverity, now: Date): SnoozeDays {
  const limit = snoozeLimit(severity);
  const utc = isoToDay(now.toISOString().slice(0, 10)) ?? 0;
  const tehran = isoToDay(wallClock(now, CONSOLE_SYNC_TIME_ZONE).date) ?? utc;
  const max = utc + limit;
  const choices = [
    { label: 'فردا', days: 1 },
    { label: 'سه روز دیگر', days: 3 },
    { label: 'هفته‌ی بعد', days: 7 },
  ]
    .filter(({ days }) => tehran + days <= max)
    .map(({ label, days }) => ({ label, until: dayToIso(tehran + days) }));
  return { choices, min: dayToIso(tehran + 1), max: dayToIso(max), limit };
}

/**
 * When the computer may apply a waiting command, as the heartbeat allows it
 * to be said (T-1906): a time only while the computer is syncing, "until it
 * is back" while it is silent or never seen, and no time when a sync is
 * overdue or the heartbeat was not read.
 */
export function nextSyncWords(heartbeat: ConsoleHeartbeat | null, now: Date): string {
  if (heartbeat === null) return 'در هم‌گام‌سازی بعدی انجام می‌شود.';
  const pc = consolePcState(heartbeat.loaded_at, now);
  if (pc.state === 'silent' || pc.state === 'never')
    return 'رایانه خاموش است؛ تا برگردد در صف می‌ماند.';
  if (pc.dueSlot !== null) return 'در هم‌گام‌سازی بعدی انجام می‌شود.';
  return `هم‌گام‌سازی بعدی حدود ${tehranClock(pc.nextSlot)} است.`;
}

const words = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );

/** How alike two titles are: shared words over all words, 0 to 1. */
export function titleLikeness(a: string, b: string): number {
  const [left, right] = [words(a), words(b)];
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Two titles count as one subject from here; a looser net than this lists strangers. */
export const SAME_SUBJECT = 0.5;

/**
 * «شبیه‌ها»: the other findings on the same subject. One that this finding
 * names in `related`, or that names this one, and one whose title shares
 * half its words or more. A finding whose title is withheld is matched by
 * `related` alone, and never by a title the page does not show.
 */
export function similarFindings(
  finding: ConsoleFinding,
  all: readonly ConsoleFinding[],
  limit = 8,
): ConsoleFinding[] {
  const names = (text: string | null, id: string): boolean =>
    text !== null &&
    new RegExp(`(^|[^A-Za-z0-9-])${id.replace(/[^A-Za-z0-9-]/g, '')}($|[^A-Za-z0-9-])`).test(text);
  const hidden = titleWithheld(finding);
  return all
    .filter((other) => other.id !== finding.id)
    .map((other) => ({
      other,
      linked: names(finding.related, other.id) || names(other.related, finding.id),
      likeness: hidden || titleWithheld(other) ? 0 : titleLikeness(finding.title, other.title),
    }))
    .filter(({ linked, likeness }) => linked || likeness >= SAME_SUBJECT)
    .sort(
      (a, b) =>
        Number(b.linked) - Number(a.linked) ||
        b.likeness - a.likeness ||
        b.other.opened_at.localeCompare(a.other.opened_at),
    )
    .slice(0, limit)
    .map(({ other }) => other);
}
