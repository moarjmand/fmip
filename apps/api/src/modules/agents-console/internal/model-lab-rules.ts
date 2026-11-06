import type {
  ConsoleLabEntry,
  ConsoleLabGroup,
  ConsoleLabJudgement,
  ConsoleModelLab,
} from '@fmip/contracts';
import {
  CONSOLE_LAB_ENTRIES_MAX,
  CONSOLE_LAB_GROUP_RESULTS,
  CONSOLE_LAB_GROUPS,
  CONSOLE_LAB_KINDS,
  CONSOLE_LAB_SCHEMA,
  CONSOLE_LAB_TEXT_MAX,
  CONSOLE_LAB_VERDICTS,
} from '@fmip/contracts/console';

/**
 * The model lab's ledger as it arrives inside a snapshot (T-1752, D-371),
 * checked at the server's edge, pure. The file is kept by hand on the
 * maintainer's computer and checked there by the publisher; this is the
 * second look, so a ledger that is not one never reaches a page: the whole
 * ledger is dropped when its envelope is wrong, and an entry is dropped when
 * its key, its verdict or its kind is not one the console knows. Nothing is
 * repaired or guessed -- a number that is not a number becomes null, a text
 * is cut at the limit, and the page says what is missing.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== ''
    ? value.length > CONSOLE_LAB_TEXT_MAX
      ? `${value.slice(0, CONSOLE_LAB_TEXT_MAX)}…`
      : value
    : null;

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const count = (value: unknown): number | null => {
  const n = number(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

const texts = (value: unknown, limit = 40): string[] =>
  Array.isArray(value)
    ? value
        .flatMap((item) => {
          const t = text(item);
          return t === null ? [] : [t];
        })
        .slice(0, limit)
    : [];

const day = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;

function groupOf(raw: unknown): ConsoleLabGroup | null {
  if (!isObject(raw)) return null;
  const group = oneOf(CONSOLE_LAB_GROUPS, raw.group);
  const result = oneOf(CONSOLE_LAB_GROUP_RESULTS, raw.result);
  if (group === null || result === null) return null;
  return {
    group,
    label: text(raw.label),
    result,
    matches: count(raw.matches),
    matches_total: count(raw.matches_total),
    difference: number(raw.difference),
    low: number(raw.low),
    high: number(raw.high),
    reference_log_loss: number(raw.reference_log_loss),
    tested_log_loss: number(raw.tested_log_loss),
    worse_divisions: count(raw.worse_divisions),
    divisions: count(raw.divisions),
    worse_in: texts(raw.worse_in),
    calibration_before: number(raw.calibration_before),
    calibration_after: number(raw.calibration_after),
    note: text(raw.note),
  };
}

function entryOf(raw: unknown): ConsoleLabEntry | null {
  if (!isObject(raw)) return null;
  const key = typeof raw.key === 'string' && /^[a-z0-9_]{1,80}$/.test(raw.key) ? raw.key : null;
  const title = text(raw.title);
  const verdict = oneOf(CONSOLE_LAB_VERDICTS, raw.verdict);
  const kind = oneOf(CONSOLE_LAB_KINDS, raw.kind);
  if (key === null || title === null || verdict === null || kind === null) return null;
  return {
    key,
    family: text(raw.family) ?? title,
    phase: count(raw.phase),
    title,
    technical: text(raw.technical) ?? '',
    kind,
    why: text(raw.why) ?? '',
    data: text(raw.data) ?? '',
    against: text(raw.against),
    groups: Array.isArray(raw.groups)
      ? raw.groups.flatMap((g) => {
          const group = groupOf(g);
          return group === null ? [] : [group];
        })
      : [],
    verdict,
    reason: text(raw.reason) ?? '',
    decisions: texts(raw.decisions).filter((d) => /^D-\d{1,4}$/.test(d)),
    task: text(raw.task),
    decided_on: day(raw.decided_on),
    due_on: day(raw.due_on),
    reports: texts(raw.reports),
    missing: texts(raw.missing),
  };
}

function judgementOf(raw: unknown): ConsoleLabJudgement | null {
  if (!isObject(raw)) return null;
  const version = text(raw.model_version);
  const judgedOn = day(raw.judged_on);
  const words = text(raw.text);
  const result = oneOf(['met', 'not_met'] as const, raw.result);
  if (version === null || judgedOn === null || words === null || result === null) return null;
  return {
    model_version: version,
    rule: text(raw.rule) ?? '',
    condition: text(raw.condition) ?? '',
    result,
    judged_on: judgedOn,
    matches: count(raw.matches),
    text: words,
    report: text(raw.report),
  };
}

/** The ledger a snapshot carries, cleaned; null when it carries none or it is not one. */
export function checkModelLab(raw: unknown): ConsoleModelLab | null {
  if (!isObject(raw) || raw.schema !== CONSOLE_LAB_SCHEMA || !Array.isArray(raw.entries)) {
    return null;
  }
  if (typeof raw.updated_at !== 'string' || Number.isNaN(Date.parse(raw.updated_at))) return null;
  const seen = new Set<string>();
  const entries: ConsoleLabEntry[] = [];
  // What the computer left out, plus what is dropped here.
  let skipped = count(raw.skipped) ?? 0;
  for (const item of raw.entries.slice(0, CONSOLE_LAB_ENTRIES_MAX)) {
    const entry = entryOf(item);
    if (entry === null || seen.has(entry.key)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.key);
    entries.push(entry);
  }
  skipped += Math.max(0, raw.entries.length - CONSOLE_LAB_ENTRIES_MAX);
  return {
    schema: CONSOLE_LAB_SCHEMA,
    updated_at: raw.updated_at,
    skipped,
    entries,
    judgements: Array.isArray(raw.judgements)
      ? raw.judgements.flatMap((j) => {
          const judgement = judgementOf(j);
          return judgement === null ? [] : [judgement];
        })
      : [],
  };
}
