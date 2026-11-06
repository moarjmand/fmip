import type {
  ConsoleLabEntry,
  ConsoleLabGroup,
  ConsoleLabJudgement,
  ConsoleModelLab,
} from '@fmip/contracts';

/**
 * The model lab's ledger, read on the maintainer's computer (T-1752, D-371):
 * `E:/FMIP/ops/model/ledger.json`, kept by the model scientist, is checked
 * here and carried to the console inside the snapshot. Pure, so it is tested
 * on fixtures; `publish.ts` only reads the file.
 *
 * This is the strict check, where the person who edits the file sees the
 * answer: every problem is named with its entry, and an entry with a problem
 * is left out and counted (`skipped`), because a wrong figure on the page is
 * worse than a missing row that says it is missing. The server checks again
 * with its own, shorter rules. The lists below repeat the contract's
 * (`@fmip/contracts/console`) on purpose: the publisher runs from source and
 * imports types only, so a stale build of the contracts cannot stop a sync.
 */

export const LAB_SCHEMA = 1;
export const LAB_VERDICTS = [
  'adopted',
  'rejected',
  'insufficient',
  'parked',
  'running',
  'scheduled',
  'not_run',
] as const;
export const LAB_KINDS = ['input', 'constants', 'version', 'control'] as const;
export const LAB_GROUPS = ['football_data', 'our_records', 'cross_league', 'all'] as const;
export const LAB_GROUP_RESULTS = ['passed', 'failed', 'insufficient', 'not_judged'] as const;
export const LAB_ENTRIES_MAX = 200;
export const LAB_TEXT_MAX = 1200;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Reads one entry's fields, collecting what is wrong with them. */
class Reader {
  readonly problems: string[] = [];
  constructor(
    private readonly raw: Record<string, unknown>,
    private readonly where: string,
  ) {}

  private wrong(field: string, what: string): void {
    this.problems.push(`${this.where}: ${field} ${what}`);
  }

  text(field: string, required = true): string {
    const value = this.raw[field];
    if (typeof value !== 'string' || value.trim() === '') {
      if (required) this.wrong(field, 'is missing');
      return '';
    }
    if (value.length > LAB_TEXT_MAX) this.wrong(field, `is longer than ${LAB_TEXT_MAX} characters`);
    return value;
  }

  textOrNull(field: string): string | null {
    const value = this.raw[field];
    if (value === null || value === undefined) return null;
    return this.text(field) || null;
  }

  texts(field: string): string[] {
    const value = this.raw[field];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      this.wrong(field, 'is not a list of texts');
      return [];
    }
    return value as string[];
  }

  number(field: string): number | null {
    const value = this.raw[field];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.wrong(field, 'is not a number');
      return null;
    }
    return value;
  }

  count(field: string): number | null {
    const value = this.number(field);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      this.wrong(field, 'is not a count');
      return null;
    }
    return value;
  }

  oneOf<T extends string>(field: string, values: readonly T[]): T | null {
    const value = this.raw[field];
    if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
      return value as T;
    }
    this.wrong(field, `is not one of ${values.join(', ')}`);
    return null;
  }

  day(field: string): string | null {
    const value = this.raw[field];
    if (value === null || value === undefined) return null;
    if (!isDay(value)) {
      this.wrong(field, 'is not a day (YYYY-MM-DD)');
      return null;
    }
    return value;
  }

  note(what: string): void {
    this.problems.push(`${this.where}: ${what}`);
  }
}

function groupOf(raw: unknown, where: string): { group: ConsoleLabGroup; problems: string[] } {
  const reader = new Reader(isObject(raw) ? raw : {}, where);
  if (!isObject(raw)) reader.note('is not an object');
  const group: ConsoleLabGroup = {
    group: reader.oneOf('group', LAB_GROUPS) ?? 'all',
    label: reader.textOrNull('label'),
    result: reader.oneOf('result', LAB_GROUP_RESULTS) ?? 'not_judged',
    matches: reader.count('matches'),
    matches_total: reader.count('matches_total'),
    difference: reader.number('difference'),
    low: reader.number('low'),
    high: reader.number('high'),
    reference_log_loss: reader.number('reference_log_loss'),
    tested_log_loss: reader.number('tested_log_loss'),
    worse_divisions: reader.count('worse_divisions'),
    divisions: reader.count('divisions'),
    worse_in: reader.texts('worse_in'),
    calibration_before: reader.number('calibration_before'),
    calibration_after: reader.number('calibration_after'),
    note: reader.textOrNull('note'),
  };
  // What the figures must agree on among themselves; nothing here is a verdict.
  if ((group.low === null) !== (group.high === null)) {
    reader.note('an interval needs both its ends');
  }
  if (group.low !== null && group.high !== null) {
    if (group.low > group.high) reader.note('the interval is upside down');
    if (
      group.difference !== null &&
      (group.difference < group.low || group.difference > group.high)
    ) {
      reader.note('the difference is outside its own interval');
    }
  }
  if (
    group.matches !== null &&
    group.matches_total !== null &&
    group.matches > group.matches_total
  ) {
    reader.note('more matches read than the window holds');
  }
  if (
    group.worse_divisions !== null &&
    group.divisions !== null &&
    group.worse_divisions > group.divisions
  ) {
    reader.note('worse in more divisions than it was judged in');
  }
  if (
    group.worse_in.length > 0 &&
    group.worse_divisions !== null &&
    group.worse_in.length !== group.worse_divisions
  ) {
    reader.note('worse_in does not name as many divisions as worse_divisions counts');
  }
  return { group, problems: reader.problems };
}

