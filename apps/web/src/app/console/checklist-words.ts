import type {
  ConsoleChecklistAssignee,
  ConsoleChecklistEvent,
  ConsoleChecklistItem,
  ConsoleChecklistList,
  ConsoleChecklistPerson,
  ConsoleChecklistStatus,
} from '@fmip/contracts';

/**
 * The pre-launch checklist's words and arithmetic (T-1840, D-428), shared by
 * the server-drawn page and its one client part: the lists' and statuses'
 * Persian, the tones that make a status readable at a glance, who an
 * assignee is, what a history row says, and progress. No React, no server.
 */

export const LIST_WORDS: Record<ConsoleChecklistList, { title: string; short: string }> = {
  friends: {
    title: 'فهرست بررسی پیش از راه‌اندازی برای خانواده و دوستان',
    short: 'خانواده و دوستان',
  },
  public: { title: 'فهرست نهایی بررسی پیش از راه‌اندازی عمومی', short: 'راه‌اندازی عمومی' },
};

export const STATUS_WORDS: Record<ConsoleChecklistStatus, string> = {
  not_started: 'شروع نشده',
  in_progress: 'در حال انجام',
  blocked: 'مسدود',
  done: 'انجام شد',
  not_needed: 'لازم نیست',
};

/** A status's tone: the select's border and text, and the dot and bar beside it. */
export const STATUS_TONE: Record<
  ConsoleChecklistStatus,
  { control: string; dot: string; bar: string }
> = {
  not_started: { control: 'border-strong text-muted', dot: 'bg-caption', bar: 'bg-caption' },
  in_progress: { control: 'border-accent text-fg', dot: 'bg-accent', bar: 'bg-accent' },
  blocked: { control: 'border-danger text-danger', dot: 'bg-danger', bar: 'bg-danger' },
  // The theme's `success` is ink; the teal of a good rating reads as done in both themes.
  done: { control: 'border-rating-good text-fg', dot: 'bg-rating-good', bar: 'bg-rating-good' },
  not_needed: {
    control: 'border-default text-caption',
    dot: 'border border-strong bg-surface',
    bar: 'bg-surface-raised',
  },
};

export const AGENTS_WORDS = 'تیم عامل‌ها (Claude)';
export const NOBODY_WORDS = 'بدون مسئول';

/** Who an assignee is, in Persian; an account no longer on the list keeps a plain word. */
export function assigneeWords(
  assignee: ConsoleChecklistAssignee,
  people: readonly ConsoleChecklistPerson[],
): string {
  if (assignee === null) return NOBODY_WORDS;
  if (assignee === 'agents') return AGENTS_WORDS;
  return people.find((p) => p.id === assignee)?.display_name ?? 'حساب حذف‌شده';
}

/** The `?who=` of an assignee: a username, `agents` or `none`. */
export function whoKey(
  assignee: ConsoleChecklistAssignee,
  people: readonly ConsoleChecklistPerson[],
): string {
  if (assignee === null) return 'none';
  if (assignee === 'agents') return 'agents';
  return people.find((p) => p.id === assignee)?.username ?? 'none';
}

/** One history row in a sentence: who did it is shown beside it. */
export function historyWords(
  event: ConsoleChecklistEvent,
  people: readonly ConsoleChecklistPerson[],
  sectionTitle: (id: string) => string,
): string {
  const status = (value: string | null) =>
    value !== null && value in STATUS_WORDS ? STATUS_WORDS[value as ConsoleChecklistStatus] : '—';
  switch (event.kind) {
    case 'created':
      return 'مورد را اضافه کرد';
    case 'retitled':
      return `متن را از «${event.previous ?? ''}» به «${event.next ?? ''}» تغییر داد`;
    case 'sectioned':
      return `از بخش «${sectionTitle(event.previous ?? '')}» به «${sectionTitle(event.next ?? '')}» برد`;
    case 'status':
      return `وضعیت را از «${status(event.previous)}» به «${status(event.next)}» تغییر داد`;
    case 'assigned':
      return `مسئول را از «${assigneeWords(event.previous, people)}» به «${assigneeWords(event.next, people)}» تغییر داد`;
    case 'moved':
      return `جای مورد را در بخش از ${faDigits(event.previous)} به ${faDigits(event.next)} برد`;
    case 'removed':
      return `مورد را حذف کرد؛ دلیل: ${event.next ?? ''}`;
  }
}

const faDigits = (value: string | null): string =>
  value === null ? '—' : new Intl.NumberFormat('fa-IR').format(Number(value));

export interface Progress {
  /** Items counted: all but «لازم نیست». */
  counted: number;
  done: number;
  /** Whole percent of the counted items done; 0 when nothing is counted. */
  percent: number;
  by: Record<ConsoleChecklistStatus, number>;
}

/** Done of the items that count; «لازم نیست» leaves the count, so it never holds a list back. */
export function progressOf(items: readonly Pick<ConsoleChecklistItem, 'status'>[]): Progress {
  const by: Record<ConsoleChecklistStatus, number> = {
    not_started: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    not_needed: 0,
  };
  for (const item of items) by[item.status] += 1;
  const counted = items.length - by.not_needed;
  return {
    counted,
    done: by.done,
    percent: counted === 0 ? 0 : Math.floor((by.done * 100) / counted),
    by,
  };
}