function entryOf(raw: unknown, index: number): { entry: ConsoleLabEntry; problems: string[] } {
  const named = isObject(raw) && typeof raw.key === 'string' ? raw.key : `entry ${index + 1}`;
  const reader = new Reader(isObject(raw) ? raw : {}, named);
  if (!isObject(raw)) reader.note('is not an object');
  const key = reader.text('key');
  if (key !== '' && !/^[a-z0-9_]{1,80}$/.test(key)) {
    reader.note('key may hold only a-z, 0-9 and _');
  }
  const title = reader.text('title');
  const verdict = reader.oneOf('verdict', LAB_VERDICTS);
  const groups = Array.isArray(isObject(raw) ? raw.groups : undefined)
    ? ((raw as Record<string, unknown>).groups as unknown[]).map((g, i) =>
        groupOf(g, `${named}, group ${i + 1}`),
      )
    : [];
  if (isObject(raw) && raw.groups !== undefined && !Array.isArray(raw.groups)) {
    reader.note('groups is not a list');
  }
  const decisions = reader.texts('decisions');
  for (const decision of decisions) {
    if (!/^D-\d{1,4}$/.test(decision))
      reader.note(`decision "${decision}" is not an id like D-329`);
  }
  const phase = reader.count('phase');
  const entry: ConsoleLabEntry = {
    key,
    family: reader.textOrNull('family') ?? title,
    phase,
    title,
    technical: reader.text('technical', false),
    kind: reader.oneOf('kind', LAB_KINDS) ?? 'input',
    why: reader.text('why'),
    data: reader.text('data', false),
    against: reader.textOrNull('against'),
    groups: groups.map((g) => g.group),
    verdict: verdict ?? 'parked',
    reason: reader.text('reason'),
    decisions,
    task: reader.textOrNull('task'),
    decided_on: reader.day('decided_on'),
    due_on: reader.day('due_on'),
    reports: reader.texts('reports'),
    missing: reader.texts('missing'),
  };
  // Traceable (rules 5 and 8): a verdict names the decision that recorded it.
  if (verdict !== null && verdict !== 'parked' && decisions.length === 0) {
    reader.note('names no decision');
  }
  if ((verdict === 'running' || verdict === 'scheduled') && entry.due_on === null) {
    reader.note(`is ${verdict} and says no day it is judged (due_on)`);
  }
  if (
    verdict !== null &&
    ['adopted', 'rejected', 'insufficient', 'not_run'].includes(verdict) &&
    entry.decided_on === null
  ) {
    reader.note('has a verdict and no day it was decided (decided_on)');
  }
  return { entry, problems: [...reader.problems, ...groups.flatMap((g) => g.problems)] };
}

function judgementOf(
  raw: unknown,
  index: number,
): { judgement: ConsoleLabJudgement; problems: string[] } {
  const reader = new Reader(isObject(raw) ? raw : {}, `judgement ${index + 1}`);
  if (!isObject(raw)) reader.note('is not an object');
  const judgement: ConsoleLabJudgement = {
    model_version: reader.text('model_version'),
    rule: reader.text('rule'),
    condition: reader.text('condition'),
    result: reader.oneOf('result', ['met', 'not_met'] as const) ?? 'not_met',
    judged_on: reader.day('judged_on') ?? '',
    matches: reader.count('matches'),
    text: reader.text('text'),
    report: reader.textOrNull('report'),
  };
  if (judgement.judged_on === '') reader.note('says no day it was judged (judged_on)');
  return { judgement, problems: reader.problems };
}

export interface LabRead {
  /** The ledger to publish; null when the file is not a ledger at all. */
  lab: ConsoleModelLab | null;
  /** Everything wrong with the file, each with the entry it is in. */
  problems: string[];
}

/**
 * The ledger file's content, checked. `changedAt` is the file's own time,
 * used when the file names none. An entry with any problem is left out and
 * counted in `skipped`; a second entry with a key already seen is a problem.
 */
export function labFrom(raw: unknown, changedAt: string): LabRead {
  if (!isObject(raw)) return { lab: null, problems: ['The ledger is not a JSON object.'] };
  if (raw.schema !== LAB_SCHEMA) {
    return {
      lab: null,
      problems: [`The ledger's schema is ${String(raw.schema)}, not ${LAB_SCHEMA}.`],
    };
  }
  if (!Array.isArray(raw.entries)) return { lab: null, problems: ['entries is not a list.'] };
  const problems: string[] = [];
  if (raw.entries.length > LAB_ENTRIES_MAX) {
    problems.push(
      `The ledger holds ${raw.entries.length} entries; only ${LAB_ENTRIES_MAX} are read.`,
    );
  }
  const seen = new Set<string>();
  const entries: ConsoleLabEntry[] = [];
  let skipped = 0;
  raw.entries.slice(0, LAB_ENTRIES_MAX).forEach((item, index) => {
    const read = entryOf(item, index);
    if (read.problems.length === 0 && seen.has(read.entry.key)) {
      read.problems.push(`${read.entry.key}: the key is used twice`);
    }
    if (read.problems.length > 0) {
      problems.push(...read.problems);
      skipped += 1;
      return;
    }
    seen.add(read.entry.key);
    entries.push(read.entry);
  });
  const judgements: ConsoleLabJudgement[] = [];
  if (raw.judgements !== undefined && !Array.isArray(raw.judgements)) {
    problems.push('judgements is not a list.');
  }
  (Array.isArray(raw.judgements) ? raw.judgements : []).forEach((item, index) => {
    const read = judgementOf(item, index);
    if (read.problems.length > 0) problems.push(...read.problems);
    else judgements.push(read.judgement);
  });
  const updatedAt =
    typeof raw.updated_at === 'string' && !Number.isNaN(Date.parse(raw.updated_at))
      ? raw.updated_at
      : changedAt;
  return {
    lab: { schema: LAB_SCHEMA, updated_at: updatedAt, skipped, entries, judgements },
    problems,
  };
}
